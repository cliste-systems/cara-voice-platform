import { createHash } from 'node:crypto';
import { getSupabaseClient, isOfflinePlayground } from './supabase.js';
import { isPublicDemoCall } from './public_demo_limits.js';

type Rpc = (name: string, args: Record<string, string>) => PromiseLike<{ data: unknown; error: unknown }>;
export type DemoSessionRefusal = 'busy' | 'daily_limit' | 'ended' | 'unavailable';
export type DemoSessionReservation =
  | { allowed: false; reason: DemoSessionRefusal }
  | { allowed: true; lease?: { expiresAtMs: number; release: () => Promise<boolean> } };

/** Organisation-wide limits apply only to public telephone demos, never customer calls. */
export async function reservePublicDemoSession(input: {
  organizationId: string; roomName: string; isDemoLine: boolean; isSipCall: boolean;
}, rpc?: Rpc): Promise<DemoSessionReservation> {
  if (!isPublicDemoCall(input) || isOfflinePlayground()) return { allowed: true };
  if (!input.organizationId || !input.roomName.trim()) return { allowed: false, reason: 'unavailable' };
  const sessionKey = createHash('sha256').update(JSON.stringify([input.organizationId, input.roomName])).digest('hex');
  const args = { p_organization_id: input.organizationId, p_session_key: sessionKey };
  const call: Rpc = rpc ?? ((name, params) => getSupabaseClient().rpc(name, params).abortSignal(AbortSignal.timeout(5_000)));
  try {
    const { data, error } = await call('reserve_public_demo_session', args);
    const result = data as Record<string, unknown> | null;
    if (error || !result || typeof result.allowed !== 'boolean') return { allowed: false, reason: 'unavailable' };
    if (!result.allowed) {
      const reason = result.reason;
      return { allowed: false, reason: reason === 'busy' || reason === 'daily_limit' || reason === 'ended' ? reason : 'unavailable' };
    }
    const expiresAtMs = typeof result.expires_at === 'string' ? Date.parse(result.expires_at) : NaN;
    if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now() || expiresAtMs > Date.now() + 9 * 60_000) {
      // An acknowledged but malformed reservation must not occupy capacity unnecessarily.
      await Promise.resolve(call('release_public_demo_session', args)).catch(() => undefined);
      return { allowed: false, reason: 'unavailable' };
    }
    let released = false;
    let pending: Promise<boolean> | undefined;
    const release = (): Promise<boolean> => {
      if (released) return Promise.resolve(true);
      if (pending) return pending;
      pending = (async () => {
        // Idempotent database release allows a bounded retry after a transport failure.
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const result = await call('release_public_demo_session', args);
            if (!result.error) { released = true; return true; }
          } catch { /* The fixed lease expiry is the final crash recovery path. */ }
        }
        console.warn('[public_demo] session release unavailable');
        return false;
      })().finally(() => { pending = undefined; });
      return pending;
    };
    return { allowed: true, lease: { expiresAtMs, release } };
  } catch {
    console.warn('[public_demo] session reservation unavailable');
    return { allowed: false, reason: 'unavailable' };
  }
}
