import { getSupabaseClient, isOfflinePlayground } from './supabase.js';

/**
 * Per-call metering for Stripe Billing overage.
 *
 * Each AI call writes one row into `public.usage_records`:
 *   1. `startUsageRecord` at session start — so even calls that crash mid-way
 *      are visible in the dashboard (with `ended_at=null`).
 *   2. `finishUsageRecord` on session close — fills in `ended_at` and
 *      `minutes_billable`, which the nightly cron in cara-platform rolls
 *      up into Stripe metered usage records.
 *
 * Both are best-effort: failures are logged but never surface to the caller,
 * because losing a metering row must not take an in-flight call off the line.
 */

export type StartUsageInput = {
  organizationId: string;
  planTier: string | null | undefined;
  planQuotaMinutes: number | null | undefined;
  callSid: string | null | undefined;
  roomName: string | null | undefined;
  callerNumber: string | null | undefined;
  billingPeriodStart: string;
};

export async function startUsageRecord(input: StartUsageInput): Promise<string | null> {
  if (isOfflinePlayground()) return null;
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('usage_records')
      .insert({
        organization_id: input.organizationId,
        call_sid: input.callSid ?? null,
        room_name: input.roomName ?? null,
        caller_number: input.callerNumber ?? null,
        started_at: new Date().toISOString(),
        billing_period_start: input.billingPeriodStart,
        plan_tier_at_time: input.planTier ?? null,
        plan_quota_at_time:
          typeof input.planQuotaMinutes === 'number' ? input.planQuotaMinutes : null,
      })
      .select('id')
      .single();
    if (error) {
      console.warn('[usage] startUsageRecord failed', error.message);
      return null;
    }
    return typeof data?.id === 'string' ? data.id : null;
  } catch (err) {
    console.warn(
      '[usage] startUsageRecord threw',
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

export async function finishUsageRecord(input: {
  usageId: string;
  durationSeconds: number;
  syncSkipReason?: string | null;
}): Promise<void> {
  if (isOfflinePlayground() || !input.usageId) {
    return;
  }
  // Bill actual talk time in minutes (2dp) — no per-call round-up.
  const seconds = Math.max(0, input.durationSeconds);
  const minutes = Math.round((seconds / 60) * 100) / 100;
  const skipReason = input.syncSkipReason?.trim() || null;
  try {
    const supabase = getSupabaseClient();
    const { error } = await supabase
      .from('usage_records')
      .update({
        ended_at: new Date().toISOString(),
        minutes_billable: skipReason ? 0 : minutes,
        ...(skipReason ? { sync_skip_reason: skipReason } : {}),
      })
      .eq('id', input.usageId);
    if (error) {
      console.warn('[usage] finishUsageRecord failed', error.message);
    }
  } catch (err) {
    console.warn(
      '[usage] finishUsageRecord threw',
      err instanceof Error ? err.message : err,
    );
  }
}

/**
 * Compute the current billing period anchor (YYYY-MM-DD). Prefer the value
 * on the organisation row (mirrors the Stripe subscription's current period
 * start) and only fall back to the first day of the current UTC month when
 * the column isn't populated yet.
 */
export function currentBillingPeriodStart(
  orgBillingPeriodStart?: string | null,
  now: Date = new Date(),
): string {
  if (
    typeof orgBillingPeriodStart === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(orgBillingPeriodStart)
  ) {
    return orgBillingPeriodStart;
  }
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}-01`;
}

/**
 * Complete billing-period total, calculated inside PostgreSQL so the REST row
 * limit cannot omit usage. The RPC includes estimated active calls, capped at
 * 30 minutes per row, and ignores unfinished rows older than six hours.
 * Errors or invalid totals return null so admission fails closed.
 */
const ZOMBIE_OPEN_AGE_MS = 6 * 60 * 60 * 1000;

export async function sumUsageMinutesThisPeriod(input: {
  organizationId: string;
  billingPeriodStart: string;
}): Promise<number | null> {
  if (isOfflinePlayground()) return 0;
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.rpc('voice_usage_minutes_for_period', {
      p_organization_id: input.organizationId,
      p_billing_period_start: input.billingPeriodStart,
    });
    if (error) {
      console.warn('[usage] sumUsageMinutesThisPeriod failed', error.message);
      return null;
    }
    if (typeof data !== 'number' || !Number.isFinite(data) || data < 0) {
      console.warn('[usage] sumUsageMinutesThisPeriod returned an invalid total');
      return null;
    }
    return data;
  } catch (err) {
    console.warn(
      '[usage] sumUsageMinutesThisPeriod threw',
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

/**
 * Best-effort sweep of open usage rows older than ZOMBIE_OPEN_AGE_MS.
 * Closes them out at started_at with minutes_billable=0 so they survive
 * for audit but don't poison the quota gate (which previously summed
 * `now - started_at` for any open row, locking out orgs after a worker
 * crash). Safe to call from agent boot — runs once, fail-silent.
 */
export async function reapZombieUsageRows(): Promise<void> {
  if (isOfflinePlayground()) return;
  try {
    const supabase = getSupabaseClient();
    const cutoffIso = new Date(Date.now() - ZOMBIE_OPEN_AGE_MS).toISOString();
    const { data, error } = await supabase
      .from('usage_records')
      .select('id, started_at')
      .is('ended_at', null)
      .lt('started_at', cutoffIso)
      .limit(500);
    if (error) {
      console.warn('[usage] reapZombieUsageRows select failed', error.message);
      return;
    }
    const rows = (data ?? []) as Array<{ id: string; started_at: string }>;
    if (rows.length === 0) return;
    for (const row of rows) {
      const { error: updErr } = await supabase
        .from('usage_records')
        .update({ ended_at: row.started_at, minutes_billable: 0 })
        .eq('id', row.id)
        .is('ended_at', null);
      if (updErr) {
        console.warn('[usage] reapZombieUsageRows update failed', {
          id: row.id,
          message: updErr.message,
        });
      }
    }
    console.warn('[usage] reaped zombie usage rows', { count: rows.length });
  } catch (err) {
    console.warn(
      '[usage] reapZombieUsageRows threw',
      err instanceof Error ? err.message : err,
    );
  }
}

/**
 * Minutes included per plan tier. Kept in sync with cara-platform's
 * `src/lib/cliste-plans.ts`. Returns null for unknown/enterprise tiers so
 * the metering row doesn't claim a false quota.
 */
export function planQuotaMinutes(tier: string | null | undefined): number | null {
  switch ((tier ?? '').toLowerCase()) {
    case 'starter':
      return 150;
    case 'pro':
      return 500;
    case 'business':
      return 1500;
    case 'enterprise':
      return 4000;
    default:
      return null;
  }
}
