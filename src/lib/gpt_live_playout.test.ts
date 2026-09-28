import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ReadableStream, type ReadableStreamDefaultController } from 'node:stream/web';
import { AudioFrame } from '@livekit/rtc-node';
import type { DuplexAudioFrame } from '@livekit/agents';
import { PrebufferedPlayout } from './gpt_live_retail.js';

const pcm = (value: number, durationMs = 100) => new AudioFrame(
  new Int16Array(24 * durationMs).fill(value), 24000, 1, 24 * durationMs,
);

async function settleStreams() {
  // Let the source pump and the output consumer finish their pending stream reads.
  for (let i = 0; i < 12; i++) await Promise.resolve();
}

function harness(prebufferMs: number) {
  let source!: ReadableStreamDefaultController<DuplexAudioFrame>;
  const stream = new ReadableStream<DuplexAudioFrame>({ start(controller) { source = controller; } });
  const playout = new PrebufferedPlayout(stream, prebufferMs);
  const received: Array<{ frame: AudioFrame; at: number }> = [];
  const complete = (async () => {
    for await (const output of playout.stream) received.push({ frame: output.frame, at: Date.now() });
  })();
  return {
    received,
    playout,
    async push(frame: AudioFrame) {
      source.enqueue({ frame });
      await settleStreams();
    },
    async close() {
      source.close();
      await complete;
      await playout.waitForCapture();
    },
  };
}

describe('GPT-Live optional playout cushion', () => {
  it('keeps forwarding every audio frame if a diagnostic observer fails', async () => {
    const io = harness(0);
    io.playout.onOutputFrame = () => { throw new Error('Observer unavailable'); };
    const originals = [pcm(1000), pcm(2000)];
    for (const frame of originals) await io.push(frame);
    await io.close();
    assert.deepEqual(io.received.map(({ frame }) => frame), originals);
  });
  it('preserves every frame and adds nothing with the default zero cushion', async (t) => {
    t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1000 });
    const io = harness(0);
    const originals = [pcm(0), pcm(1), pcm(2), pcm(500), pcm(9000)];
    for (const frame of originals) {
      t.mock.timers.tick(175);
      await io.push(frame);
      assert.equal(io.received.at(-1)?.at, Date.now());
    }
    await io.close();
    assert.deepEqual(io.received.map(({ frame }) => frame), originals);
  });

  it('releases startup frames in order as soon as the target media is collected', async (t) => {
    t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1000 });
    const io = harness(200);
    const first = pcm(1500);
    const second = pcm(3000);
    await io.push(first);
    assert.equal(io.received.length, 0);
    t.mock.timers.tick(100);
    await io.push(second);
    assert.deepEqual(io.received.map(({ frame }) => frame), [first, second]);
    assert.deepEqual(io.received.map(({ at }) => at), [1100, 1100]);
    await io.close();
  });

  it('bounds startup waiting and never holds speech again after a later gap', async (t) => {
    t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1000 });
    const io = harness(200);
    const first = pcm(1800);
    await io.push(first);
    t.mock.timers.tick(199);
    await settleStreams();
    assert.equal(io.received.length, 0);
    t.mock.timers.tick(1);
    await settleStreams();
    assert.equal(io.received[0]?.frame, first);
    assert.equal(io.received[0]?.at, 1200);
    t.mock.timers.tick(500);
    const afterGap = pcm(3600);
    await io.push(afterGap);
    assert.equal(io.received[1]?.frame, afterGap);
    assert.equal(io.received[1]?.at, 1700);
    await io.close();
  });

  it('pads only after 200ms of digital silence, never quiet phonemes', async (t) => {
    t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1000 });
    const io = harness(200);
    const originals = [pcm(1000), pcm(1000), pcm(600), pcm(600), pcm(0), pcm(2), pcm(3), pcm(0)];
    await io.push(originals[0]!);
    await io.push(originals[1]!);
    for (const frame of originals.slice(2)) {
      t.mock.timers.tick(150);
      await io.push(frame);
    }
    await io.close();
    const providerFrames = io.received.filter(({ frame }) => frame.samplesPerChannel === 2400);
    assert.deepEqual(providerFrames.map(({ frame }) => frame), originals);
    const padding = io.received.filter(({ frame }) => frame.samplesPerChannel !== 2400);
    assert.equal(padding.length, 1);
    assert.equal(padding[0]?.frame.samplesPerChannel, 480);
    assert.equal(padding[0]?.frame.data.every((sample) => sample === 0), true);
    assert.equal(padding[0]?.at, 1600);
  });

  it('adds at most 20ms per frame and caps replenishment at the configured lead', async (t) => {
    t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1000 });
    const io = harness(200);
    await io.push(pcm(1000));
    await io.push(pcm(1000));
    t.mock.timers.tick(170);
    await io.push(pcm(0));
    for (let i = 0; i < 8; i++) {
      t.mock.timers.tick(100);
      await io.push(pcm(0));
    }
    await io.close();
    const paddingMs = io.received
      .filter(({ frame }) => frame.samplesPerChannel !== 2400)
      .map(({ frame }) => frame.samplesPerChannel / 24);
    assert.deepEqual(paddingMs, [20, 20, 20, 10]);
  });

  it('flushes a short final stream without waiting for the startup timer', async (t) => {
    t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1000 });
    const io = harness(200);
    const first = pcm(2000);
    await io.push(first);
    await io.close();
    assert.equal(io.received[0]?.frame, first);
    assert.equal(io.received[0]?.at, 1000);
    t.mock.timers.tick(300);
    assert.equal(io.received.length, 1);
  });

  it('finishes opted-in PCM and phrase capture without changing emitted speech', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'gpt-live-playout-test-'));
    const previous = process.env.CARA_GPT_LIVE_AUDIO_CAPTURE_DIR;
    process.env.CARA_GPT_LIVE_AUDIO_CAPTURE_DIR = directory;
    try {
      const io = harness(200);
      const frames = [pcm(1000), pcm(2000), pcm(0)];
      for (const frame of frames) await io.push(frame);
      io.playout.captureTranscript({ text: 'details for the team', startMs: 0, endMs: 200 });
      await io.close();
      assert.deepEqual(io.received.map(({ frame }) => frame), frames);
      const names = await readdir(directory);
      const provider = await readFile(join(directory, names.find((name) => name.endsWith('-provider.wav'))!));
      const emitted = await readFile(join(directory, names.find((name) => name.endsWith('-emitted.wav'))!));
      assert.deepEqual(provider, emitted);
      const metadata = JSON.parse(await readFile(join(directory, names.find((name) => name.endsWith('-timing.json'))!), 'utf8'));
      assert.equal(metadata.transcriptDeltas[0].text, 'details for the team');
      assert.equal(metadata.provider.frames.length, 3);
      assert.equal(metadata.emitted.frames.length, 3);
    } finally {
      if (previous === undefined) delete process.env.CARA_GPT_LIVE_AUDIO_CAPTURE_DIR;
      else process.env.CARA_GPT_LIVE_AUDIO_CAPTURE_DIR = previous;
      await rm(directory, { recursive: true, force: true });
    }
  });
});
