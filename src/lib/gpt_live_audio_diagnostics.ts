import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import type { AudioFrame } from '@livekit/rtc-node';

type PcmFrame = Pick<AudioFrame, 'data' | 'sampleRate' | 'channels' | 'samplesPerChannel'>;

/** Measurements at the wrapper boundary, not acknowledgments from the playback device. */
export class GptLiveAudioStats {
  private firstAt: number | undefined;
  private previousAt: number | undefined;
  private immediatePlayoutEndsAt = 0;
  private formats = new Set<string>();
  private frameDurations = new Set<number>();
  private sourceFrames = 0;
  private sourceSamples = 0;
  private sourceAudioMs = 0;
  private maxArrivalIntervalMs = 0;
  private estimatedEmptyMs = 0;
  private maxEstimatedGapMs = 0;
  private hardClippedSamples = 0;
  private peak = 0;
  private emittedAudioMs = 0;
  private insertedSilenceMs = 0;
  private maxWrapperQueuedFrames = 0;
  private recentEstimatedGaps: Array<{ offsetMs: number; gapMs: number; nextFramePeak: number }> = [];

  observeSource(frame: PcmFrame, now: number): void {
    const duration = (frame.samplesPerChannel / frame.sampleRate) * 1000;
    const firstFrame = this.firstAt === undefined;
    this.firstAt ??= now;
    this.formats.add(`${frame.sampleRate}Hz/${frame.channels}ch`);
    this.frameDurations.add(Math.round(duration * 1000) / 1000);
    this.sourceFrames++;
    this.sourceSamples += frame.data.length;
    this.sourceAudioMs += duration;
    let peak = 0;
    for (const sample of frame.data) {
      const absolute = Math.abs(sample);
      peak = Math.max(peak, absolute);
      if (absolute >= 32760) this.hardClippedSamples++;
    }
    this.peak = Math.max(this.peak, peak);
    if (this.previousAt !== undefined) {
      this.maxArrivalIntervalMs = Math.max(this.maxArrivalIntervalMs, now - this.previousAt);
    }
    // This deliberately assumes immediate playback. Native queue depth is not available here.
    // An actual downstream prebuffer can absorb these gaps, so they are not proven underruns.
    const gap = firstFrame ? 0 : Math.max(0, now - this.immediatePlayoutEndsAt);
    this.estimatedEmptyMs += gap;
    this.maxEstimatedGapMs = Math.max(this.maxEstimatedGapMs, gap);
    if (gap >= 10) {
      this.recentEstimatedGaps.push({
        offsetMs: Math.round(now - this.firstAt),
        gapMs: Math.round(gap),
        nextFramePeak: peak,
      });
      if (this.recentEstimatedGaps.length > 8) this.recentEstimatedGaps.shift();
    }
    this.immediatePlayoutEndsAt = Math.max(this.immediatePlayoutEndsAt, now) + duration;
    this.previousAt = now;
  }

  observeOutput(frame: PcmFrame, wrapperQueuedFrames: number, syntheticSilence: boolean): void {
    const duration = (frame.samplesPerChannel / frame.sampleRate) * 1000;
    this.emittedAudioMs += duration;
    if (syntheticSilence) this.insertedSilenceMs += duration;
    this.maxWrapperQueuedFrames = Math.max(this.maxWrapperQueuedFrames, wrapperQueuedFrames);
  }

  snapshot(now: number) {
    const round = (value: number) => Math.round(value * 100) / 100;
    return {
      sourceFrames: this.sourceFrames,
      sourceSamples: this.sourceSamples,
      formats: [...this.formats],
      frameDurationsMs: [...this.frameDurations].sort((a, b) => a - b),
      sourceAudioMs: round(this.sourceAudioMs),
      sourceWallMs: this.firstAt === undefined ? 0 : round(now - this.firstAt),
      maxArrivalIntervalMs: round(this.maxArrivalIntervalMs),
      estimatedImmediatePlayoutEmptyMs: round(this.estimatedEmptyMs),
      maxEstimatedImmediatePlayoutGapMs: round(this.maxEstimatedGapMs),
      recentEstimatedGaps: this.recentEstimatedGaps.map((gap) => ({ ...gap })),
      peak: this.peak,
      hardClippedSamples: this.hardClippedSamples,
      emittedAudioMs: round(this.emittedAudioMs),
      insertedSilenceMs: round(this.insertedSilenceMs),
      maxWrapperQueuedFrames: this.maxWrapperQueuedFrames,
    };
  }
}

/** Logs numeric counters only. Never records microphone audio, output PCM, or transcript text. */
export function createGptLiveAudioDiagnostics(prebufferMs: number) {
  if (process.env.CARA_GPT_LIVE_AUDIO_DIAGNOSTICS?.trim() !== '1') return undefined;
  const stats = new GptLiveAudioStats();
  const id = randomUUID().slice(0, 8);
  let lastReport = performance.now();
  const report = (reason: 'interval' | 'closed' | 'error', now: number) => {
    console.info('[gpt_live_audio]', JSON.stringify({
      id,
      reason,
      at: new Date().toISOString(),
      prebufferMs,
      measurement: 'source delivery and wrapper queue; playout gaps are estimates, not device underruns',
      ...stats.snapshot(now),
    }));
    lastReport = now;
  };
  return {
    source(frame: PcmFrame) {
      const now = performance.now();
      stats.observeSource(frame, now);
      if (now - lastReport >= 5000) report('interval', now);
    },
    output(frame: PcmFrame, wrapperQueuedFrames: number, syntheticSilence = false) {
      stats.observeOutput(frame, wrapperQueuedFrames, syntheticSilence);
    },
    close(reason: 'closed' | 'error') {
      report(reason, performance.now());
    },
  };
}
