import {test} from 'node:test';import assert from 'node:assert/strict';
import {conflictingOfferVariant,guardOfferEvidence,spokenOfferMatches} from './retail_offer_evidence.js';
test('ordinary price replies have three examples while explicit full-list requests retain the results',()=>{
 assert.deepEqual(spokenOfferMatches([1,2,3,4,5],'smoked salmon sealed packets'),[1,2,3]);
 assert.deepEqual(spokenOfferMatches([1,2,3,4,5],'all the offers on smoked salmon'),[1,2,3,4,5]);
});
test('contradictory pizza styles and enumerated yogurt flavours cannot inherit bundles',()=>{
 assert.equal(conflictingOfferVariant('Goodfellas Deep Pan Pizza','2 for €6 Goodfellas Thin Pizza PMP'),true);
 assert.equal(conflictingOfferVariant('Activia 0% Raspberry','3 for €5 Activia Strawberry/Rhubarb/0%Vanilla'),true);
 assert.equal(conflictingOfferVariant('Activia Strawberry','3 for €5 Activia Strawberry/Rhubarb/0%Vanilla'),false);
 assert.equal(conflictingOfferVariant('Activia Raspberry','3 for €5 Activia range'),false);
 const guarded=guardOfferEvidence({product_name:'Deep Pan Pizza',department:'Frozen',sku:'1',score:1,quote_text:'two for six euro',current_price_eur:3.25,discount_label:'2 for €6 Thin Pizza',is_on_offer:true});
 assert.equal(guarded.is_on_offer,false);assert.equal(guarded.discount_label,null);assert.match(guarded.quote_text,/Eligibility for this exact product is not verified/);assert.doesNotMatch(guarded.quote_text,/two for six/);
});
