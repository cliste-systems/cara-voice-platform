/**
 * GDPR Art 17 — right to erasure / right to be forgotten.
 *
 * Wipes per-caller PII for a phone number across the voice-agent tables:
 *   - call_logs.transcript / transcript_review / ai_summary  → null
 *   - call_logs.audio_storage_path                           → null
 *   - call-recordings Storage objects                        → deleted
 *   - call_logs.caller_number                                → 'erased'
 *   - action_tickets.caller_number                           → 'erased'
 *   - action_tickets.summary                                 → '[erased on request]'
 * Only personal-data columns are blanked; audit rows may be preserved where
 * required for legal claims / business records (Art 17(3)(b)).
 *
 * Usage:
 *   npx tsx scripts/gdpr-erase.ts +353871234567 --organization-id <uuid>
 *   npx tsx scripts/gdpr-erase.ts +353871234567 --organization-id <uuid> --dry-run
 *
 * Phone normalisation matches the agent: Irish national 087… → +35387…
 */
import 'dotenv/config';

import { createClient } from '@supabase/supabase-js';

import { normalizePhoneE164 } from '../src/lib/phone_normalize.js';
import { maskPhone } from '../src/lib/gdpr.js';
import { eraseCallRecordingStaging, resolveEgressS3Config } from '../src/lib/call_recording.js';

const CALL_RECORDINGS_BUCKET = 'call-recordings';

function usage(): never {
  console.error('Usage: tsx scripts/gdpr-erase.ts <phone> --organization-id <uuid> [--dry-run]');
  process.exit(2);
}

/** Phone-number variants we will match against — covers both stored formats. */
function lookupVariants(e164: string): string[] {
  const out = new Set<string>([e164]);
  const digits = e164.replace(/\D/g, '');
  if (digits.startsWith('353')) {
    out.add(`0${digits.slice(3)}`);
    out.add(`353${digits.slice(3)}`);
  }
  return [...out];
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    usage();
  }
  const phone = args[0]!;
  const dryRun = args.includes('--dry-run');
  const orgFlag = args.indexOf('--organization-id');
  const organizationId = orgFlag >= 0 ? args[orgFlag + 1] : undefined;
  if (!organizationId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(organizationId)) usage();
  const e164 = normalizePhoneE164(phone);
  const variants = lookupVariants(e164);

  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) {
    console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }
  const supabase = createClient(url, key);

  console.log(`Erasing PII for ${maskPhone(e164)} in organization ${organizationId} — dry-run=${dryRun}`);

  const callLogs = await supabase
    .from('call_logs')
    .select('id, organization_id, created_at, room_name, audio_storage_path')
    .eq('organization_id', organizationId)
    .in('caller_number', variants);
  if (callLogs.error) {
    console.error('call_logs lookup failed', callLogs.error);
    process.exit(1);
  }
  console.log(`call_logs matched: ${callLogs.data?.length ?? 0}`);

  const recordingPaths = [
    ...new Set(
      (callLogs.data ?? [])
        .map((row) => String(row.audio_storage_path ?? '').trim())
        .filter(Boolean),
    ),
  ];
  console.log(`call recordings matched: ${recordingPaths.length}`);

  const actionTickets = await supabase
    .from('action_tickets')
    .select('id, organization_id, created_at')
    .eq('organization_id', organizationId)
    .in('caller_number', variants);
  if (actionTickets.error) {
    console.error('action_tickets lookup failed', actionTickets.error);
    process.exit(1);
  }
  console.log(`action_tickets matched: ${actionTickets.data?.length ?? 0}`);

  if (dryRun) {
    console.log('--dry-run set; not modifying any rows.');
    return;
  }

  const stagingRooms = [...new Set((callLogs.data ?? [])
    .map((row) => row.room_name).filter((name): name is string => Boolean(name)))];
  if (stagingRooms.length && !resolveEgressS3Config()) {
    throw new Error('Staging storage credentials are required for complete erasure.');
  }

  if (recordingPaths.length > 0) {
    const { error } = await supabase.storage
      .from(CALL_RECORDINGS_BUCKET)
      .remove(recordingPaths);
    if (error) {
      console.error('call-recordings storage remove failed', error.message);
      process.exit(1);
    }
    console.log(`call-recordings: removed ${recordingPaths.length} object(s).`);
  }

  for (const roomName of stagingRooms) {
    if (!(await eraseCallRecordingStaging(organizationId, roomName))) {
      throw new Error('Failed to delete a staging recording; erasure is incomplete.');
    }
  }

  // Wipe transcripts + caller_number on call_logs.
  if ((callLogs.data?.length ?? 0) > 0) {
    const { error } = await supabase
      .from('call_logs')
      .update({
        transcript: null,
        transcript_review: null,
        ai_summary: null,
        audio_storage_path: null,
        caller_number: 'erased',
        caller_name: null,
      })
      .eq('organization_id', organizationId)
      .in('caller_number', variants);
    if (error) {
      console.error('call_logs update failed', error);
      process.exit(1);
    }
    console.log('call_logs: PII columns nulled, recordings cleared, caller_number set to "erased".');
  }

  // Wipe summary + caller_number on action_tickets.
  if ((actionTickets.data?.length ?? 0) > 0) {
    const { error } = await supabase
      .from('action_tickets')
      .update({
        caller_number: 'erased',
        summary: '[erased on request]',
        caller_name: null,
        brief_summary: null,
      })
      .eq('organization_id', organizationId)
      .in('caller_number', variants);
    if (error) {
      console.error('action_tickets update failed', error);
      process.exit(1);
    }
    console.log('action_tickets: caller_number + summary erased.');
  }

  const usageResult = await supabase.from('usage_records')
    .update({ caller_number: null })
    .eq('organization_id', organizationId)
    .in('caller_number', variants);
  if (usageResult.error) throw usageResult.error;

  const reports = await supabase.from('call_test_reports')
    .update({ caller_number: null, diagnostics: {}, pipeline_snapshot: {}, health_reason: null })
    .eq('organization_id', organizationId)
    .in('caller_number', variants);
  if (reports.error) throw reports.error;

  const callLogIds = (callLogs.data ?? []).map((row) => row.id);
  const roomNames = (callLogs.data ?? []).map((row) => row.room_name).filter((name): name is string => Boolean(name));
  const captureIds = new Set<string>();
  if (callLogIds.length) {
    const linked = await supabase.from('call_transcript_captures')
      .select('id').eq('organization_id', organizationId).in('call_log_id', callLogIds);
    if (linked.error) throw linked.error;
    for (const row of linked.data ?? []) captureIds.add(row.id);

    const linkedReports = await supabase.from('call_test_reports')
      .update({ caller_number: null, diagnostics: {}, pipeline_snapshot: {}, health_reason: null })
      .eq('organization_id', organizationId).in('call_log_id', callLogIds);
    if (linkedReports.error) throw linkedReports.error;
  }
  if (roomNames.length) {
    const byRoom = await supabase.from('call_transcript_captures')
      .select('id').eq('organization_id', organizationId).in('room_name', roomNames);
    if (byRoom.error) throw byRoom.error;
    for (const row of byRoom.data ?? []) captureIds.add(row.id);
  }
  if (captureIds.size) {
    const ids = [...captureIds];
    const events = await supabase.from('call_transcript_events')
      .delete().in('capture_id', ids);
    if (events.error) throw events.error;
    const deleted = await supabase.from('call_transcript_captures')
      .delete().eq('organization_id', organizationId).in('id', ids);
    if (deleted.error) throw deleted.error;
  }
  console.log(`transcript captures removed: ${captureIds.size}`);

  console.log('Erasure complete.');
}

void main();
