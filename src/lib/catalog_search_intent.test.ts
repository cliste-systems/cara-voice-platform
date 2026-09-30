import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  inferCatalogSearchIntent,
  inferWeeklyOffersListIntent,
  resolveCatalogSearchIntent,
  trackCallerCatalogSearchIntent,
} from './catalog_search_intent.js';

describe('catalog search intent', () => {
  it('uses session offer flag when query is bare product name', () => {
    assert.equal(
      resolveCatalogSearchIntent({
        query: 'biscuits',
        callerAskedAboutOffers: true,
      }),
      'offer',
    );
  });

  it('prefers explicit price intent over session offer flag', () => {
    assert.equal(
      resolveCatalogSearchIntent({
        query: 'Weetabix',
        explicitIntent: 'price',
        callerAskedAboutOffers: true,
      }),
      'price',
    );
  });

  it('tracks offer phrasing on caller turns', () => {
    const flags: { callerAskedAboutOffers?: boolean; rewardsPricePoint?: number | null } = {};
    trackCallerCatalogSearchIntent('any offer on biscuits this week', flags);
    assert.equal(flags.callerAskedAboutOffers, true);
    assert.equal(flags.rewardsPricePoint, null);
    trackCallerCatalogSearchIntent("what's on Rewards Price for €2.50?", flags);
    assert.equal(flags.callerAskedAboutOffers, true);
    assert.equal(flags.rewardsPricePoint, 2.5);
    trackCallerCatalogSearchIntent('how much is the Weetabix', flags);
    assert.equal(flags.callerAskedAboutOffers, false);
    assert.equal(flags.rewardsPricePoint, null);
  });

  it('infers offer intent from query text', () => {
    assert.equal(inferCatalogSearchIntent('McVitie\'s on offer'), 'offer');
    assert.equal(inferCatalogSearchIntent('McVitie\'s'), 'stock');
  });

  it('treats Rewards price-point browsing as offer intent', () => {
    assert.equal(inferCatalogSearchIntent("What's on Rewards Price for €2.50?"), 'offer');
    assert.equal(inferCatalogSearchIntent('What offers are €2.50 with Real Rewards?'), 'offer');
    assert.equal(inferCatalogSearchIntent('Anything with Rewards at two fifty?'), 'offer');
    assert.equal(inferCatalogSearchIntent('Any Real Rewards offers for two euro fifty?'), 'offer');
  });

  it('infers browse intent for weekly offers', () => {
    assert.equal(inferWeeklyOffersListIntent('weekly offers'), true);
    assert.equal(inferWeeklyOffersListIntent('best offers'), true);
    assert.equal(inferWeeklyOffersListIntent('list 5 offers apart from meat'), true);
    assert.equal(inferWeeklyOffersListIntent('steak'), false);
  });
});


describe('promotion and department requests', () => {
  it('recognizes every supported offer mechanic without relying on prior turns', () => {
    for (const query of [
      'meat offers', 'dairy deals', 'bakery specials', 'household promotions',
      'multibuys', 'multi-buy meat', 'mix and match', "Super 7's", 'Super Sevens',
      '3 for 10', 'three for a tenner', '2 for €5', 'buy one get one free',
      'half price frozen food', '25% off', 'price cuts',
    ]) {
      assert.equal(inferCatalogSearchIntent(query), 'offer', query);
      const flags: { callerAskedAboutOffers?: boolean } = {};
      trackCallerCatalogSearchIntent(query, flags);
      assert.equal(flags.callerAskedAboutOffers, true, query);
    }
  });

  it('preserves browse and campaign filters without treating a named product as a rundown', () => {
    for (const query of [
      'any meat offers', 'any meat offers in the meat counter this week',
      'weekly offers', 'dairy offers', 'pet food offers', 'frozen offers',
      'offers across every department', 'Super 7', '3 for 10 chicken', 'multibuys',
    ]) assert.equal(inferWeeklyOffersListIntent(query), true, query);
    for (const query of ['any offers on filled steak', 'offers on chicken fillets', 'Kelloggs on offer']) {
      assert.equal(inferWeeklyOffersListIntent(query), false, query);
    }
  });
});


describe('lowest-price follow-up regression', () => {
  it('clears an earlier offer-only preference when the caller asks what is cheapest', () => {
    const flags: Parameters<typeof trackCallerCatalogSearchIntent>[1] = {};
    trackCallerCatalogSearchIntent('any meat on offer for a barbecue', flags);
    trackCallerCatalogSearchIntent('burgers', flags);
    trackCallerCatalogSearchIntent('what would be the cheapest', flags);
    assert.equal(flags.callerWantsLowestPrice, true);
    assert.equal(flags.callerBarbecueCooking, true);
    assert.equal(flags.callerMeatPreference, true);
    assert.equal(flags.callerAskedAboutOffers, false);
    assert.equal(flags.callerLowestPriceOffersOnly, false);
    assert.equal(inferCatalogSearchIntent('cheapest burgers'), 'price');
  });
  it('preserves an explicitly offer-only cheapest request', () => {
    const flags: Parameters<typeof trackCallerCatalogSearchIntent>[1] = {};
    trackCallerCatalogSearchIntent('cheapest burger offers', flags);
    assert.equal(flags.callerWantsLowestPrice, true);
    assert.equal(flags.callerLowestPriceOffersOnly, true);
    trackCallerCatalogSearchIntent('do you stock laptops', flags);
    assert.equal(flags.callerWantsLowestPrice, false);
  });
});

 it('does not treat barbecue sauce as a raw cooking request and allows a prepared-food correction', () => {
   const flags: Parameters<typeof trackCallerCatalogSearchIntent>[1] = {};
   trackCallerCatalogSearchIntent('cheapest barbecue sauce', flags);
   assert.equal(flags.callerBarbecueCooking, undefined);
   trackCallerCatalogSearchIntent('burgers for a barbecue', flags);
   assert.equal(flags.callerBarbecueCooking, true);
   trackCallerCatalogSearchIntent('actually a microwave burger', flags);
   assert.equal(flags.callerBarbecueCooking, false);
 });
