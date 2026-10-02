import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildProductFallbackQueries,
  fuzzyProductMatchScore,
  inferExplicitProductFulfilment,
  inferExplicitProductServiceArea,
  pickConfidentFuzzyProductMatch,
} from './product_query_fuzzy.js';

describe('retail product query fuzzy recovery', () => {
  it('adds a possessive/plural-safe stem fallback for brand names', () => {
    assert.deepEqual(buildProductFallbackQueries('Kelloggs'), ['kelloggs', 'kellogg']);
  });


  it('treats filled steak as a strong near-match for fillet steak', () => {
    const fillet = fuzzyProductMatchScore(
      'filled steak',
      'SuperValu Signature Tastes Hereford Irish Fillet Steak (370 g)',
    );
    const striploin = fuzzyProductMatchScore(
      'filled steak',
      'SuperValu Signature Tastes Irish Striploin Steak (450 g)',
    );
    assert.ok(fillet > 0.85);
    assert.ok(fillet > striploin + 0.25);
  });

  it('picks fillet from broad steak candidates after an STT slip', () => {
    const match = pickConfidentFuzzyProductMatch('filled steak', [
      { product_name: 'SuperValu Fresh Irish Beef Sirloin Steak (1 kg)' },
      { product_name: 'SuperValu Signature Tastes Hereford Irish Fillet Steak (370 g)' },
      { product_name: 'SuperValu Salt & Chilli Beef Quick Fry Steaks (380 g)' },
    ]);
    assert.match(match?.product_name ?? '', /Fillet Steak/i);
  });

  it('does not guess when broad candidates are genuinely ambiguous', () => {
    const match = pickConfidentFuzzyProductMatch('steak', [
      { product_name: 'SuperValu Fresh Irish Beef Sirloin Steak (1 kg)' },
      { product_name: 'SuperValu Signature Tastes Hereford Irish Fillet Steak (370 g)' },
    ]);
    assert.equal(match, null);
  });

  it('keeps fulfilment current-turn explicit', () => {
    assert.equal(inferExplicitProductFulfilment('fillet steak'), undefined);
    assert.equal(inferExplicitProductFulfilment('fillet steak at the meat counter'), 'counter');
    assert.equal(inferExplicitProductFulfilment('pre-pack fillet steak'), 'prepack');
  });

  it('treats explicit butcher-location wording as counter fulfilment', () => {
    assert.equal(inferExplicitProductFulfilment('what deals have ye at the butchers?'), 'counter');
    assert.equal(inferExplicitProductFulfilment('anything from the butcher?'), 'counter');
    assert.equal(inferExplicitProductFulfilment('what is down at the butcher\'s?'), 'counter');
    assert.equal(inferExplicitProductFulfilment('deals from butcher'), 'counter');
    assert.equal(inferExplicitProductFulfilment('butcher deals'), undefined);
    assert.equal(inferExplicitProductFulfilment('pre-pack deals at the butchers'), 'prepack');
  });

  it('infers explicit retail service areas without alcohol keyword traps', () => {
    assert.equal(inferExplicitProductServiceArea('what is on offer at the butcher counter?'), 'butcher');
    assert.equal(inferExplicitProductServiceArea('salmon at the fresh fish counter'), 'fish');
    assert.equal(inferExplicitProductServiceArea('anything on the dairy wall?'), 'dairy');
    assert.equal(inferExplicitProductServiceArea('three for a tenner in fruit and veg'), 'produce');
    assert.equal(inferExplicitProductServiceArea('what wine deals have ye?'), 'off_licence');
    assert.equal(inferExplicitProductServiceArea('Guinness cans on special'), 'off_licence');
    assert.equal(inferExplicitProductServiceArea('wine gums on offer'), undefined);
    assert.equal(inferExplicitProductServiceArea('beer battered cod on offer'), undefined);
    assert.equal(inferExplicitProductServiceArea('cider vinegar crisps'), undefined);
  });

  it('creates narrow fallback searches without offer boilerplate', () => {
    assert.deepEqual(buildProductFallbackQueries('is there any filled steak on offer?'), [
      'filled',
      'steak',
    ]);
  });
});


describe('department offer scope', () => {
  it('maps offer departments without inventing counter fulfilment', () => {
    for (const [query, area] of [
      ['meat offers', 'butcher'], ['fish offers', 'fish'], ['deli offers', 'deli'],
      ['dairy offers', 'dairy'], ['any offers in dairy', 'dairy'], ['bakery offers', 'bakery'],
      ['produce offers', 'produce'], ['beer offers', 'off_licence'],
    ]) {
      assert.equal(inferExplicitProductServiceArea(query!), area, query);
      assert.equal(inferExplicitProductFulfilment(query!), undefined, query);
    }
  });

  it('keeps broad and unlisted departments in the query', () => {
    for (const query of ['weekly offers', 'frozen offers', 'household offers', 'pet food offers', 'meat offers and dairy offers', 'any meat and dairy offers', 'offers apart from meat', 'red wine sauce']) {
      assert.equal(inferExplicitProductServiceArea(query), undefined, query);
    }
  });

  it('retains the explicit counter scope from the failed meat-offers call', () => {
    const query = 'is there any meat offers in the meat counter this week';
    assert.equal(inferExplicitProductServiceArea(query), 'butcher');
    assert.equal(inferExplicitProductFulfilment(query), 'counter');
  });
});


it('sealed packets exclude counters, while stout identifies the off licence', () => {
  assert.equal(inferExplicitProductFulfilment('smoked salmon sealed packets rather than loose counter fish'), 'prepack');
  assert.equal(inferExplicitProductServiceArea('dark stout in cans anything is fine'), 'off_licence');
});
