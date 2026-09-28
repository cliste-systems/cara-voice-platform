import { AudioFrame } from '@livekit/rtc-node';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildGptLiveRetailOpeningInstructions,
  GPT_LIVE_RETAIL_VOICE_DEFAULT,
  gptLiveUtteranceEndsWithFarewell,
  resolveGptLiveAudioQueueMs,
  resolveGptLiveBurstTimeoutMs,
  isSilentFrame,
  resolveGptLivePrebufferMs,
  resolveGptLiveRetailVoice,
  shouldUseGptLiveRetailStack,
} from './gpt_live_retail.js';

describe('gpt_live_retail', () => {
  it('enables GPT-Live on conversational retail by default', () => {
    const prev = process.env.CARA_GPT_LIVE_RETAIL;
    delete process.env.CARA_GPT_LIVE_RETAIL;
    try {
      assert.equal(shouldUseGptLiveRetailStack({ conversationalRetailLine: true }), true);
      assert.equal(shouldUseGptLiveRetailStack({ conversationalRetailLine: false }), false);
    } finally {
      if (prev === undefined) delete process.env.CARA_GPT_LIVE_RETAIL;
      else process.env.CARA_GPT_LIVE_RETAIL = prev;
    }
  });

  it('can disable GPT-Live via env', () => {
    const prev = process.env.CARA_GPT_LIVE_RETAIL;
    process.env.CARA_GPT_LIVE_RETAIL = '0';
    try {
      assert.equal(shouldUseGptLiveRetailStack({ conversationalRetailLine: true }), false);
    } finally {
      if (prev === undefined) delete process.env.CARA_GPT_LIVE_RETAIL;
      else process.env.CARA_GPT_LIVE_RETAIL = prev;
    }
  });

  it('defaults voice to willow', () => {
    const prev = process.env.CARA_GPT_LIVE_VOICE;
    delete process.env.CARA_GPT_LIVE_VOICE;
    try {
      assert.equal(resolveGptLiveRetailVoice(), GPT_LIVE_RETAIL_VOICE_DEFAULT);
    } finally {
      if (prev === undefined) delete process.env.CARA_GPT_LIVE_VOICE;
      else process.env.CARA_GPT_LIVE_VOICE = prev;
    }
  });

  it('asks for the opening word for word', () => {
    const instructions = buildGptLiveRetailOpeningInstructions(
      "Hello, you're through to Kavanaghs. I'm Cara.",
    );
    assert.match(instructions, /word for word/);
    assert.match(instructions, /"Hello, you're through to Kavanaghs\. I'm Cara\."/);
  });

  it('detects a goodbye only at the end of an utterance', () => {
    assert.equal(
      gptLiveUtteranceEndsWithFarewell(
        'Lovely — thanks for calling Kavanaghs SuperValu Donegal Town, take care.',
      ),
      true,
    );
    assert.equal(
      gptLiveUtteranceEndsWithFarewell(
        "No bother — I'll pass that to the bakery. Thanks for calling Kavanaghs, take care now, bye.",
      ),
      true,
    );
    assert.equal(gptLiveUtteranceEndsWithFarewell("No bother — I'll pass that to the bakery for you."), false);
    assert.equal(gptLiveUtteranceEndsWithFarewell('Is that everything for you?'), false);
  });

  it('defaults GPT-Live RoomIO audio queue to 8000ms', () => {
    const prev = process.env.CARA_GPT_LIVE_AUDIO_QUEUE_MS;
    delete process.env.CARA_GPT_LIVE_AUDIO_QUEUE_MS;
    try {
      assert.equal(resolveGptLiveAudioQueueMs(), 8000);
      process.env.CARA_GPT_LIVE_AUDIO_QUEUE_MS = '4000';
      assert.equal(resolveGptLiveAudioQueueMs(), 4000);
    } finally {
      if (prev === undefined) delete process.env.CARA_GPT_LIVE_AUDIO_QUEUE_MS;
      else process.env.CARA_GPT_LIVE_AUDIO_QUEUE_MS = prev;
    }
  });

  it('defaults GPT-Live duplex burst timeout to 8000ms', () => {
    const prev = process.env.CARA_GPT_LIVE_BURST_TIMEOUT_MS;
    delete process.env.CARA_GPT_LIVE_BURST_TIMEOUT_MS;
    try {
      assert.equal(resolveGptLiveBurstTimeoutMs(), 8000);
      process.env.CARA_GPT_LIVE_BURST_TIMEOUT_MS = '12000';
      assert.equal(resolveGptLiveBurstTimeoutMs(), 12000);
    } finally {
      if (prev === undefined) delete process.env.CARA_GPT_LIVE_BURST_TIMEOUT_MS;
      else process.env.CARA_GPT_LIVE_BURST_TIMEOUT_MS = prev;
    }
  });

  it('treats only near-zero PCM frames as silent', () => {
    const quiet = new Int16Array(2400).fill(120);
    const speech = new Int16Array(2400).fill(120);
    speech[1200] = 9000;
    assert.equal(isSilentFrame(new AudioFrame(quiet, 24000, 1, 2400)), true);
    assert.equal(isSilentFrame(new AudioFrame(speech, 24000, 1, 2400)), false);
  });

  it('defaults GPT-Live prebuffer to 0ms so audio is unmodified', () => {
    const prev = process.env.CARA_GPT_LIVE_PREBUFFER_MS;
    delete process.env.CARA_GPT_LIVE_PREBUFFER_MS;
    try {
      assert.equal(resolveGptLivePrebufferMs(), 0);
      process.env.CARA_GPT_LIVE_PREBUFFER_MS = '0';
      assert.equal(resolveGptLivePrebufferMs(), 0);
    } finally {
      if (prev === undefined) delete process.env.CARA_GPT_LIVE_PREBUFFER_MS;
      else process.env.CARA_GPT_LIVE_PREBUFFER_MS = prev;
    }
  });
});
