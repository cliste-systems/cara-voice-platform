import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { GptLiveAudioStats, createGptLiveAudioDiagnostics } from './gpt_live_audio_diagnostics.js';

const frame = (samples = 2400, value = 0) => ({
  data: new Int16Array(samples).fill(value),
  sampleRate: 24000,
  channels: 1,
  samplesPerChannel: samples,
});

describe('GPT-Live PCM diagnostics', () => {
  it('does not count the initial wait as an audio gap', () => {
    const stats = new GptLiveAudioStats();
    stats.observeSource(frame(), 5000);
    stats.observeSource(frame(), 5100);
    const result = stats.snapshot(5100);
    assert.equal(result.sourceAudioMs, 200);
    assert.equal(result.estimatedImmediatePlayoutEmptyMs, 0);
    assert.deepEqual(result.formats, ['24000Hz/1ch']);
  });

  it('accounts for earlier media arriving in a burst before estimating starvation', () => {
    const stats = new GptLiveAudioStats();
    stats.observeSource(frame(), 1000);
    stats.observeSource(frame(), 1000);
    stats.observeSource(frame(), 1180);
    assert.equal(stats.snapshot(1180).estimatedImmediatePlayoutEmptyMs, 0);
    stats.observeSource(frame(2400, 900), 1360);
    const result = stats.snapshot(1360);
    assert.equal(result.estimatedImmediatePlayoutEmptyMs, 60);
    assert.equal(result.maxArrivalIntervalMs, 180);
    assert.deepEqual(result.recentEstimatedGaps, [{ offsetMs: 360, gapMs: 60, nextFramePeak: 900 }]);
  });

  it('counts signed clipping without modifying PCM', () => {
    const stats = new GptLiveAudioStats();
    const pcm = frame(4);
    pcm.data.set([-32768, 32767, 1500, -1200]);
    const before = [...pcm.data];
    stats.observeSource(pcm, 0);
    const result = stats.snapshot(0);
    assert.equal(result.hardClippedSamples, 2);
    assert.equal(result.peak, 32768);
    assert.deepEqual([...pcm.data], before);
  });

  it('distinguishes injected silence from source media and wrapper backlog', () => {
    const stats = new GptLiveAudioStats();
    stats.observeSource(frame(), 0);
    stats.observeOutput(frame(), 0, false);
    stats.observeOutput(frame(), 2, true);
    const result = stats.snapshot(0);
    assert.equal(result.sourceAudioMs, 100);
    assert.equal(result.emittedAudioMs, 200);
    assert.equal(result.insertedSilenceMs, 100);
    assert.equal(result.maxWrapperQueuedFrames, 2);
  });

  it('is disabled unless explicitly opted in', () => {
    const previous = process.env.CARA_GPT_LIVE_AUDIO_DIAGNOSTICS;
    delete process.env.CARA_GPT_LIVE_AUDIO_DIAGNOSTICS;
    try {
      assert.equal(createGptLiveAudioDiagnostics(0), undefined);
    } finally {
      if (previous === undefined) delete process.env.CARA_GPT_LIVE_AUDIO_DIAGNOSTICS;
      else process.env.CARA_GPT_LIVE_AUDIO_DIAGNOSTICS = previous;
    }
  });
});
