import {test} from 'node:test';import assert from 'node:assert/strict';
import {conflictingOfferVariant,guardOfferEvidence} from './retail_offer_evidence.js';
test('contradictory pizza styles and enumerated yogurt flavours cannot inherit bundles',()=>{
 assert.equal(conflictingOfferVariant('Goodfellas Deep Pan Pizza','2 for €6 Goodfellas Thin Pizza PMP'),true);
 assert.equal(conflictingOfferVariant('Activia 0% Raspberry','3 for €5 Activia Strawberry/Rhubarb/0%Vanilla'),true);
 assert.equal(conflictingOfferVariant('Activia Strawberry','3 for €5 Activia Strawberry/Rhubarb/0%Vanilla'),false);
 assert.equal(conflictingOfferVariant('Activia Raspberry','3 for €5 Activia range'),false);
 const guarded=guardOfferEvidence({product_name:'Deep Pan Pizza',department:'Frozen',sku:'1',score:1,quote_text:'two for six euro',current_price_eur:3.25,discount_label:'2 for €6 Thin Pizza',is_on_offer:true});
 assert.equal(guarded.is_on_offer,false);assert.equal(guarded.discount_label,null);assert.match(guarded.quote_text,/Eligibility for this exact product is not verified/);assert.doesNotMatch(guarded.quote_text,/two for six/);
});
