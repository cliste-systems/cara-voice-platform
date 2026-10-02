import {test} from 'node:test';import assert from 'node:assert/strict';
import {requestedPackTotalQuote,requestedCounterWeightQuote} from './retail_quantity_quote.js';
test('loose counter portions use the verified kilo price rather than pack matching',()=>{
 const m={product_name:'Salmon',department:'Fish',sku:'1',score:1,quote_text:'twenty two euro forty nine per kilo',current_price_eur:22.49,fulfilment:'counter',price_basis:'per_kilo'};
 for(const q of ['two hundred grams','200 g','0.2 kg'])assert.match(requestedCounterWeightQuote(q,m),/four euro fifty/);
 assert.equal(requestedCounterWeightQuote('200 g',{...m,fulfilment:'prepack'}),'');
});
test('two four-euro grape packs do not cost the three-for-ten bundle total',()=>{
 const match={product_name:'Grapes',department:'Fruit',sku:'1',score:1,quote_text:'Three for ten euro',current_price_eur:4,discount_label:'3 for €10 Fruit',fulfilment:'prepack'};
 assert.match(requestedPackTotalQuote('If I get two grapes, how much altogether?',match),/eight euro altogether/);
 assert.match(requestedPackTotalQuote('If I get four grapes',match),/fourteen euro altogether/);
 assert.match(requestedPackTotalQuote('If I get two grapes',{...match,quote_text:'Three for ten euro. Eligibility to mix different products is not verified.'}),/eight euro altogether/);
});
test('unknown bundle terms, counter weights and conflicting pack eligibility cannot produce a guaranteed total',()=>{
 const match={product_name:'Wraps',department:'Bakery',sku:'1',score:1,quote_text:'Listed single price',current_price_eur:1.5,discount_label:'Permanent multi-buy Minimum quantity: 2',fulfilment:'prepack'};
 assert.equal(requestedPackTotalQuote('buy two wraps',match),'');
 assert.equal(requestedPackTotalQuote('buy two wraps',{...match,discount_label:null,fulfilment:'counter'}),'');
 assert.equal(requestedPackTotalQuote('buy two wraps',{...match,discount_label:'2 for €2',quote_text:'The pack eligibility is not verified.'}),'');
});
