import {readCatalogueDirect,directCatalogueRecoveryConfigured} from './catalogue_direct_recovery.js';
import { hedgedCatalogueRead } from './catalogue_recovery.js';
import { redactPii } from './gdpr.js';

const HTTP_FETCH_TIMEOUT_MS = Number.parseInt(
  process.env.CLISTE_VOICE_HTTP_TIMEOUT_MS ?? '6000',
  10,
);

const CALL_COMPLETE_TIMEOUT_MS = Number.parseInt(
  process.env.CLISTE_VOICE_CALL_COMPLETE_TIMEOUT_MS ?? '15000',
  10,
);

/** Cap transcript size before POST to dashboard webhook. */
const MAX_WEBHOOK_TRANSCRIPT_CHARS = 100_000;

import type { CallCloseDiagnosticsPayload } from './call_close_diagnostics.js';

export type ActionTicketPayload = {
  called_number: string;
  caller_number: string;
  caller_name?: string | null;
  summary: string;
  department_slug?: string | null;
  route_id?: string | null;
  call_log_id?: string | null;
  delivery_status?: 'confirmed' | 'pending_review' | 'failed';
};

export type CallCompletePayload = {
  called_number: string;
  call_sid: string | null;
  room_name?: string | null;
  caller_number: string;
  caller_name?: string | null;
  duration_seconds: number;
  outcome: string;
  transcript?: string | null;
  transcript_review?: string | null;
  ai_summary?: string | null;
  disclosure_confirmed?: boolean;
  is_test_call?: boolean;
  engineer_test_call?: boolean;
  test_profile_id?: string | null;
  variant_label?: string | null;
  diagnostics?: CallCloseDiagnosticsPayload | null;
  post_call_status?: 'pending' | 'complete' | 'partial' | 'failed';
  post_call_errors?: Array<{ stage: string; message: string; at: string }>;
  post_call_expected_ticket?: boolean;
  knowledge_gaps?: Array<{
    topic: string;
    caller_context?: string;
    cara_question?: string;
    suggested_section?: string;
  }>;
  post_call_actions?: Array<{
    type: string;
    callerName?: string;
    summary?: string;
    reason?: string;
    routeId?: string;
  }>;
  audio_storage_path?: string | null;
};

export type SendSmsPayload = {
  called_number: string;
  to: string;
  body: string;
  caller_consented: boolean;
  skip_business_prefix?: boolean;
  purpose?: string;
};

function appBaseUrl(): string | null {
  const url = process.env.CLISTE_APP_URL?.trim() || '';
  if (!url) return null;
  return url.replace(/\/$/, '');
}

function voiceSecret(): string | null {
  return process.env.CLISTE_VOICE_WEBHOOK_SECRET?.trim() || null;
}

function authHeaders(): Record<string, string> {
  const secret = voiceSecret();
  if (!secret) {
    throw new Error('CLISTE_VOICE_WEBHOOK_SECRET is not set');
  }
  return {
    Authorization: `Bearer ${secret}`,
    'Content-Type': 'application/json',
  };
}

export function voiceWebhooksConfigured(): boolean {
  return Boolean(appBaseUrl() && voiceSecret());
}

function capTranscriptField(value: string | null | undefined): string | null | undefined {
  if (value == null) return value;
  const t = value.trim();
  if (!t) return null;
  if (t.length <= MAX_WEBHOOK_TRANSCRIPT_CHARS) return t;
  return `${t.slice(0, MAX_WEBHOOK_TRANSCRIPT_CHARS)}\n\n[Transcript truncated for webhook.]`;
}

function isFetchTimeoutError(err: unknown): boolean {
  if (err instanceof Error && ['AbortError','TimeoutError'].includes(err.name)) return true;
  if (err instanceof Error && /^(?:AbortError|TimeoutError):/.test(err.message)) return true;
  return err instanceof DOMException && ['AbortError','TimeoutError'].includes(err.name);
}

function webhookFetchError(err: unknown): string {
  if (isFetchTimeoutError(err)) return 'timeout';
  return err instanceof Error ? err.message : String(err);
}

