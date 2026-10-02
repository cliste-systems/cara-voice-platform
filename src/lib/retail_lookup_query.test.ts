import {test} from 'node:test';import assert from 'node:assert/strict';
import {namedPackLookupQuery,counterWeightLookupQuery,mergeProductRefinement} from './retail_lookup_query.js';
test('a full named refinement does not duplicate the pending product query',()=>{
 assert.equal(mergeProductRefinement('Guinness Draught','Guinness Draught 8 pack 500ml not Nitrosurge'),'Guinness Draught 8 pack 500ml not Nitrosurge');
 assert.equal(mergeProductRefinement('Guinness Draught offers','Guinness Draught eight pack 500 ml cans not Nitrosurge offers'),'Guinness Draught eight pack 500 ml cans not Nitrosurge offers');
 assert.equal(mergeProductRefinement('Guinness Draught','8 pack 500ml'),'Guinness Draught 8 pack 500ml');
});
test('counter portions do not become a conflicting retail pack size',()=>{assert.equal(counterWeightLookupQuery('loose skin-on salmon darnes 200 grams'),'loose skin-on salmon darnes');});
test('exact packs are looked up before interpreting mix eligibility',()=>{
 assert.equal(namedPackLookupQuery('sealed smoked salmon packets'),'smoked salmon');
 assert.equal(namedPackLookupQuery("Gordon's & Tonic Can 4 Pack 250 ml mix and match"),"Gordon's & Tonic Can 4 Pack 250 ml");
 assert.equal(namedPackLookupQuery('Mini Babybel Original 6 Pack 120 g mix and match offer'),'Mini Babybel Original 6 Pack 120 g');
 assert.equal(namedPackLookupQuery('mix and match wine offers'),'mix and match wine offers');
 assert.equal(namedPackLookupQuery('salmon mix and match offers'),'salmon mix and match offers');
});
