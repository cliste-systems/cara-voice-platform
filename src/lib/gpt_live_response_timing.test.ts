import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ReadableStream, type ReadableStreamDefaultController } from 'node:stream/web';
import { VADEventType, type VAD, type VADEvent } from '@livekit/agents';
import { AudioFrame } from '@livekit/rtc-node';
import { GptLiveResponseTiming, createGptLiveResponseTiming } from './gpt_live_response_timing.js';

describe('GPT Live acoustic response timing', () => {
  it('measures once per caller turn, even when VAD completion arrives after output', () => {
    const timing = new GptLiveResponseTiming();
    timing.assistantAudio(100, 100); // Greeting.
    timing.callerSpeechStarted(500);
    timing.assistantAudio(2100, 20);
    timing.assistantAudio(2120, 20);
    timing.callerSpeechEnded(1600);
    assert.deepEqual(timing.snapshot().replyMs, [500]);
    assert.equal(timing.snapshot().replyTiming.measuredReplies, 1);
  });

  it('does not turn overlapping speech or missing replies into zero latency', () => {
    const timing = new GptLiveResponseTiming();
    timing.callerSpeechStarted(1000);
    timing.assistantAudio(1800, 400);
    timing.callerSpeechEnded(2000);
    timing.callerSpeechStarted(3000);
    timing.callerSpeechEnded(3500);
    assert.deepEqual(timing.snapshot().replyMs, []);
    assert.equal(timing.snapshot().replyTiming.overlappedTurns, 1);
    assert.equal(timing.snapshot().replyTiming.unpairedTurns, 1);
  });

  it('does not match an old unanswered turn with the next turn reply', () => {
    const timing = new GptLiveResponseTiming();
    timing.callerSpeechStarted(1000);
    timing.callerSpeechEnded(1500);
    timing.callerSpeechStarted(2000);
    timing.callerSpeechEnded(2500);
    timing.assistantAudio(3000, 100);
    assert.deepEqual(timing.snapshot().replyMs, [500]);
    assert.equal(timing.snapshot().replyTiming.unpairedTurns, 1);
  });

  it('preserves completed samples but never pairs across reconnects or mute boundaries', () => {
    const timing = new GptLiveResponseTiming();
    timing.callerSpeechStarted(1000);
    timing.callerSpeechEnded(1500);
    timing.assistantAudio(2000, 100);
    timing.callerSpeechStarted(2500);
    timing.callerSpeechEnded(3000);
    timing.reset();
    timing.assistantAudio(4000, 100);
    assert.deepEqual(timing.snapshot().replyMs, [500]);
    assert.equal(timing.snapshot().replyTiming.unpairedTurns, 1);
    assert.equal(timing.snapshot().replyTiming.observedCallerTurns, 2);
  });

  it('rejects invalid timestamps and preserves incomplete coverage', () => {
    const timing = new GptLiveResponseTiming();
    timing.callerSpeechStarted(NaN);
    timing.assistantAudio(Infinity, 20);
    timing.markIncomplete();
    timing.reset();
    assert.deepEqual(timing.snapshot().replyMs, []);
    assert.equal(timing.snapshot().replyTiming.captureComplete, false);
  });
});

function fakeVad() {
  const streams: Array<{
    emit(event: Partial<VADEvent> & Pick<VADEvent, 'type' | 'samplesIndex'>): void;
    frames: AudioFrame[];
  }> = [];
  const vad = { stream() {
    let events!: ReadableStreamDefaultController<VADEvent>;
    const output = new ReadableStream<VADEvent>({ start(controller) { events = controller; } });
    const reader = output.getReader();
    const frames: AudioFrame[] = [];
    streams.push({ emit(event) { events.enqueue({ timestamp: 0, speechDuration: 0, silenceDuration: 0, frames: [], probability: 0, inferenceDuration: 0, speaking: false, rawAccumulatedSilence: 0, rawAccumulatedSpeech: 0, ...event }); }, frames });
    return {
      updateInputStream(input: ReadableStream<AudioFrame>) {
        void (async () => { for await (const frame of input) frames.push(frame); })();
      },
      close() { events.close(); },
      next: () => reader.read(),
      [Symbol.asyncIterator]() { return this; },
    };
  } } as unknown as VAD;
  return { vad, streams };
}

const pcm = (value: number, ms = 32) => new AudioFrame(new Int16Array(16 * ms).fill(value), 16000, 1, 16 * ms);
const settle = () => new Promise<void>(resolve => setImmediate(resolve));

it('maps delayed Silero events to the actual input arrival timeline and excludes clips/silence', async () => {
  let at = 1000;
  const fake = fakeVad();
  const observer = createGptLiveResponseTiming(fake.vad, { now: () => at });
  const input = pcm(1500);
  for (let i = 0; i < 26; i++) { at += 32; observer.pushInput(input); }
  await settle();
  assert.equal(fake.streams[0]!.frames.length, 26);
  assert.ok(fake.streams[0]!.frames.every(frame => frame === input));
  fake.streams[0]!.emit({ type: VADEventType.START_OF_SPEECH, samplesIndex: 1024, speechDuration: 64 });
  observer.pushOutput(pcm(2000), 1400, { localClip: true });
  observer.pushOutput(pcm(2000), 1450, { syntheticSilence: true });
  observer.pushOutput(pcm(10), 1500);
  observer.pushOutput(pcm(2000), 1656);
  // 832 ms processed - 576 ms trailing silence = caller stopped at wall time 1256.
  fake.streams[0]!.emit({ type: VADEventType.END_OF_SPEECH, samplesIndex: 13312, silenceDuration: 576 });
  await settle();
  assert.deepEqual(observer.snapshot().replyMs, [400]);
  assert.equal(observer.snapshot().replyTiming.source, 'caller_vad_to_worker_audio');
  await observer.close();
  assert.equal(observer.snapshot().replyTiming.captureComplete, true);
});

it('drains pending VAD evidence on close and isolates reset epochs', async () => {
  const fake = fakeVad();
  let at = 1000;
  const observer = createGptLiveResponseTiming(fake.vad, { now: () => at });
  observer.pushInput(pcm(1000, 64));
  fake.streams[0]!.emit({ type: VADEventType.START_OF_SPEECH, samplesIndex: 1024, speechDuration: 64 });
  await settle();
  observer.reset();
  at = 2000;
  observer.pushInput(pcm(1000, 64));
  observer.pushOutput(pcm(2000), 2100);
  const closing = observer.close();
  assert.equal(observer.close(), closing);
  fake.streams[1]!.emit({ type: VADEventType.INFERENCE_DONE, samplesIndex: 1024 });
  await closing;
  assert.deepEqual(observer.snapshot().replyMs, []);
  assert.equal(observer.snapshot().replyTiming.unpairedTurns, 1);
});