async function postVoiceWebhook<T>(
  path: string,
  payload: unknown,
  timeoutMsOverride?: number,
  parentSignal?: AbortSignal,
): Promise<{ res: Response; body: T }> {
  const base = appBaseUrl();
  if (!base || !voiceSecret()) {
    throw new Error('voice webhooks not configured');
  }

  const baseTimeout = timeoutMsOverride ?? HTTP_FETCH_TIMEOUT_MS;
  const timeoutMs = Number.isFinite(baseTimeout)
    ? Math.min(Math.max(baseTimeout, 1000), 60_000)
    : 6000;

  const controller = new AbortController();
  const cancel = () => controller.abort();
  if (parentSignal?.aborted) cancel();
  parentSignal?.addEventListener('abort',cancel,{once:true});
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: {...authHeaders(), ...(path === '/api/voice/search-supervalu-products' ? {Connection:'close'} : {})},
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    const body = (path === '/api/voice/search-supervalu-products' ? await res.json() : await res.json().catch(() => ({}))) as T;
    return { res, body };
  } finally {
    clearTimeout(timeoutId);
    parentSignal?.removeEventListener('abort',cancel);
  }
}

export async function postCallComplete(
  payload: CallCompletePayload,
): Promise<{ ok: boolean; callLogId?: string; error?: string }> {
  if (!voiceWebhooksConfigured()) {
    return { ok: false, error: 'voice webhooks not configured' };
  }

  try {
    const { res, body } = await postVoiceWebhook<{
      ok?: boolean;
      call_log_id?: string;
      error?: string;
    }>(
      '/api/voice/call-complete',
      {
        ...payload,
        transcript: capTranscriptField(payload.transcript ?? null),
        transcript_review: capTranscriptField(payload.transcript_review ?? null),
      },
      CALL_COMPLETE_TIMEOUT_MS,
    );

    if (!res.ok) {
      return {
        ok: false,
        error: body.error ?? `HTTP ${res.status}`,
      };
    }

    const callLogId = body.call_log_id?.trim();
    if (!callLogId) {
      return { ok: false, error: 'call-complete missing call_log_id' };
    }
    return { ok: true, callLogId };
  } catch (err) {
    return { ok: false, error: webhookFetchError(err) };
  }
}

export async function postActionTicket(
  payload: ActionTicketPayload,
): Promise<{ ok: boolean; error?: string }> {
  if (!voiceWebhooksConfigured()) {
    return { ok: false, error: 'voice webhooks not configured' };
  }

  try {
    const { res, body } = await postVoiceWebhook<{ ok?: boolean; error?: string }>(
      '/api/voice/action-ticket',
      {
        ...payload,
        summary: redactPii(payload.summary).trim(),
      },
    );

    if (!res.ok) {
      return { ok: false, error: body.error ?? `HTTP ${res.status}` };
    }

    return { ok: true };
  } catch (err) {
    return { ok: false, error: webhookFetchError(err) };
  }
}

export async function postSendSms(
  payload: SendSmsPayload,
): Promise<{ ok: boolean; error?: string; to?: string; from?: string }> {
  if (!voiceWebhooksConfigured()) {
    return { ok: false, error: 'voice webhooks not configured' };
  }

  try {
    const { res, body } = await postVoiceWebhook<{
      ok?: boolean;
      error?: string;
      to?: string;
      from?: string;
    }>('/api/voice/send-sms', payload);

    if (!res.ok || body.ok !== true) {
      const error =
        res.status === 404 && !body.error
          ? 'SMS webhook route missing on CLISTE_APP_URL — deploy /api/voice/send-sms'
          : (body.error ?? `HTTP ${res.status}`);
      return { ok: false, error };
    }

    return {
      ok: true,
      ...(typeof body.to === 'string' && body.to ? { to: body.to } : {}),
      ...(typeof body.from === 'string' && body.from ? { from: body.from } : {}),
    };
  } catch (err) {
    return { ok: false, error: webhookFetchError(err) };
  }
}

export type SendCallerEmailPayload = {
  called_number: string;
  /** Server-created LiveKit room identifying the call for delivery limits. */
  call_session_id: string;
  to: string;
  subject: string;
  body: string;
  caller_consented: boolean;
};

