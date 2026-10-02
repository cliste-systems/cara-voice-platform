import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildCloseDiagnosticsPayload } from './call_close_diagnostics.js';
import { postSearchSupervaluProducts, postCallComplete, type CallCompletePayload } from './voice_api.js';

test('completed production calls preserve raw dialogue, tool errors, and final diagnostics in the webhook', async () => {
  const previousFetch = globalThis.fetch;
  const previousUrl = process.env.CLISTE_APP_URL;
  const previousSecret = process.env.CLISTE_VOICE_WEBHOOK_SECRET;
  process.env.CLISTE_APP_URL = 'https://call-analysis.invalid';
  process.env.CLISTE_VOICE_WEBHOOK_SECRET = 'test-only-call-analysis';
  const requests: { url: string; body: CallCompletePayload }[] = [];
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), body: JSON.parse(String(init?.body)) as CallCompletePayload });
    return new Response(JSON.stringify({ ok: true, call_log_id: 'call-analysis-test' }), {
      headers: { 'Content-Type': 'application/json' },
    });
  };

  try {
    const transcript = 'Caller: Is the coffee offer still running?\n\n[Tool error] search_weekly_offers timed out\n\nAssistant: I cannot confirm that offer right now.';
    const diagnostics = buildCloseDiagnosticsPayload({
      latency: { replyMs: [2100], userSpeakingToThinkingMs: [180] },
      events: [{ atMs: 500, level: 'error', tag: 'tool_error', message: 'search_weekly_offers timed out' }],
      greetingPlayed: true,
      disclosureConfirmed: true,
      transcript,
      isTestCall: false,
      postprocessRan: true,
      knowledgeGapCount: 1,
      transcriptCapture: {
        status: 'captured', expectedEventCount: 7, persistedEventCount: 7,
        sequenceContinuous: true, hasCaller: true, hasAssistant: true,
      },
    });
    const result = await postCallComplete({
      called_number: '+35315550100',
      call_sid: 'analysis-webhook-test',
      caller_number: '+35315550101',
      duration_seconds: 48,
      outcome: 'answered',
      transcript,
      diagnostics,
      is_test_call: false,
      post_call_status: 'partial',
      post_call_errors: [{ stage: 'action_ticket', message: 'Ticket write failed', at: '2026-09-28T12:00:00Z' }],
      post_call_expected_ticket: true,
    });

    assert.deepEqual(result, { ok: true, callLogId: 'call-analysis-test' });
    assert.equal(requests.length, 1);
    assert.equal(requests[0]?.url, 'https://call-analysis.invalid/api/voice/call-complete');
    const sent = requests[0]!.body;
    assert.equal(sent.is_test_call, false);
    assert.equal(sent.transcript, transcript);
    assert.equal(sent.post_call_status, 'partial');
    assert.equal(sent.post_call_expected_ticket, true);
    assert.equal(sent.post_call_errors?.[0]?.message, 'Ticket write failed');
    assert.equal(sent.diagnostics?.events[0]?.tag, 'tool_error');
    assert.equal(sent.diagnostics?.postprocessRan, true);
    assert.deepEqual(sent.diagnostics?.transcriptCapture, {
      status: 'captured', expectedEventCount: 7, persistedEventCount: 7,
      sequenceContinuous: true, hasCaller: true, hasAssistant: true,
    });
    assert.equal(sent.diagnostics?.knowledgeGapCount, 1);
    assert.deepEqual(sent.diagnostics?.latency.replyMs, [2100]);
    assert.match(sent.diagnostics?.toolLines?.join('\n') ?? '', /search_weekly_offers timed out/);
    assert.equal(sent.diagnostics?.transcriptCompleteness?.callerLineCount, 1);
    assert.equal(sent.diagnostics?.transcriptCompleteness?.assistantLineCount, 1);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousUrl === undefined) delete process.env.CLISTE_APP_URL;
    else process.env.CLISTE_APP_URL = previousUrl;
    if (previousSecret === undefined) delete process.env.CLISTE_VOICE_WEBHOOK_SECRET;
    else process.env.CLISTE_VOICE_WEBHOOK_SECRET = previousSecret;
  }
});


test('catalogue lookups retry transient failures once without retrying invalid requests', async () => {
  const originalFetch=globalThis.fetch;const originalUrl=process.env.CLISTE_APP_URL;const originalSecret=process.env.CLISTE_VOICE_WEBHOOK_SECRET;
  process.env.CLISTE_APP_URL='https://lookup.invalid';process.env.CLISTE_VOICE_WEBHOOK_SECRET='test-lookup';
  try {
    for (const failure of ['timeout','503','401','400','always-timeout']) {
      let calls=0;
      globalThis.fetch=async () => {
        calls++;
        if ((failure==='timeout' && calls===1) || failure==='always-timeout') throw new DOMException('Timed out','AbortError');
        if (calls===1 && /^\d+$/.test(failure)) return new Response(JSON.stringify({error:'test failure'}),{status:Number(failure)});
        return new Response(JSON.stringify({ok:true,matches:[{product_name:'Traditional Cooked Ham',current_price_eur:22}]}));
      };
      const result=await postSearchSupervaluProducts({called_number:'test-line',query:'Traditional Cooked Ham',intent:'offer'});
      assert.equal(calls,['timeout','503','always-timeout'].includes(failure)?2:1,failure);
      assert.equal(result.ok,['timeout','503'].includes(failure),failure);
      if(failure==='always-timeout') {assert.deepEqual(result.matches,[]);assert.equal(result.error,'timeout');}
    }
  } finally {globalThis.fetch=originalFetch;if(originalUrl===undefined)delete process.env.CLISTE_APP_URL;else process.env.CLISTE_APP_URL=originalUrl;if(originalSecret===undefined)delete process.env.CLISTE_VOICE_WEBHOOK_SECRET;else process.env.CLISTE_VOICE_WEBHOOK_SECRET=originalSecret;}
});
