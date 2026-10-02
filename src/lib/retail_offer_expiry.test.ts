import {test} from 'node:test';import assert from 'node:assert/strict';
import {spokenVerifiedExpiry,callerRequestsOfferDates} from './retail_offer_expiry.js';
test('expiry words preserve the exact calendar date and reject open-ended placeholders',()=>{
 assert.equal(spokenVerifiedExpiry('2026-10-07'),'the seventh of October');
 assert.equal(spokenVerifiedExpiry('2026-10-14'),'the fourteenth of October');
 assert.equal(spokenVerifiedExpiry('2049-12-31'),null);
 assert.equal(spokenVerifiedExpiry('2026-02-31'),null);
 assert.equal(callerRequestsOfferDates('When does the offer end?'),true);
 assert.equal(callerRequestsOfferDates('What is the standard price?'),false);
});