export async function postSendCallerEmail(
  payload: SendCallerEmailPayload,
): Promise<{ ok: boolean; error?: string }> {
  if (!voiceWebhooksConfigured()) {
    return { ok: false, error: 'voice webhooks not configured' };
  }

  try {
    const { res, body } = await postVoiceWebhook<{ ok?: boolean; error?: string }>(
      '/api/voice/send-caller-email',
      payload,
    );

    if (!res.ok || body.ok !== true) {
      return { ok: false, error: body.error ?? `HTTP ${res.status}` };
    }

    return { ok: true };
  } catch (err) {
    return { ok: false, error: webhookFetchError(err) };
  }
}

export type SearchBusinessFilePayload = {
  called_number: string;
  query: string;
  file_id?: string;
  document_kind?: string;
};

export type SearchBusinessFileMatch = {
  file_id: string;
  file_name: string;
  document_kind: string | null;
  excerpts: Array<{
    text: string;
    score: number;
    start_line: number;
    end_line: number;
  }>;
};

export async function postSearchBusinessFile(
  payload: SearchBusinessFilePayload,
): Promise<{ ok: boolean; matches: SearchBusinessFileMatch[]; error?: string }> {
  if (!voiceWebhooksConfigured()) {
    return { ok: false, matches: [], error: 'voice webhooks not configured' };
  }

  try {
    const { res, body } = await postVoiceWebhook<{
      ok?: boolean;
      matches?: SearchBusinessFileMatch[];
      error?: string;
    }>('/api/voice/search-business-file', payload);

    if (!res.ok) {
      return {
        ok: false,
        matches: [],
        error: body.error ?? `HTTP ${res.status}`,
      };
    }

    return {
      ok: true,
      matches: Array.isArray(body.matches) ? body.matches : [],
    };
  } catch (err) {
    return { ok: false, matches: [], error: webhookFetchError(err) };
  }
}

export type SearchWeeklyOffersPayload = {
  called_number: string;
  query: string;
  channel?: 'butcher_counter' | 'prepack';
  service_area?: 'butcher' | 'deli' | 'fish' | 'produce' | 'bakery' | 'dairy' | 'off_licence' | 'grocery';
  fulfilment?: 'counter' | 'prepack';
};

export type SearchWeeklyOffersMatch = {
  id: string;
  product_name: string;
  department: string;
  offer_channel?: 'butcher_counter' | 'prepack' | 'grocery';
  service_area?: string;
  fulfilment?: string;
  is_alcohol?: boolean;
  current_price_eur: number;
  was_price_eur: number | null;
  discount_label: string | null;
  price_per_unit: string | null;
  score: number;
  quote_text: string;

};

async function postSearchWeeklyOffers(
  payload: SearchWeeklyOffersPayload,
): Promise<{ ok: boolean; matches: SearchWeeklyOffersMatch[]; clarificationHint?: string | null; error?: string }> {
  if (!voiceWebhooksConfigured()) {
    return { ok: false, matches: [], error: 'voice webhooks not configured' };
  }

  try {
    const { res, body } = await postVoiceWebhook<{
      ok?: boolean;
      matches?: SearchWeeklyOffersMatch[];
      clarification_hint?: string | null;
      error?: string;
    }>('/api/voice/search-weekly-offers', payload);

    if (!res.ok) {
      return {
        ok: false,
        matches: [],
        error: body.error ?? `HTTP ${res.status}`,
      };
    }

    return {
      ok: true,
      matches: Array.isArray(body.matches) ? body.matches : [],
      clarificationHint:
        typeof body.clarification_hint === 'string' ? body.clarification_hint : null,
    };
  } catch (err) {
    return { ok: false, matches: [], error: webhookFetchError(err) };
  }
}

export type SearchSupervaluProductsPayload = {
  called_number: string;
  query: string;
  intent?: 'offer' | 'price' | 'stock';
  fulfilment?: 'counter' | 'prepack';
  service_area?: 'butcher' | 'deli' | 'fish' | 'produce' | 'bakery' | 'dairy' | 'off_licence' | 'grocery';
};

