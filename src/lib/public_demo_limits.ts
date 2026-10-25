import { createHmac } from 'node:crypto';
import { getSupabaseClient, isOfflinePlayground } from './supabase.js';

type DemoCall = {
  organizationId: string;
  callerE164: string;
  isDemoLine: boolean;
  isSipCall: boolean;
};
type Reservation = { allowed: boolean; reason: 'allowed' | 'limited' | 'unavailable' };
type Counter = (scope: string, fingerprint: string, limit: number) => Promise<{
  data: unknown;
  error: unknown;
}>;

export function isPublicDemoCall(input: Pick<DemoCall, 'isDemoLine' | 'isSipCall'>): boolean {
  // Room names and caller-provided metadata cannot exempt a telephone call.
  return input.isDemoLine && input.isSipCall;
}

/** Customer calls keep the existing limit; only public demo telephone calls get the shorter cap. */
export function callDurationLimitMinutes(publicDemo: boolean, configured = process.env.CLISTE_MAX_CALL_MINUTES): number {
  const parsed = Number.parseInt(configured ?? '30', 10);
  const existing = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 120) : 30;
  return publicDemo ? Math.min(existing, 8) : existing;
}

/** Shared database counters survive worker restarts and serialize concurrent reservations. */
export async function reservePublicDemoCall(input: DemoCall, dependencies?: {
  secret: string;
  reserve: Counter;
}): Promise<Reservation> {
  if (!isPublicDemoCall(input) || isOfflinePlayground()) return { allowed: true, reason: 'allowed' };
  const secret = dependencies?.secret ?? (process.env.CLISTE_VOICE_WEBHOOK_SECRET?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim());
  if (!secret) return { allowed: false, reason: 'unavailable' };
  const fingerprint = createHmac('sha256', secret)
    .update(JSON.stringify([input.organizationId, input.callerE164])).digest('hex');
  const reserve: Counter = dependencies?.reserve ?? (async (scope, key, limit) => {
    const { data, error } = await getSupabaseClient().rpc('auth_rate_limit_record_failure', {
      p_scope: scope,
      p_fingerprint: key,
      p_window_seconds: 900,
      p_max_failures: limit + 1,
      p_lock_seconds: 900,
      p_captcha_after: limit + 1,
    }).abortSignal(AbortSignal.timeout(5_000));
    return { data, error };
  });
  // Anonymous callers share a larger allowance, so withholding caller ID cannot bypass admission.
  const limit = input.callerE164 === '+anonymous' ? 24 : 8;
  try {
    const { data, error } = await reserve('public_demo_call', fingerprint, limit);
    const row = Array.isArray(data) && data.length === 1 ? data[0] : null;
    if (error || !row || !Number.isInteger(row.failure_count) || row.failure_count < 1 ||
      !Number.isInteger(row.retry_after_seconds) || row.retry_after_seconds < 0) {
      console.warn('[public_demo] admission counter unavailable');
      return { allowed: false, reason: 'unavailable' };
    }
    const allowed = row.failure_count <= limit && row.retry_after_seconds === 0;
    return { allowed, reason: allowed ? 'allowed' : 'limited' };
  } catch {
    console.warn('[public_demo] admission reservation failed');
    return { allowed: false, reason: 'unavailable' };
  }
}
