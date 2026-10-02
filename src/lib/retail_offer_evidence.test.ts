import {test} from 'node:test';import assert from 'node:assert/strict';
import {conflictingOfferVariant,guardOfferEvidence,spokenOfferMatches,matchesRequestedDietLabel,alcoholVariantQuestion,matchesRequestedWineColor} from './retail_offer_evidence.js';
test('White Grenache in the rose category cannot win a white-wine comparison',()=>{
 const m={product_name:'Gallo Family White Grenache',department:'Rose',sku:'1',score:1,quote_text:'Listed'};
 assert.equal(matchesRequestedWineColor('cheapest white wine, no red wine',m),false);
 assert.equal(matchesRequestedWineColor('white wine or rosé',m),true);
 assert.equal(matchesRequestedWineColor('Gallo Family White Grenache',m),true);
});
test('a named beer pack must distinguish regular and alcohol-free versions',()=>{
 const base={department:'Beer',sku:'1',score:1,quote_text:'Listed'};
 const matches=[{...base,product_name:'Guinness Draught 0.0% Can 8 Pack',is_alcohol:false},{...base,product_name:'Guinness Draught Stout Can 8 Pack',is_alcohol:true}];
 assert.ok(alcoholVariantQuestion('Guinness Draught eight pack not Nitrosurge',matches));
 assert.equal(alcoholVariantQuestion('regular Guinness Draught eight pack',matches),null);
 assert.equal(alcoholVariantQuestion('Guinness 0.0 eight pack',matches),null);
});
test('dietary lookups cannot return ordinary meat or infer dietary suitability from a brand',()=>{
 const base={department:'Frozen',sku:'1',score:1,quote_text:'Listed',product_name:'Irish Beef Burgers'};
 assert.equal(matchesRequestedDietLabel('vegan frozen burgers',base),false);
 assert.equal(matchesRequestedDietLabel('vegan frozen burgers',{...base,product_name:'Vegan Frozen Burgers'}),true);
 assert.equal(matchesRequestedDietLabel('gluten-free bread',{...base,department:'Gluten Free Bread',product_name:'Genius Bread'}),true);
 assert.equal(matchesRequestedDietLabel('dairy-free ice cream',{...base,product_name:'Standard Ice Cream'}),false);
});
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

test('retailer codes are removed from both model-visible promotion fields',()=>{
 const result=guardOfferEvidence({product_name:'Nappies',department:'Baby',sku:'1',score:1,discount_label:'2 for €28 SV & CT Pampers Jumbo',quote_text:'Two for twenty eight euro SV and CT Pampers Jumbo.'});
 assert.equal(result.discount_label,'2 for €28 SuperValu Pampers Jumbo');
 assert.doesNotMatch(result.quote_text,/SV.*CT/);
});
