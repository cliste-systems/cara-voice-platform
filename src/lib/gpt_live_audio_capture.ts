import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import type { AudioFrame } from '@livekit/rtc-node';

type PcmFrame = Pick<AudioFrame, 'data' | 'sampleRate' | 'channels' | 'samplesPerChannel'>;
export type GptLiveAudioCaptureFiles = { sourcePath: string; outputPath: string; metadataPath: string };
export type GptLiveAudioCapture = {
  source(frame: PcmFrame): void;
  output(frame: PcmFrame, syntheticSilence?: boolean, localClip?: boolean): void;
  transcript(delta: string, timing?: { startMs?: number; endMs?: number }): void;
  close(): Promise<void>;
};

const SAMPLE_RATE = 24000;
const MAX_SAMPLES = SAMPLE_RATE * 120;
const MAX_FRAME_EVENTS = 12000;
const MAX_TRANSCRIPT_EVENTS = 4000;
const MAX_TRANSCRIPT_CHARACTERS = 200000;

type FrameEvent = {
  arrivalOffsetMs: number;
  sampleOffset: number;
  audioOffsetMs: number;
  originalSamples: number;
  capturedSamples: number;
  syntheticSilence: boolean;
  localClip: boolean;
};
type Lane = {
  pcm?: Buffer;
  samples: number;
  frames: FrameEvent[];
  omittedFrameEvents: number;
  truncated: boolean;
  unsupportedFrames: number;
};

