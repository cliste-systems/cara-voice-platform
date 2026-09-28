import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { TranscriptCompleteness } from './transcript_completeness.js';

export type TranscriptSourceEvent = {
  seq: number; received_at: string; source: string; speaker: 'caller' | 'assistant' | 'system';
  text: string; metadata: Record<string, unknown>;
};
export type TranscriptCaptureEvidence = {
  status: 'captured' | 'partial';
  expectedEventCount: number;
  persistedEventCount: number;
  sequenceContinuous: boolean;
  hasCaller: boolean;
  hasAssistant: boolean;
};

/** Positive, unique integer sequence keys plus count=max=expected prove continuity. */
export function assessStoredTranscriptCapture(input: {
  expectedEventCount: number;
  persistedEventCount: number;
  lastSequence: number | null;
  callerEventCount: number;
  assistantEventCount: number;
  transcriptComplete: boolean;
}): TranscriptCaptureEvidence {
  const sequenceContinuous = input.expectedEventCount > 0 &&
    input.persistedEventCount === input.expectedEventCount &&
    input.lastSequence === input.expectedEventCount;
  const hasCaller = input.callerEventCount > 0;
  const hasAssistant = input.assistantEventCount > 0;
  return {
    status: sequenceContinuous && hasCaller && hasAssistant && input.transcriptComplete ? 'captured' : 'partial',
    expectedEventCount: input.expectedEventCount,
    persistedEventCount: input.persistedEventCount,
    sequenceContinuous,
    hasCaller,
    hasAssistant,
  };
}

export interface TranscriptJournalStore {
  start(): Promise<void>;
  write(events: TranscriptSourceEvent[]): Promise<void>;
  heartbeat(): Promise<void>;
  finish(expected: number, completeness: TranscriptCompleteness, callLogId: string | null): Promise<TranscriptCaptureEvidence | void>;
}

/** Keeps source events until acknowledged. Retrying a batch keeps the same sequence IDs. */
export class CallTranscriptJournal {
  private pending: TranscriptSourceEvent[] = [];
  private sequence = 0;
  private started = false;
  private inFlight: Promise<void> | undefined;
  private timer: NodeJS.Timeout;
  private verifiedCapture: TranscriptCaptureEvidence | null = null;
  constructor(private store: TranscriptJournalStore, private now = () => Date.now()) {
    this.timer = setInterval(() => { void this.flush().catch(() => {}); }, 1000);
    this.timer.unref();
    void this.flush().catch(() => {});
  }
  record(source: string, speaker: TranscriptSourceEvent['speaker'], text: string, metadata: Record<string, unknown> = {}): void {
    this.pending.push({seq: ++this.sequence, received_at: new Date(this.now()).toISOString(), source, speaker, text, metadata});
  }
  flush(): Promise<void> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.persist().finally(() => { this.inFlight = undefined; });
    return this.inFlight;
  }
  private async persist(): Promise<void> {
    if (!this.started) { await this.store.start(); this.started = true; }
    while (this.pending.length) {
      const batch = this.pending.slice(0, 250);
      await this.store.write(batch);
      this.pending.splice(0, batch.length);
    }
    await this.store.heartbeat();
  }
  captureEvidence(): TranscriptCaptureEvidence | null {
    return this.verifiedCapture ? { ...this.verifiedCapture } : null;
  }
  async close(completeness: TranscriptCompleteness, callLogId: string | null): Promise<boolean> {
    clearInterval(this.timer);
    for (let attempt=0; attempt<4; attempt++) {
      try {
        await this.flush();
        // Events arriving while an earlier flush was finishing must also be acknowledged.
        if (this.pending.length) await this.flush();
        const evidence = await this.store.finish(this.sequence, completeness, callLogId);
        this.verifiedCapture = evidence ?? null;
        return true;
      } catch {
        if (attempt<3) await new Promise(resolve => setTimeout(resolve, 250 * 2 ** attempt));
      }
    }
    console.error('[transcript_journal] final persistence failed', {expectedEvents: this.sequence, pendingEvents: this.pending.length});
    return false;
  }
}

export function createCallTranscriptJournal(db: SupabaseClient, input: {organizationId:string;roomName:string;startedAt:number}): CallTranscriptJournal {
  const id = randomUUID();
  const check = (error: {message:string} | null) => { if(error) throw new Error(error.message); };
  // Per-request timeout bounds shutdown even when the database stops responding.
  const signal = () => AbortSignal.timeout(5000);
  return new CallTranscriptJournal({
    async start() {
      const {error} = await db.from('call_transcript_captures').upsert({id,organization_id:input.organizationId,room_name:input.roomName,started_at:new Date(input.startedAt).toISOString()}, {onConflict:'id',ignoreDuplicates:true}).abortSignal(signal()); check(error);
    },
    async write(events) {
      const {error} = await db.from('call_transcript_events').upsert(events.map(event=>({...event,capture_id:id})),{onConflict:'capture_id,seq',ignoreDuplicates:true}).abortSignal(signal()); check(error);
    },
    async heartbeat() {
      const {error} = await db.from('call_transcript_captures').update({updated_at:new Date().toISOString()}).eq('id',id).abortSignal(signal()); check(error);
    },
    async finish(expected, completeness, callLogId) {
      const [countResult, lastResult, callerResult, assistantResult] = await Promise.all([
        db.from('call_transcript_events').select('seq',{count:'exact',head:true}).eq('capture_id',id).abortSignal(signal()),
        db.from('call_transcript_events').select('seq').eq('capture_id',id).order('seq',{ascending:false}).limit(1).abortSignal(signal()).maybeSingle(),
        db.from('call_transcript_events').select('seq',{count:'exact',head:true}).eq('capture_id',id).eq('speaker','caller').neq('text','').abortSignal(signal()),
        db.from('call_transcript_events').select('seq',{count:'exact',head:true}).eq('capture_id',id).eq('speaker','assistant').neq('text','').abortSignal(signal()),
      ]);
      for (const result of [countResult, lastResult, callerResult, assistantResult]) check(result.error);
      if (countResult.count == null || callerResult.count == null || assistantResult.count == null) {
        throw new Error('Transcript event counts were not returned');
      }
      const evidence = assessStoredTranscriptCapture({
        expectedEventCount: expected,
        persistedEventCount: countResult.count,
        lastSequence: lastResult.data?.seq ?? null,
        callerEventCount: callerResult.count,
        assistantEventCount: assistantResult.count,
        transcriptComplete: completeness.complete,
      });
      const {error: finishError} = await db.from('call_transcript_captures').update({
        call_log_id:callLogId,status:evidence.status,expected_events:expected,persisted_events:evidence.persistedEventCount,
        completeness:{...completeness,transcriptCapture:evidence},updated_at:new Date().toISOString(),
        last_error:evidence.status==='captured'?null:'Transcript completeness, event sequence or speaker verification failed',
      }).eq('id',id).abortSignal(signal()); check(finishError);
      return evidence;
    },
  });
}