export type SearchSupervaluProductsMatch = {
  product_name: string;
  department: string;
  sku: string | null;
  score: number;
  quote_text: string;
  offer_week_start?: string | null;
  offer_week_end?: string | null;
  discount_label?: string | null;
  current_price_eur?: number | null;
  was_price_eur?: number | null;
  is_on_offer?: boolean;
  is_alcohol?: boolean;
  service_area?: string | null;
  fulfilment?: string | null;
};

/** Recover a stalled read on a fresh connection; never hedge action webhooks. */
async function postCatalogLookupWebhook<T>(payload: SearchSupervaluProductsPayload): Promise<{res: Response; body: T; recoveryUsed?: boolean}> {
  const configured = Number.parseInt(process.env.CLISTE_VOICE_HTTP_TIMEOUT_MS ?? String(HTTP_FETCH_TIMEOUT_MS),10);
  const budget = Number.isFinite(configured) ? Math.min(configured,12_000) : 6000;
  let failedResponse: {res:Response;body:T} | undefined;
  try {
    return await hedgedCatalogueRead(async (attempt,signal) => {
      const result = attempt===1 && directCatalogueRecoveryConfigured()
        ? await readCatalogueDirect<T>(payload,AbortSignal.any([signal,AbortSignal.timeout(8000)]))
        : await postVoiceWebhook<T>('/api/voice/search-supervalu-products',payload,attempt === 0 ? budget : Math.min(budget,6000),signal);
      if ([500,502,503,504].includes(result.res.status)) {
        failedResponse=result;
        throw new TypeError(`Catalogue service HTTP ${result.res.status}`);
      }
      if (result.res.ok) {
        const body=result.body as {ok?:boolean;matches?:unknown};
        if (body.ok !== true || !Array.isArray(body.matches)) throw new TypeError('Invalid catalogue response');
      }
      return {...result,recoveryUsed:attempt===1};
    }, error => error instanceof TypeError || (error instanceof Error && ['AbortError','TimeoutError','SyntaxError'].includes(error.name)));
  } catch(error) {
    if (failedResponse) return failedResponse;
    throw error;
  }
}

export async function postSearchSupervaluProducts(
  payload: SearchSupervaluProductsPayload,
): Promise<{
  ok: boolean;
  matches: SearchSupervaluProductsMatch[];
  browseCategories?: string[] | null;
  noMatchQuote?: string | null;
  clarificationHint?: string | null;
  offersFreshness?: string | null;
  recoveryUsed?: boolean;
  error?: string;
}> {
  if (!voiceWebhooksConfigured()) {
    return { ok: false, matches: [], error: 'voice webhooks not configured' };
  }

  try {
    const { res, body, recoveryUsed } = await postCatalogLookupWebhook<{
      ok?: boolean;
      matches?: SearchSupervaluProductsMatch[];
      browse_categories?: string[] | null;
      no_match_quote?: string | null;
      clarification_hint?: string | null;
      offers_freshness?: string | null;
      error?: string;
    }>(payload);

    if (!res.ok) {
      return {
        ok: false,
        matches: [],
        error: body.error ?? `HTTP ${res.status}`,
      };
    }

    return {
      ok: true,
      matches: Array.isArray(body.matches) ? body.matches : [],
      recoveryUsed: recoveryUsed === true,
      browseCategories: body.browse_categories ?? null,
      noMatchQuote: body.no_match_quote ?? null,
      clarificationHint:
        typeof body.clarification_hint === 'string' ? body.clarification_hint : null,
      offersFreshness:
        typeof body.offers_freshness === 'string' ? body.offers_freshness : null,
    };
  } catch (err) {
    return { ok: false, matches: [], error: webhookFetchError(err) };
  }
}

/** Map session flags to canonical contract values. */
export function canonicalCallOutcome(flags: {
  linkSent?: boolean;
  actionTicketCreated?: boolean;
  callbackRequested?: boolean;
  endPhoneCallUsed?: boolean;
  failed?: boolean;
  voicemail?: boolean;
  spam?: boolean;
}): string {
  if (flags.spam) return 'spam_or_abuse';
  if (flags.voicemail) return 'voicemail_or_no_speech';
  if (flags.failed) return 'failed';
  if (flags.linkSent) return 'link_sent';
  if (flags.callbackRequested) return 'callback_requested';
  if (flags.actionTicketCreated) return 'action_created';
  return 'answered';
}
