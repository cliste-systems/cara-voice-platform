import {test} from 'node:test';
import assert from 'node:assert/strict';
import {useElevenLabsDemo} from './elevenlabs_demo_tts.js';
import {deliverGptLiveToolResult} from './gpt_live_retail.js';

test('normal voice pipelines retain their tool result when the duplex getter rejects access', () => {
  const ctx = {functionCall: {callId: 'normal-llm-call'}, session: {currentAgent: {
    get duplexSession(): unknown {throw new Error('no duplex session, this agent is not running a DuplexModel');},
  }}};
  assert.doesNotThrow(() => deliverGptLiveToolResult(ctx, {ok: true, matches: [{product_name: 'Lager'}]}));
});

test('ElevenLabs demo override requires server dispatch metadata and the enabled switch', () => {
  const previous = process.env.CARA_ADMIN_DEMO_ELEVENLABS;
  try {
    process.env.CARA_ADMIN_DEMO_ELEVENLABS = '1';
    assert.equal(useElevenLabsDemo('{"source":"admin_simulator"}'), true);
    for (const metadata of [undefined, '', 'bad json', '{"source":"sip"}', '{"room_name":"admin-demo-fake"}']) {
      assert.equal(useElevenLabsDemo(metadata), false);
    }
    process.env.CARA_ADMIN_DEMO_ELEVENLABS = '0';
    assert.equal(useElevenLabsDemo('{"source":"admin_simulator"}'), false);
  } finally {
    if (previous === undefined) delete process.env.CARA_ADMIN_DEMO_ELEVENLABS;
    else process.env.CARA_ADMIN_DEMO_ELEVENLABS = previous;
  }
});
