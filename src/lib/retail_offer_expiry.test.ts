import {test} from 'node:test';import assert from 'node:assert/strict';
import {spokenVerifiedExpiry,callerRequestsOfferDates,historicalOfferGuidance,ambiguousHistoricalOfferGuidance} from './retail_offer_expiry.js';
test('old seasonal promotions cannot be verified or declared expired from a current catalogue',()=>{
 const date=new Date('2026-10-02T12:00:00Z');
 assert.match(historicalOfferGuidance('Christmas 2025 offers today',date)??'',/do not assert they expired/);
 assert.equal(historicalOfferGuidance('Does this offer end in October 2026?',date),null);
 assert.equal(historicalOfferGuidance('Any offers on a 2025 vintage wine?',date),null);
});
test('expiry words preserve the exact calendar date and reject open-ended placeholders',()=>{
 assert.equal(spokenVerifiedExpiry('2026-10-07'),'the seventh of October');
 assert.equal(spokenVerifiedExpiry('2026-10-14'),'the fourteenth of October');
 assert.equal(spokenVerifiedExpiry('2049-12-31'),null);
 assert.equal(spokenVerifiedExpiry('2026-02-31'),null);
 assert.equal(callerRequestsOfferDates('When does the offer end?'),true);
 assert.equal(callerRequestsOfferDates('What is the standard price?'),false);
});

test('historical weekdays must be resolved by the caller before a dated lookup',()=>{
 assert.match(ambiguousHistoricalOfferGuidance("What meat was on offer last Thursday? Don’t use this week as if it was last week.")??'',/Ask which exact calendar date/);
 assert.equal(ambiguousHistoricalOfferGuidance('meat offers for 2026-09-24, last Thursday'),null);
 assert.equal(ambiguousHistoricalOfferGuidance('current meat offers'),null);
});
