import {test} from 'node:test';import assert from 'node:assert/strict';
import {requestedPackTotalQuote,requestedCounterWeightQuote,verifiedSavingsQuote} from './retail_quantity_quote.js';
test('bundle and reference savings use exact cents rather than rounded euros',()=>{
 const m={product_name:'Smoked Salmon',department:'Fish',sku:'1',score:1,quote_text:'Two for eight',current_price_eur:4.99,was_price_eur:null,discount_label:'2 for €8',fulfilment:'prepack'};
 assert.match(verifiedSavingsQuote(m),/one euro ninety eight/);
 assert.match(verifiedSavingsQuote({...m,current_price_eur:4,was_price_eur:5.29,discount_label:null}),/one euro twenty nine per item/);
 assert.doesNotMatch(verifiedSavingsQuote({...m,current_price_eur:null}),/one euro ninety eight/);
});
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
 assert.match(requestedPackTotalQuote('buy two wraps',match),/three euro before any unverified multibuy discount/);
 assert.equal(requestedPackTotalQuote('buy two wraps',{...match,discount_label:null,fulfilment:'counter'}),'');
 assert.equal(requestedPackTotalQuote('buy two wraps',{...match,discount_label:'2 for €2',quote_text:'The pack eligibility is not verified.'}),'');
});

test('complete bundles are calculable without inventing a missing standalone price',()=>{
 const m={product_name:'Kit Kat',department:'Food',sku:'1',score:1,quote_text:'Two for two ninety',discount_label:'2 for €2.90',current_price_eur:null,fulfilment:'prepack'};
 assert.match(requestedPackTotalQuote('pick up 2 packs',m),/two euro ninety altogether/);
 assert.match(requestedPackTotalQuote('buy four packs',m),/five euro eighty altogether/);
 assert.equal(requestedPackTotalQuote('buy three packs',m),'');
 assert.equal(requestedPackTotalQuote('buy one pack',m),'');
});


test('calculates exact regular totals when the product price is verified but its promotion conflicts',()=>{
 const match={current_price_eur:2.35,fulfilment:'prepack',price_conflict:false,quote_text:'Verified current listed single price two euro thirty five. Eligibility for this exact product is not verified.'} as Parameters<typeof requestedPackTotalQuote>[1];
 assert.match(requestedPackTotalQuote('If I pick up 3 packs what will that cost on the deal?',match),/seven euro five.*not a verified offer or deal total/);
 assert.equal(requestedPackTotalQuote('pick up 3 packs',{...match,price_conflict:true}), '');
});
