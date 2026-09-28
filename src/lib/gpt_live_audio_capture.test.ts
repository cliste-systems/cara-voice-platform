import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { createGptLiveAudioCapture } from './gpt_live_audio_capture.js';

const pcm = (data: Int16Array) => ({ data, sampleRate: 24000, channels: 1, samplesPerChannel: data.length });

async function savedFiles(directory: string) {
  const names = await readdir(directory);
  return {
    sourcePath: join(directory, names.find((name) => name.endsWith('-provider.wav'))!),
    outputPath: join(directory, names.find((name) => name.endsWith('-emitted.wav'))!),
    metadataPath: join(directory, names.find((name) => name.endsWith('-timing.json'))!),
  };
}

async function withDirectory(test: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), 'gpt-live-capture-test-'));
  const previous = process.env.CARA_GPT_LIVE_AUDIO_CAPTURE_DIR;
  process.env.CARA_GPT_LIVE_AUDIO_CAPTURE_DIR = directory;
  try { await test(directory); } finally {
    if (previous === undefined) delete process.env.CARA_GPT_LIVE_AUDIO_CAPTURE_DIR;
    else process.env.CARA_GPT_LIVE_AUDIO_CAPTURE_DIR = previous;
    await rm(directory, { recursive: true, force: true });
  }
}

describe('optional local GPT-Live assistant audio capture', () => {
  it('stays disabled without the explicit directory', () => {
    const previous = process.env.CARA_GPT_LIVE_AUDIO_CAPTURE_DIR;
    delete process.env.CARA_GPT_LIVE_AUDIO_CAPTURE_DIR;
    try { assert.equal(createGptLiveAudioCapture(), undefined); } finally {
      if (previous !== undefined) process.env.CARA_GPT_LIVE_AUDIO_CAPTURE_DIR = previous;
    }
  });

  it('copies PCM without modifying it, saves valid WAVs and timing once on close', async () => {
    await withDirectory(async (directory) => {
      const capture = createGptLiveAudioCapture()!;
      const samples = Int16Array.from([-32768, -10, 0, 32767]);
      capture.source(pcm(samples));
      capture.output(pcm(samples));
      assert.deepEqual([...samples], [-32768, -10, 0, 32767]);
      samples.fill(7);
      capture.output(pcm(new Int16Array(2)), true);
      capture.transcript('details ', { startMs: 1000, endMs: 1500 });
      capture.transcript('for the team', { startMs: 1500, endMs: 2300 });
      assert.deepEqual(await readdir(directory), []);
      const promise = capture.close();
      assert.equal(capture.close(), promise);
      await promise;
      const files = await savedFiles(directory);
      const source = await readFile(files.sourcePath);
      const output = await readFile(files.outputPath);
      assert.equal(source.toString('ascii', 0, 4), 'RIFF');
      assert.equal(source.toString('ascii', 8, 12), 'WAVE');
      assert.equal(source.readUInt32LE(24), 24000);
      assert.equal(source.readUInt16LE(22), 1);
      assert.equal(source.readUInt16LE(34), 16);
      assert.equal(source.readUInt32LE(40), 8);
      assert.deepEqual([0, 1, 2, 3].map((i) => source.readInt16LE(44 + i * 2)), [-32768, -10, 0, 32767]);
      assert.equal(output.readUInt32LE(40), 12);
      const metadata = JSON.parse(await readFile(files.metadataPath, 'utf8'));
      assert.equal(metadata.provider.frames[0].audioOffsetMs, 0);
      assert.equal(metadata.emitted.frames[1].audioOffsetMs, 4 / 24);
      assert.equal(metadata.emitted.frames[1].sampleOffset, 4);
      assert.equal(metadata.emitted.frames[1].syntheticSilence, true);
      assert.equal(metadata.transcriptDeltas.map((delta: { text: string }) => delta.text).join(''), 'details for the team');
      assert.ok(metadata.transcriptDeltas[1].arrivalOffsetMs >= metadata.transcriptDeltas[0].arrivalOffsetMs);
      assert.equal(metadata.transcriptDeltas[0].startMs, 1000);
      assert.equal(metadata.transcriptDeltas[1].endMs, 2300);
      capture.source(pcm(Int16Array.of(42)));
      assert.equal((await readFile(files.sourcePath)).length, source.length);
    });
  });

  it('caps audio at 120 seconds and bounds frame/transcript metadata', async () => {
    await withDirectory(async (directory) => {
      const capture = createGptLiveAudioCapture()!;
      for (let i = 0; i < 12001; i++) capture.source(pcm(Int16Array.of(1)));
      capture.source(pcm(new Int16Array(24000 * 120)));
      capture.transcript('a'.repeat(200001));
      await capture.close();
      const files = await savedFiles(directory);
      const metadata = JSON.parse(await readFile(files.metadataPath, 'utf8'));
      assert.equal(metadata.provider.samples, 24000 * 120);
      assert.equal(metadata.provider.truncated, true);
      assert.equal(metadata.provider.frames.length, 12000);
      assert.equal(metadata.provider.omittedFrameEvents, 2);
      assert.equal(metadata.transcriptDeltas[0].text.length, 200000);
      assert.equal(metadata.transcriptTruncated, true);
      assert.equal((await readFile(files.sourcePath)).length, 44 + 24000 * 120 * 2);
    });
  });

  it('skips unsupported formats and fails open on filesystem errors', async () => {
    await withDirectory(async (directory) => {
      const blocked = join(directory, 'file-instead-of-directory');
      await writeFile(blocked, 'occupied');
      process.env.CARA_GPT_LIVE_AUDIO_CAPTURE_DIR = blocked;
      const capture = createGptLiveAudioCapture()!;
      assert.doesNotThrow(() => capture.source({ ...pcm(Int16Array.of(1)), sampleRate: 48000 }));
      capture.source(pcm(Int16Array.of(2)));
      assert.equal(await capture.close(), undefined);
    });
  });

  it('uses distinct names for captures created together', async () => {
    await withDirectory(async (directory) => {
      const first = createGptLiveAudioCapture()!;
      const second = createGptLiveAudioCapture()!;
      await Promise.all([first.close(), second.close()]);
      assert.equal((await readdir(directory)).length, 6);
    });
  });
});
