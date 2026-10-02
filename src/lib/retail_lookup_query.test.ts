import {test} from 'node:test';import assert from 'node:assert/strict';
import {namedPackLookupQuery} from './retail_lookup_query.js';
test('exact packs are looked up before interpreting mix eligibility',()=>{
 assert.equal(namedPackLookupQuery("Gordon's & Tonic Can 4 Pack 250 ml mix and match"),"Gordon's & Tonic Can 4 Pack 250 ml");
 assert.equal(namedPackLookupQuery('Mini Babybel Original 6 Pack 120 g mix and match offer'),'Mini Babybel Original 6 Pack 120 g');
 assert.equal(namedPackLookupQuery('mix and match wine offers'),'mix and match wine offers');
 assert.equal(namedPackLookupQuery('salmon mix and match offers'),'salmon mix and match offers');
});
