import { createHash } from 'node:crypto';
import { open, realpath } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { AudioFrame } from '@livekit/rtc-node';

const SAMPLE_RATE = 24000;
const FRAME_SAMPLES = SAMPLE_RATE / 50;
const MAX_MANIFEST_BYTES = 16000;
const MAX_AUDIO_FILE_BYTES = 1100000;
const MAX_PCM_BYTES = SAMPLE_RATE * 2 * 20;

export type GptLiveVerifiedOpening = { text: string; frames: AudioFrame[]; durationMs: number };

function invalid(reason: string): never {
  throw new Error(`Verified GPT-Live opening rejected: ${reason}`);
}

async function readBoundedFile(path: string, limit: number): Promise<Buffer> {
  const file = await open(path, 'r');
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > limit) invalid('file is not regular or exceeds its size limit');
    // The extra byte detects growth after stat without allowing an unbounded read.
    const bytes = Buffer.alloc(limit + 1);
    let used = 0;
    while (used < bytes.length) {
      const result = await file.read(bytes, used, bytes.length - used, null);
      if (!result.bytesRead) break;
      used += result.bytesRead;
    }
    if (used > limit) invalid('file exceeds its size limit');
    return bytes.subarray(0, used);
  } finally {
    await file.close();
  }
}

function normalizedWords(text: string): string {
  const words = text.normalize('NFKC').toLowerCase().replace(/['\u2018\u2019]/g, '')
    .match(/[\p{L}\p{N}]+/gu)?.join(' ') ?? '';
  // Fixed spelling aliases observed in independent ASR of this retailer's name.
  // No fuzzy matching or changes to any other words are permitted.
  return words.replace(/\bcavanaghs\b/g, 'kavanaghs').replace(/\bsuper value\b/g, 'supervalu');
}

function parseWav(bytes: Buffer): Buffer {
  if (bytes.length < 12 || bytes.toString('ascii', 0, 4) !== 'RIFF' ||
      bytes.toString('ascii', 8, 12) !== 'WAVE' || bytes.readUInt32LE(4) + 8 !== bytes.length) {
    invalid('invalid or truncated RIFF/WAVE container');
  }
  let formatSeen = false;
  const data: Buffer[] = [];
  let pcmBytes = 0;
  let offset = 12;
  while (offset < bytes.length) {
    if (offset + 8 > bytes.length) invalid('truncated WAV chunk header');
    const kind = bytes.toString('ascii', offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    const start = offset + 8;
    const end = start + size;
    const next = end + (size % 2);
    if (next > bytes.length) invalid('truncated WAV chunk payload');
    if (kind === 'fmt ') {
      if (formatSeen || size < 16) invalid('missing or duplicate WAV format');
      formatSeen = true;
      if (bytes.readUInt16LE(start) !== 1 || bytes.readUInt16LE(start + 2) !== 1 ||
          bytes.readUInt32LE(start + 4) !== SAMPLE_RATE || bytes.readUInt32LE(start + 8) !== 48000 ||
          bytes.readUInt16LE(start + 12) !== 2 || bytes.readUInt16LE(start + 14) !== 16) {
        invalid('audio must be PCM16 little-endian, mono, 24000 Hz');
      }
    } else if (kind === 'data') {
      if (size % 2) invalid('PCM data contains an incomplete sample');
      pcmBytes += size;
      if (pcmBytes > MAX_PCM_BYTES) invalid('audio exceeds 20 seconds');
      data.push(bytes.subarray(start, end));
    }
    offset = next;
  }
  if (!formatSeen || !pcmBytes) invalid('audio is empty or has no PCM format');
  return Buffer.concat(data, pcmBytes);
}

/** Unset means disabled. Once configured, any verification failure must stop the opening. */
export async function loadGptLiveVerifiedOpening(
  expectedText: string,
  voice: string,
): Promise<GptLiveVerifiedOpening | undefined> {
  const configured = process.env.CARA_GPT_LIVE_OPENING_MANIFEST?.trim();
  if (!configured) return undefined;
  const manifestPath = resolve(configured);
  const raw: unknown = JSON.parse((await readBoundedFile(manifestPath, MAX_MANIFEST_BYTES)).toString('utf8'));
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) invalid('manifest must be an object');
  const manifest = raw as Record<string, unknown>;
  if (manifest.version !== 1 || manifest.model !== 'gpt-live-1') invalid('unsupported manifest version or model');
  if (manifest.voice !== voice) invalid('voice does not match this call');
  const text = expectedText.trim();
  if (!text || typeof manifest.text !== 'string' || manifest.text.trim() !== text) {
    invalid('greeting text does not match this call exactly');
  }
  if (typeof manifest.independentTranscript !== 'string' || !normalizedWords(text) ||
      normalizedWords(manifest.independentTranscript) !== normalizedWords(text)) {
    invalid('independent transcript does not match the greeting words');
  }
  if (typeof manifest.sha256 !== 'string' || !/^[a-fA-F0-9]{64}$/.test(manifest.sha256)) {
    invalid('missing or invalid SHA-256');
  }
  const filename = manifest.audioFile;
  if (typeof filename !== 'string' || !filename || filename === '.' || filename === '..' ||
      basename(filename) !== filename || /[\\/\0]/.test(filename)) {
    invalid('audioFile must be a filename inside the manifest directory');
  }
  const directory = await realpath(dirname(manifestPath));
  const audioPath = await realpath(join(directory, filename));
  if (dirname(audioPath) !== directory) invalid('audioFile resolves outside the manifest directory');
  const audio = await readBoundedFile(audioPath, MAX_AUDIO_FILE_BYTES);
  if (createHash('sha256').update(audio).digest('hex') !== manifest.sha256.toLowerCase()) {
    invalid('audio SHA-256 does not match the verified asset');
  }
  const pcm = parseWav(audio);
  const samples = pcm.length / 2;
  const frames: AudioFrame[] = [];
  for (let offset = 0; offset < samples; offset += FRAME_SAMPLES) {
    const count = Math.min(FRAME_SAMPLES, samples - offset);
    const data = new Int16Array(count);
    for (let i = 0; i < count; i++) data[i] = pcm.readInt16LE((offset + i) * 2);
    frames.push(new AudioFrame(data, SAMPLE_RATE, 1, count));
  }
  return { text, frames, durationMs: samples * 1000 / SAMPLE_RATE };
}
