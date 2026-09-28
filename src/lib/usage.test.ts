import assert from 'node:assert/strict';
import { test } from 'node:test';

import { sumUsageMinutesThisPeriod } from './usage.js';

const organizationId = '00000000-0000-4000-8000-000000000001';
const billingPeriodStart = '2026-09-01';

async function withUsageResponse(
  response: unknown,
  check: (result: number | null, requests: Array<{ url: string; body: unknown }>) => void,
  status = 200,
): Promise<void> {
  const originalFetch = globalThis.fetch;
  const envKeys = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'CARA_OFFLINE_PLAYGROUND'] as const;
  const originals = envKeys.map((key) => [key, process.env[key]] as const);
  process.env.SUPABASE_URL = 'https://usage-test.invalid';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'synthetic-usage-test';
  delete process.env.CARA_OFFLINE_PLAYGROUND;
  const requests: Array<{ url: string; body: unknown }> = [];
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify(response), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  };
  try {
    const result = await sumUsageMinutesThisPeriod({ organizationId, billingPeriodStart });
    check(result, requests);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of originals) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('quota admission uses the full database total beyond the REST row limit', async () => {
  // 1,000 short calls followed by ten 30-minute calls: the old first-page
  // calculation returned 20 minutes while the database total is 320 minutes.
  const totalFor1010Calls = 1000 * 0.02 + 10 * 30;
  await withUsageResponse(totalFor1010Calls, (result, requests) => {
    assert.equal(result, 320);
    assert.deepEqual(requests, [{
      url: 'https://usage-test.invalid/rest/v1/rpc/voice_usage_minutes_for_period',
      body: { p_organization_id: organizationId, p_billing_period_start: billingPeriodStart },
    }]);
  });
});

test('quota admission accepts an explicitly empty billing period', async () => {
  await withUsageResponse(0, (result) => assert.equal(result, 0));
});

test('quota admission fails closed when the aggregate is unavailable or malformed', async () => {
  await withUsageResponse({ message: 'database unavailable', code: 'TEST' }, (result) => {
    assert.equal(result, null);
  }, 503);
  for (const invalid of [null, [], {}, '0', -1]) {
    await withUsageResponse(invalid, (result) => assert.equal(result, null));
  }
});