function wav(pcm: Buffer): Buffer {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

/** Explicit opt-in, local assistant audio only. No microphone input or remote storage. */
export function createGptLiveAudioCapture(): GptLiveAudioCapture | undefined {
  const configuredDirectory = process.env.CARA_GPT_LIVE_AUDIO_CAPTURE_DIR?.trim();
  if (!configuredDirectory) return undefined;
  try {
    const directory = resolve(configuredDirectory);
    const startedAt = new Date().toISOString();
    const startedClock = performance.now();
    const prefix = `gpt-live-${startedAt.replace(/[:.]/g, '-')}-${randomUUID()}`;
    const files = {
      sourcePath: join(directory, `${prefix}-provider.wav`),
      outputPath: join(directory, `${prefix}-emitted.wav`),
      metadataPath: join(directory, `${prefix}-timing.json`),
    };
    const newLane = (): Lane => ({
      samples: 0, frames: [], omittedFrameEvents: 0, truncated: false, unsupportedFrames: 0,
    });
    const provider = newLane();
    const emitted = newLane();
    const transcriptDeltas: Array<{
      arrivalOffsetMs: number; text: string; startMs?: number; endMs?: number;
    }> = [];
    let transcriptCharacters = 0;
    let transcriptTruncated = false;
    let closed = false;
    let closePromise: Promise<void> | undefined;
    const errors: string[] = [];
    const noteError = (error: unknown) => {
      if (errors.length < 8) errors.push(error instanceof Error ? error.message : String(error));
    };
    const offset = () => Math.round((performance.now() - startedClock) * 1000) / 1000;

    const capture = (lane: Lane, frame: PcmFrame, syntheticSilence = false, localClip = false): void => {
      if (closed) return;
      try {
        if (frame.sampleRate !== SAMPLE_RATE || frame.channels !== 1 ||
            !Number.isSafeInteger(frame.samplesPerChannel) || frame.samplesPerChannel < 0 ||
            frame.data.length !== frame.samplesPerChannel) {
          lane.unsupportedFrames++;
          return;
        }
        const samples = Math.min(frame.samplesPerChannel, MAX_SAMPLES - lane.samples);
        if (samples < frame.samplesPerChannel) lane.truncated = true;
        if (!samples) return;
        const arrivalOffsetMs = offset();
        lane.pcm ??= Buffer.alloc(MAX_SAMPLES * 2);
        const byteOffset = lane.samples * 2;
        // Copy immediately: RTC frames may be reused after the callback returns.
        for (let i = 0; i < samples; i++) lane.pcm.writeInt16LE(frame.data[i]!, byteOffset + i * 2);
        if (lane.frames.length < MAX_FRAME_EVENTS) {
          lane.frames.push({
            arrivalOffsetMs,
            sampleOffset: lane.samples,
            audioOffsetMs: lane.samples * 1000 / SAMPLE_RATE,
            originalSamples: frame.samplesPerChannel,
            capturedSamples: samples,
            syntheticSilence,
            localClip,
          });
        } else {
          lane.omittedFrameEvents++;
        }
        lane.samples += samples;
      } catch (error) {
        noteError(error);
      }
    };

    console.info('[gpt_live_audio_capture] enabled', JSON.stringify({
      directory, maxAudioSecondsPerFile: 120, ...files,
    }));
    return {
      source(frame) { capture(provider, frame); },
      output(frame, syntheticSilence = false, localClip = false) { capture(emitted, frame, syntheticSilence, localClip); },
      transcript(delta, timing) {
        if (closed || !delta) return;
        try {
          const remaining = MAX_TRANSCRIPT_CHARACTERS - transcriptCharacters;
          if (remaining <= 0 || transcriptDeltas.length >= MAX_TRANSCRIPT_EVENTS) {
            transcriptTruncated = true;
            return;
          }
          const text = delta.slice(0, remaining);
          transcriptDeltas.push({
            arrivalOffsetMs: offset(),
            text,
            ...(typeof timing?.startMs === 'number' && Number.isFinite(timing.startMs)
              ? { startMs: timing.startMs } : {}),
            ...(typeof timing?.endMs === 'number' && Number.isFinite(timing.endMs)
              ? { endMs: timing.endMs } : {}),
          });
          transcriptCharacters += text.length;
          if (text.length < delta.length) transcriptTruncated = true;
        } catch (error) {
          noteError(error);
        }
      },
      close() {
        if (closePromise) return closePromise;
        closed = true;
        closePromise = (async () => {
          try {
            const laneMetadata = (lane: Lane) => ({
              samples: lane.samples,
              audioMs: lane.samples * 1000 / SAMPLE_RATE,
              truncated: lane.truncated,
              unsupportedFrames: lane.unsupportedFrames,
              omittedFrameEvents: lane.omittedFrameEvents,
              frames: lane.frames,
            });
            const metadata = {
              startedAt,
              closedAt: new Date().toISOString(),
              format: { sampleRate: SAMPLE_RATE, channels: 1, encoding: 'PCM16LE' },
              maxAudioSecondsPerFile: 120,
              maxFrameEventsPerFile: MAX_FRAME_EVENTS,
              notes: 'WAVs concatenate PCM in order. Arrival gaps are in metadata, not inserted into WAVs. Emitted audio is before native playback and network delivery. Transcript arrival times are not word timestamps; optional startMs/endMs are unchanged provider timestamps. Synthetic output padding changes the emitted timeline; use per-frame sample offsets and flags to align it with provider audio.',
              provider: laneMetadata(provider),
              emitted: laneMetadata(emitted),
              transcriptDeltas,
              transcriptTruncated,
              errors,
            };
            await mkdir(directory, { recursive: true, mode: 0o700 });
            const sourcePcm = provider.pcm?.subarray(0, provider.samples * 2) ?? Buffer.alloc(0);
            const outputPcm = emitted.pcm?.subarray(0, emitted.samples * 2) ?? Buffer.alloc(0);
            // All filesystem work is asynchronous and happens once, after capture ends.
            await Promise.all([
              writeFile(files.sourcePath, wav(sourcePcm), { flag: 'wx', mode: 0o600 }),
              writeFile(files.outputPath, wav(outputPcm), { flag: 'wx', mode: 0o600 }),
              writeFile(files.metadataPath, JSON.stringify(metadata, null, 2), { flag: 'wx', mode: 0o600 }),
            ]);
            console.info('[gpt_live_audio_capture]', JSON.stringify(files));
          } catch (error) {
            console.warn('[gpt_live_audio_capture] local save failed', error instanceof Error ? error.message : String(error));
          } finally {
            delete provider.pcm;
            delete emitted.pcm;
            provider.frames.length = 0;
            emitted.frames.length = 0;
            transcriptDeltas.length = 0;
          }
        })();
        return closePromise;
      },
    };
  } catch (error) {
    console.warn('[gpt_live_audio_capture] disabled after setup error', error instanceof Error ? error.message : String(error));
    return undefined;
  }
}
