import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { loadGptLiveVerifiedOpening } from './gpt_live_verified_opening.js';

const TEXT = "Hello, I'm Cara. How can I help you today?";

function chunk(name: string, payload: Buffer): Buffer {
  const header = Buffer.alloc(8);
  header.write(name, 0);
  header.writeUInt32LE(payload.length, 4);
  return Buffer.concat([header, payload, Buffer.alloc(payload.length % 2)]);
}

function wav(samples = 1000, rate = 24000): Buffer {
  const fmt = Buffer.alloc(18);
  fmt.writeUInt16LE(1, 0);
  fmt.writeUInt16LE(1, 2);
  fmt.writeUInt32LE(rate, 4);
  fmt.writeUInt32LE(rate * 2, 8);
  fmt.writeUInt16LE(2, 12);
  fmt.writeUInt16LE(16, 14);
  const pcm = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) pcm.writeInt16LE(i % 100, i * 2);
  const body = Buffer.concat([
    Buffer.from('WAVE'), chunk('JUNK', Buffer.from('odd')),
    chunk('fmt ', fmt), chunk('data', pcm), chunk('LIST', Buffer.from('metadata')),
  ]);
  const head = Buffer.alloc(8);
  head.write('RIFF', 0);
  head.writeUInt32LE(body.length, 4);
  return Buffer.concat([head, body]);
}

async function fixture(test: (directory: string, save: (audio?: Buffer, overrides?: Record<string, unknown>) => Promise<void>) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), 'gpt-live-verified-opening-'));
  const previous = process.env.CARA_GPT_LIVE_OPENING_MANIFEST;
  process.env.CARA_GPT_LIVE_OPENING_MANIFEST = join(directory, 'manifest.json');
  const save = async (audio = wav(), overrides: Record<string, unknown> = {}) => {
    await writeFile(join(directory, 'opening.wav'), audio);
    await writeFile(join(directory, 'manifest.json'), JSON.stringify({
      version: 1, model: 'gpt-live-1', voice: 'willow', text: TEXT,
      audioFile: 'opening.wav', sha256: createHash('sha256').update(audio).digest('hex'),
      independentTranscript: 'HELLO! Im Cara - how can I help you today.', ...overrides,
    }));
  };
  try { await save(); await test(directory, save); } finally {
    if (previous === undefined) delete process.env.CARA_GPT_LIVE_OPENING_MANIFEST;
    else process.env.CARA_GPT_LIVE_OPENING_MANIFEST = previous;
    await rm(directory, { recursive: true, force: true });
  }
}

describe('verified GPT-Live opening loader', () => {
  it('is disabled unless an explicit manifest is configured', async () => {
    const previous = process.env.CARA_GPT_LIVE_OPENING_MANIFEST;
    delete process.env.CARA_GPT_LIVE_OPENING_MANIFEST;
    try { assert.equal(await loadGptLiveVerifiedOpening(TEXT, 'willow'), undefined); } finally {
      if (previous !== undefined) process.env.CARA_GPT_LIVE_OPENING_MANIFEST = previous;
    }
  });

  it('verifies a variable-chunk WAV and splits PCM into 20ms frames without changing samples', async () => {
    await fixture(async () => {
      const opening = (await loadGptLiveVerifiedOpening(` ${TEXT} `, 'willow'))!;
      assert.equal(opening.text, TEXT);
      assert.equal(opening.durationMs, 1000 / 24);
      assert.deepEqual(opening.frames.map((frame) => frame.samplesPerChannel), [480, 480, 40]);
      assert.ok(opening.frames.every((frame) => frame.sampleRate === 24000 && frame.channels === 1));
      assert.deepEqual(opening.frames.flatMap((frame) => [...frame.data]), Array.from({ length: 1000 }, (_, i) => i % 100));
    });
  });

  it('fails closed for mismatched voice, exact text, model, independent words, and hash', async () => {
    await fixture(async (_directory, save) => {
      for (const overrides of [
        { voice: 'marin' }, { text: TEXT.replace('Hello,', 'Hello!') },
        { model: 'another-model' }, { version: 2 },
        { independentTranscript: 'A story about a dog.' }, { sha256: '0'.repeat(64) },
      ]) {
        await save(wav(), overrides);
        await assert.rejects(loadGptLiveVerifiedOpening(TEXT, 'willow'), /Verified GPT-Live opening rejected/);
      }
    });
  });

  it('accepts only the fixed retailer spelling aliases in independent transcription', async () => {
    await fixture(async (_directory, save) => {
      const greeting = "Hello, you're through to Kavanaghs SuperValu Donegal Town. I'm Cara.";
      const independentTranscript = "Hello, you're through to Cavanagh's Super Value Donegal Town. I'm Cara.";
      await save(wav(), { text: greeting, independentTranscript });
      assert.equal((await loadGptLiveVerifiedOpening(greeting, 'willow'))?.text, greeting);
      await save(wav(), { text: greeting, independentTranscript: independentTranscript.replace('Donegal', 'Dublin') });
      await assert.rejects(loadGptLiveVerifiedOpening(greeting, 'willow'), /independent transcript/);
    });
  });

  it('rejects wrong format, zero duration, over 20 seconds, and malformed chunk sizes', async () => {
    await fixture(async (_directory, save) => {
      const malformed = wav();
      malformed.writeUInt32LE(0xffffffff, 16);
      for (const audio of [wav(1000, 48000), wav(0), wav(480001), malformed, Buffer.from('not WAV')]) {
        await save(audio);
        await assert.rejects(loadGptLiveVerifiedOpening(TEXT, 'willow'), /Verified GPT-Live opening rejected/);
      }
    });
  });

  it('bounds audio and manifest file reads', async () => {
    await fixture(async (directory, save) => {
      await save(Buffer.alloc(1100001));
      await assert.rejects(loadGptLiveVerifiedOpening(TEXT, 'willow'), /size limit/);
      await writeFile(join(directory, 'manifest.json'), ' '.repeat(16001));
      await assert.rejects(loadGptLiveVerifiedOpening(TEXT, 'willow'), /size limit/);
    });
  });

  it('rejects path traversal and symlinks outside the manifest directory', async () => {
    await fixture(async (directory, save) => {
      for (const audioFile of ['../opening.wav', '/tmp/opening.wav', '..\\opening.wav', '.', '..']) {
        await save(wav(), { audioFile });
        await assert.rejects(loadGptLiveVerifiedOpening(TEXT, 'willow'), /filename/);
      }
      const outside = await mkdtemp(join(tmpdir(), 'gpt-live-opening-outside-'));
      try {
        await writeFile(join(outside, 'outside.wav'), wav());
        await symlink(join(outside, 'outside.wav'), join(directory, 'link.wav'));
        await save(wav(), { audioFile: 'link.wav' });
        await assert.rejects(loadGptLiveVerifiedOpening(TEXT, 'willow'), /outside/);
      } finally { await rm(outside, { recursive: true, force: true }); }
    });
  });
});
