import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildRewardsPricePointMatches,
  formatSpokenRewardsPrice,
  inferRewardsPricePoint,
  searchRewardsPricePointOffersDirect,
  type RewardsPricePointRow,
} from './rewards_price_point.js';

const reference = new Date('2026-09-27T12:00:00.000Z');
const currentObservation = {
  synced_at: '2026-09-27T11:00:00.000Z',
  offer_week_start: '2026-09-24',
  offer_week_end: '2026-09-30',
};
const rewardsRow: RewardsPricePointRow = {
  product_name: 'Rewards test product', department: 'Grocery', sku: 'rewards-test',
  current_price_eur: 2.5, was_price_eur: 3, discount_label: 'Rewards Price Only €2.50',
  service_area: 'grocery', fulfilment: 'prepack', is_alcohol: false,
  ...currentObservation,
};

describe('Rewards price-point lookup', () => {
  it('parses numeric and spoken Rewards price points', () => {
    assert.equal(inferRewardsPricePoint("What's on Rewards Price for €2.50?"), 2.5);
    assert.equal(inferRewardsPricePoint('What offers are 2.50 with Real Rewards?'), 2.5);
    assert.equal(inferRewardsPricePoint('Anything with Rewards at two fifty?'), 2.5);
    assert.equal(inferRewardsPricePoint('Any Real Rewards offers for two euro fifty?'), 2.5);
    assert.equal(inferRewardsPricePoint('two fifty'), null);
    assert.equal(inferRewardsPricePoint('Kinetica Strawberry Protein Milkshake (330 ml) Rewards Price'), null);
    assert.equal(inferRewardsPricePoint('Kinetica Strawberry Protein Milkshake (330 ml) Rewards Price Only €2.50'), null);
    assert.equal(inferRewardsPricePoint('100 Real Rewards points'), null);
  });

  it('formats spoken euro prices for Cara', () => {
    assert.equal(formatSpokenRewardsPrice(2.5), 'two euro fifty');
    assert.equal(formatSpokenRewardsPrice(5), 'five euro');
    assert.equal(formatSpokenRewardsPrice(0.99), 'ninety nine cents');
  });

  it('keeps only exact Rewards price matches and prefers non-alcohol first', () => {
    const matches = buildRewardsPricePointMatches(
      [
        {
          ...currentObservation,
          product_name: 'Two Tracks Sauvignon Blanc',
          department: 'Wine',
          sku: 'wine-11',
          current_price_eur: 11,
          was_price_eur: 12,
          discount_label: 'Rewards Price',
          service_area: 'off_licence',
          fulfilment: 'prepack',
          is_alcohol: true,
        },
        {
          ...currentObservation,
          product_name: 'Aquafresh Toothpaste',
          department: 'Dental Care',
          sku: 'toothpaste-250',
          current_price_eur: 2.5,
          was_price_eur: 5,
          discount_label: 'Rewards Price Only €2.50',
          service_area: 'grocery',
          fulfilment: 'prepack',
          is_alcohol: false,
        },
        {
          ...currentObservation,
          product_name: 'Ordinary €2.50 Deal',
          department: 'Grocery',
          sku: 'ordinary-250',
          current_price_eur: 2.5,
          was_price_eur: 3,
          discount_label: 'Only €2.50',
          service_area: 'grocery',
          fulfilment: 'prepack',
          is_alcohol: false,
        },
        {
          ...currentObservation,
          product_name: 'Absolut Ready to Drink',
          department: 'Alcohol',
          sku: 'alcohol-250',
          current_price_eur: 2.5,
          was_price_eur: 3,
          discount_label: 'Rewards Price Only €2.50',
          service_area: 'off_licence',
          fulfilment: 'prepack',
          is_alcohol: true,
        },
      ],
      2.5,
      5,
      reference,
    );

    assert.deepEqual(matches.map((match) => match.product_name), [
      'Aquafresh Toothpaste',
      'Absolut Ready to Drink',
    ]);
    assert.doesNotMatch(matches.map((match) => match.quote_text).join(' '), /eleven euro/i);
    assert.match(matches[0]?.quote_text ?? '', /Rewards Price two euro fifty/i);
  });
});


