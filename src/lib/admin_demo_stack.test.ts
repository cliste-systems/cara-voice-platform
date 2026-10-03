import assert from 'node:assert/strict';
import { it } from 'node:test';
import { resolveLegacyAdminDemoStack } from './admin_demo_stack.js';

it('restores the original three providers for an explicitly enabled browser demo, including when ElevenLabs was enabled', () => {
  const previous = process.env.CARA_ADMIN_DEMO_STACK;
  const eleven = process.env.CARA_ADMIN_DEMO_ELEVENLABS;
  process.env.CARA_ADMIN_DEMO_STACK = 'legacy';
  process.env.CARA_ADMIN_DEMO_ELEVENLABS = '1';
  try {
    const demo = { jobMetadata: '{"source":"admin_simulator"}', isSipCall: false };
    const config = resolveLegacyAdminDemoStack(demo)!;
    assert.equal(config.sttModel, 'assemblyai/universal-3-6-pro');
    assert.equal(config.llmModel, 'google/gemma-4-31b-it');
    assert.equal(config.llmProvider, 'gateway');
    assert.equal(config.tts.voiceId, 'd79d2b77-9192-4e10-9407-5d43ca034803');
    assert.equal(resolveLegacyAdminDemoStack({...demo, isSipCall: true}), null);
    assert.equal(resolveLegacyAdminDemoStack({...demo, jobMetadata: '{}'}), null);
    assert.equal(resolveLegacyAdminDemoStack({...demo, jobMetadata: 'malformed'}), null);
    delete process.env.CARA_ADMIN_DEMO_STACK;
    assert.equal(resolveLegacyAdminDemoStack(demo), null);
  } finally {
    if (previous === undefined) delete process.env.CARA_ADMIN_DEMO_STACK; else process.env.CARA_ADMIN_DEMO_STACK = previous;
    if (eleven === undefined) delete process.env.CARA_ADMIN_DEMO_ELEVENLABS; else process.env.CARA_ADMIN_DEMO_ELEVENLABS = eleven;
  }
});
