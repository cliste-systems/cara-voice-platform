import assert from 'node:assert/strict';
import test from 'node:test';
import { callDurationLimitMinutes, isPublicDemoCall, reservePublicDemoCall } from './public_demo_limits.js';

const demo = {
  organizationId: '00000000-0000-4000-8000-000000000001',
  callerE164: '+15555550100', isDemoLine: true, isSipCall: true,
};
const allowedRow = { failure_count: 1, retry_after_seconds: 0 };

test('normal customer calls and authenticated browser rehearsals never reserve public demo allowance', async () => {
  let touched = false;
  const dependencies = { secret: 'synthetic-demo-key', reserve: async () => {
    touched = true; throw new Error('must not reach counter');
  } };
  for (const input of [{ ...demo, isDemoLine: false }, { ...demo, isSipCall: false }]) {
    assert.equal(isPublicDemoCall(input), false);
    assert.deepEqual(await reservePublicDemoCall(input, dependencies), { allowed: true, reason: 'allowed' });
  }
  assert.equal(touched, false);
});

test('demo counters use tenant-scoped keyed hashes and a separate anonymous allowance', async () => {
  const requests: Array<{ scope: string; fingerprint: string; limit: number }> = [];
  const dependencies = { secret: 'synthetic-demo-key', reserve: async (scope: string, fingerprint: string, limit: number) => {
    requests.push({ scope, fingerprint, limit });
    return { data: [allowedRow], error: null };
  } };
  for (const input of [demo, demo, { ...demo, organizationId: 'different-tenant' }, { ...demo, callerE164: '+anonymous' }]) {
    assert.equal((await reservePublicDemoCall(input, dependencies)).allowed, true);
  }
  assert.equal(requests[0]!.scope, 'public_demo_call');
  assert.equal(requests[0]!.limit, 8);
  assert.equal(requests[3]!.limit, 24);
  assert.equal(requests[0]!.fingerprint, requests[1]!.fingerprint);
  assert.notEqual(requests[0]!.fingerprint, requests[2]!.fingerprint);
  assert.match(requests[0]!.fingerprint, /^[a-f0-9]{64}$/);
  assert.ok(!JSON.stringify(requests).includes(demo.callerE164));
});

test('demo admission admits the final allowed start, then refuses over-limit or locked calls', async () => {
  for (const [row, allowed] of [
    [{ failure_count: 8, retry_after_seconds: 0 }, true],
    [{ failure_count: 9, retry_after_seconds: 900 }, false],
    [{ failure_count: 1, retry_after_seconds: 30 }, false],
  ] as const) {
    assert.deepEqual(await reservePublicDemoCall(demo, {
      secret: 'synthetic-demo-key', reserve: async () => ({ data: [row], error: null }),
    }), { allowed, reason: allowed ? 'allowed' : 'limited' });
  }
});

test('unavailable and malformed demo counter results fail closed without leaking provider details', async () => {
  for (const data of [null, [], [{}], [allowedRow, allowedRow], [{ failure_count: -1, retry_after_seconds: 0 }],
    [{ failure_count: 1, retry_after_seconds: -1 }], [{ failure_count: '1', retry_after_seconds: 0 }]]) {
    assert.deepEqual(await reservePublicDemoCall(demo, {
      secret: 'synthetic-demo-key', reserve: async () => ({ data, error: null }),
    }), { allowed: false, reason: 'unavailable' });
  }
  assert.equal((await reservePublicDemoCall(demo, {
    secret: 'synthetic-demo-key', reserve: async () => { throw new Error('private provider payload'); },
  })).reason, 'unavailable');
  assert.equal((await reservePublicDemoCall(demo, {
    secret: 'synthetic-demo-key', reserve: async () => ({ data: [allowedRow], error: { message: 'private' } }),
  })).reason, 'unavailable');
});

test('only public demos receive an eight-minute cap and existing shorter limits are respected', () => {
  assert.equal(callDurationLimitMinutes(false, '30'), 30);
  assert.equal(callDurationLimitMinutes(false, 'invalid'), 30);
  assert.equal(callDurationLimitMinutes(false, '999'), 120);
  assert.equal(callDurationLimitMinutes(true, '30'), 8);
  assert.equal(callDurationLimitMinutes(true, '5'), 5);
  assert.equal(callDurationLimitMinutes(true, 'invalid'), 8);
});
