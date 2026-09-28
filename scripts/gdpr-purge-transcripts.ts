/**
 * GDPR Art 5(1)(e) — storage limitation.
 *
 * Nulls the verbatim `transcript` and `transcript_review` columns on
 * `call_logs` rows older than `--days` (default 30). Keeps:
 *   - the `ai_summary` (short, owner-facing — useful for diary recall)
 *   - the `outcome` + `cost_estimate` + `caller_number` (for invoicing /
 *     billing reconciliation under Art 6(1)(f) legitimate interest).
 *
 * Run via dashboard cron `/api/cron/data-retention` in cara-platform (daily).
 * This script remains for manual one-off purges:
 */
import 'dotenv/config';

import { createClient } from '@supabase/supabase-js';

function parseFlag(name: string, fallback: string): string {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (!arg) {
    return fallback;
  }
  return arg.slice(name.length + 3);
}

async function main() {
  const days = Number.parseInt(
    parseFlag('days', process.env.CLISTE_TRANSCRIPT_RETENTION_DAYS ?? '30'),
    10,
  );
  const dryRun = process.argv.includes('--dry-run');
  if (!Number.isFinite(days) || days < 1) {
    console.error('--days must be a positive integer');
    process.exit(2);
  }

  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) {
    console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }
  const supabase = createClient(url, key);

  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - days);

  console.log(`Purging transcripts on call_logs older than ${cutoff.toISOString()} (${days} days). dry-run=${dryRun}`);

  const { data: matches, error: lookupErr } = await supabase
    .from('call_logs')
    .select('id, created_at')
    .lt('created_at', cutoff.toISOString())
    .not('transcript', 'is', null);
  if (lookupErr) {
    console.error('lookup failed', lookupErr);
    process.exit(1);
  }
  const count = matches?.length ?? 0;
  console.log(`Rows with non-null transcripts older than cutoff: ${count}`);

  const { count: captureCount, error: captureCountError } = await supabase
    .from('call_transcript_captures')
    .select('id', { count: 'exact', head: true })
    .lt('started_at', cutoff.toISOString());
  if (captureCountError) throw captureCountError;
  console.log(`Raw transcript captures older than cutoff: ${captureCount ?? 0}`);
  if (dryRun) return;

  if (count > 0) {
    const { error } = await supabase
      .from('call_logs')
      .update({ transcript: null, transcript_review: null })
      .lt('created_at', cutoff.toISOString())
      .not('transcript', 'is', null);
    if (error) throw error;
    console.log(`Purged ${count} transcript(s).`);
  }

  let capturesRemoved = 0;
  while (true) {
    const batch = await supabase.from('call_transcript_captures')
      .select('id').lt('started_at', cutoff.toISOString()).limit(500);
    if (batch.error) throw batch.error;
    const ids = (batch.data ?? []).map((row) => row.id);
    if (!ids.length) break;
    const events = await supabase.from('call_transcript_events').delete().in('capture_id', ids);
    if (events.error) throw events.error;
    const captures = await supabase.from('call_transcript_captures').delete().in('id', ids);
    if (captures.error) throw captures.error;
    capturesRemoved += ids.length;
  }
  console.log(`Purged ${capturesRemoved} raw transcript capture(s).`);
}

void main();