describe('direct Rewards offer freshness', () => {
  it('rejects stale, future and missing observations even when campaign dates are current', () => {
    for (const synced_at of [
      '2026-09-25T11:59:59.999Z',
      '2026-09-27T12:00:00.001Z',
      'not-a-timestamp',
      null,
    ]) {
      assert.deepEqual(buildRewardsPricePointMatches([{ ...rewardsRow, synced_at }], 2.5, 5, reference), [], String(synced_at));
    }
    for (const synced_at of ['2026-09-25T12:00:00.000Z', reference.toISOString()]) {
      assert.equal(buildRewardsPricePointMatches([{ ...rewardsRow, synced_at }], 2.5, 5, reference).length, 1, synced_at);
    }
  });

  it('rejects expired, future and missing campaign dates despite a fresh observation', () => {
    for (const dates of [
      { offer_week_end: '2026-09-26' },
      { offer_week_start: '2026-09-28' },
      { offer_week_start: null },
      { offer_week_end: 'unconfirmed' },
    ]) {
      assert.deepEqual(buildRewardsPricePointMatches([{ ...rewardsRow, ...dates }], 2.5, 5, reference), []);
    }
  });

  it('expires at Dublin midnight while the UTC date is still the previous day', () => {
    const afterDublinMidnight = new Date('2026-09-27T23:15:00.000Z');
    const expired = { ...rewardsRow, offer_week_end: '2026-09-27' };
    const startsToday = { ...rewardsRow, offer_week_start: '2026-09-28' };
    assert.deepEqual(buildRewardsPricePointMatches([expired], 2.5, 5, afterDublinMidnight), []);
    assert.equal(buildRewardsPricePointMatches([startsToday], 2.5, 5, afterDublinMidnight).length, 1);
  });

  it('sends both observation limits to the database and rejects stale rows returned anyway', async () => {
    const previousFetch = globalThis.fetch;
    const previousUrl = process.env.SUPABASE_URL;
    const previousKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    process.env.SUPABASE_URL = 'https://rewards-test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only-key';
    let requestUrl: URL | undefined;
    const now = new Date();
    const dateParts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Dublin', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
    const part = (type: string) => dateParts.find((entry) => entry.type === type)?.value;
    const today = `${part('year')}-${part('month')}-${part('day')}`;
    const fresh = { ...rewardsRow, synced_at: now.toISOString(), offer_week_start: today, offer_week_end: today };
    const stale = { ...fresh, product_name: 'Stale Rewards', sku: 'stale-rewards', synced_at: new Date(now.getTime() - 49 * 60 * 60 * 1000).toISOString() };
    globalThis.fetch = async (input) => {
      requestUrl = new URL(String(input));
      return new Response(JSON.stringify([fresh, stale]), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    try {
      const before = Date.now();
      const matches = await searchRewardsPricePointOffersDirect({ amountEur: 2.5 });
      const after = Date.now();
      assert.ok(requestUrl);
      const filters = requestUrl.searchParams.getAll('synced_at');
      assert.equal(filters.length, 2);
      const lower = Date.parse(filters.find((value) => value.startsWith('gte.'))!.slice(4));
      const upper = Date.parse(filters.find((value) => value.startsWith('lte.'))!.slice(4));
      assert.ok(upper >= before && upper <= after);
      assert.equal(upper - lower, 48 * 60 * 60 * 1000);
      assert.equal(requestUrl.searchParams.get('offer_week_start'), `lte.${today}`);
      assert.equal(requestUrl.searchParams.get('offer_week_end'), `gte.${today}`);
      assert.deepEqual(matches.map((match) => match.product_name), ['Rewards test product']);
    } finally {
      globalThis.fetch = previousFetch;
      if (previousUrl === undefined) delete process.env.SUPABASE_URL;
      else process.env.SUPABASE_URL = previousUrl;
      if (previousKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      else process.env.SUPABASE_SERVICE_ROLE_KEY = previousKey;
    }
  });
});
