import { VADEventType, type VAD, type VADStream } from '@livekit/agents';
import type { AudioFrame } from '@livekit/rtc-node';
import { ReadableStream, type ReadableStreamDefaultController } from 'node:stream/web';

type Turn = { start: number; end?: number };
type Segment = { start: number; end: number };
export type ResponseTimingSnapshot = {
  replyMs: number[];
  replyTiming: {
    source: 'caller_vad_to_worker_audio';
    observedCallerTurns: number;
    measuredReplies: number;
    unpairedTurns: number;
    overlappedTurns: number;
    captureComplete: boolean;
  };
};
type OutputFlags = { localClip?: boolean; syntheticSilence?: boolean };
const finite = (value: number) => Number.isFinite(value) && value >= 0;

/** Acoustic timing at the worker boundary, never a claim about speaker-device playback. */
export class GptLiveResponseTiming {
  private turns: Turn[] = [];
  private segments: Segment[] = [];
  private savedReplies: number[] = [];
  private savedTurns = 0;
  private savedUnpaired = 0;
  private savedOverlapped = 0;
  private complete = true;

  callerSpeechStarted(at: number): void {
    if (!finite(at) || (this.turns.length && at < this.turns[this.turns.length - 1]!.start)) return;
    if (this.turns[this.turns.length - 1]?.end === undefined && this.turns.length) return;
    if (this.turns.length >= 500) { this.complete = false; return; }
    this.turns.push({ start: at });
  }

  callerSpeechEnded(at: number): void {
    const turn = this.turns[this.turns.length - 1];
    if (!turn || turn.end !== undefined || !finite(at) || at < turn.start) return;
    turn.end = at;
  }

  assistantAudio(at: number, durationMs: number): void {
    if (!finite(at) || !finite(durationMs) || durationMs <= 0) return;
    const previous = this.segments[this.segments.length - 1];
    if (previous && at < previous.start) return;
    if (previous && at - previous.end < 200) previous.end = Math.max(previous.end, at + durationMs);
    else if (this.segments.length < 1000) this.segments.push({ start: at, end: at + durationMs });
    else this.complete = false;
  }

  markIncomplete(): void { this.complete = false; }

  snapshot(): ResponseTimingSnapshot {
    const replyMs = [...this.savedReplies];
    let unpaired = this.savedUnpaired;
    let overlapped = this.savedOverlapped;
    for (let index = 0; index < this.turns.length; index++) {
      const turn = this.turns[index]!;
      if (turn.end === undefined) { unpaired++; continue; }
      if (this.segments.some(segment => segment.start < turn.end! && segment.end > turn.end!)) {
        overlapped++;
        continue;
      }
      const nextStart = this.turns[index + 1]?.start ?? Infinity;
      const response = this.segments.find(segment => segment.start >= turn.end! && segment.start < nextStart);
      const delay = response ? response.start - turn.end : null;
      if (delay !== null && delay <= 30_000) replyMs.push(Math.round(delay));
      else unpaired++;
    }
    return { replyMs, replyTiming: {
      source: 'caller_vad_to_worker_audio',
      observedCallerTurns: this.savedTurns + this.turns.length,
      measuredReplies: replyMs.length,
      unpairedTurns: unpaired,
      overlappedTurns: overlapped,
      captureComplete: this.complete,
    } };
  }

  /** Do not pair audio across a mute, reconnect, or observer restart. */
  reset(): void {
    const snapshot = this.snapshot();
    this.savedReplies = snapshot.replyMs;
    this.savedTurns = snapshot.replyTiming.observedCallerTurns;
    this.savedUnpaired = snapshot.replyTiming.unpairedTurns;
    this.savedOverlapped = snapshot.replyTiming.overlappedTurns;
    this.turns = [];
    this.segments = [];
  }
}

type TimelineFrame = { start: number; end: number; arrival: number };
type ObserverEpoch = {
  stream: VADStream;
  controller: ReadableStreamDefaultController<AudioFrame>;
  timeline: TimelineFrame[];
  submittedMs: number;
  processedMs: number;
  active: boolean;
  task: Promise<void>;
};

/** Side observer only: never awaits inference on, or modifies, the call's audio path. */
export function createGptLiveResponseTiming(vad: VAD, options: { now?: () => number; inferenceSampleRate?: number } = {}) {
  const now = options.now ?? Date.now;
  const inferenceSampleRate = options.inferenceSampleRate ?? 16000;
  const timing = new GptLiveResponseTiming();
  let closed = false;
  let closeTask: Promise<void> | undefined;
  let epoch: ObserverEpoch | undefined;
  const retiring: Promise<void>[] = [];

  function wallTime(current: ObserverEpoch, mediaMs: number): number | null {
    const frame = current.timeline.find(frame => mediaMs >= frame.start && mediaMs <= frame.end + 0.01);
    return frame ? frame.arrival - (frame.end - mediaMs) : null;
  }

  function start(): ObserverEpoch {
    let controller!: ReadableStreamDefaultController<AudioFrame>;
    const input = new ReadableStream<AudioFrame>({ start(value) { controller = value; } });
    const stream = vad.stream();
    const current: ObserverEpoch = { stream, controller, timeline: [], submittedMs: 0, processedMs: 0, active: true, task: Promise.resolve() };
    stream.updateInputStream(input);
    current.task = (async () => {
      try {
        for await (const event of stream) {
          if (!current.active) continue;
          const mediaMs = event.samplesIndex / inferenceSampleRate * 1000;
          if (!finite(mediaMs) || mediaMs > current.submittedMs + 1) { timing.markIncomplete(); continue; }
          current.processedMs = Math.max(current.processedMs, mediaMs);
          if (event.type === VADEventType.START_OF_SPEECH || event.type === VADEventType.END_OF_SPEECH) {
            const offset = event.type === VADEventType.START_OF_SPEECH ? event.speechDuration : event.silenceDuration;
            const at = wallTime(current, Math.max(0, mediaMs - offset));
            if (at === null) timing.markIncomplete();
            else if (event.type === VADEventType.START_OF_SPEECH) timing.callerSpeechStarted(at);
            else timing.callerSpeechEnded(at);
          }
          while (current.timeline.length > 1 && current.timeline[0]!.end < current.processedMs - 2000) current.timeline.shift();
        }
      } catch {
        if (current.active) timing.markIncomplete();
      }
    })();
    return current;
  }

  async function retire(current: ObserverEpoch, drain: boolean): Promise<void> {
    try { current.controller.close(); } catch { /* Already stopped. */ }
    if (drain) {
      const deadline = Date.now() + 1000;
      while (current.processedMs + 32 < current.submittedMs && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 5));
      }
      if (current.processedMs + 32 < current.submittedMs) timing.markIncomplete();
    }
    current.active = false;
    try { current.stream.close(); } catch { timing.markIncomplete(); }
    await current.task;
  }

  return {
    pushInput(frame: AudioFrame): void {
      if (closed) return;
      const duration = frame.samplesPerChannel / frame.sampleRate * 1000;
      if (!finite(duration) || duration <= 0 || frame.channels !== 1) { timing.markIncomplete(); return; }
      try {
        epoch ??= start();
        if (epoch.submittedMs - epoch.processedMs > 4000) { timing.markIncomplete(); return; }
        epoch.timeline.push({ start: epoch.submittedMs, end: epoch.submittedMs + duration, arrival: now() });
        epoch.submittedMs += duration;
        epoch.controller.enqueue(frame);
      } catch { timing.markIncomplete(); }
    },
    pushOutput(frame: AudioFrame, at = now(), flags: OutputFlags = {}): void {
      if (closed || flags.localClip || flags.syntheticSilence) return;
      if (!frame.data.some(sample => Math.abs(sample) > 600)) return;
      timing.assistantAudio(at, frame.samplesPerChannel / frame.sampleRate * 1000);
    },
    reset(): void {
      if (epoch) { epoch.active = false; retiring.push(retire(epoch, false)); epoch = undefined; }
      timing.reset();
    },
    close(): Promise<void> {
      closeTask ??= (async () => {
        closed = true;
        if (epoch) await retire(epoch, true);
        await Promise.all(retiring);
      })();
      return closeTask;
    },
    snapshot: () => timing.snapshot(),
  };
}
