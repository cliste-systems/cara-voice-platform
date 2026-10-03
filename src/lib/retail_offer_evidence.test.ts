import {test} from 'node:test';import assert from 'node:assert/strict';
import {conflictingOfferVariant,guardOfferEvidence,spokenOfferMatches,matchesRequestedDietLabel,alcoholVariantQuestion,matchesRequestedWineColor,requestedPriceEvidence,matchesRequestedProductVariant} from './retail_offer_evidence.js';
test('current Rewards price questions do not expose an unrequested historical price',()=>{
 const m={product_name:'Smoothie',department:'Drinks',sku:'1',score:1,current_price_eur:4,was_price_eur:4.99,discount_label:'Rewards Price Only €4',quote_text:'Rewards Price Only four euro. Now four euro. Usually four euro ninety nine. Local stock unconfirmed.'};
 const result=requestedPriceEvidence(m,'How much is this on offer, and is it a Rewards price?');
 assert.equal(result.was_price_eur,null);assert.equal(result.current_price_eur,4);assert.equal(result.discount_label,m.discount_label);assert.doesNotMatch(result.quote_text,/ninety nine|Usually/);assert.match(result.quote_text,/Local stock unconfirmed/);
 for(const q of ['What was the usual price?', 'How much am I saving?', 'Compare it with the previous price'])assert.deepEqual(requestedPriceEvidence(m,q),m);
});
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
 assert.equal(matchesRequestedDietLabel('vegan burgers',{...base,product_name:'Meat Free Plant Based Burgers'}),false);
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


test('Mango yogurt does not inherit an explicitly enumerated different-flavour promotion',()=>{
 const m={product_name:'Activia Mango Gut Health Yogurt 4 Pack (115 g)',department:'Yogurt',sku:'mango',score:1,current_price_eur:3.49,quote_text:'Three for five euro.',discount_label:'3 for €5 Danone Activia Strawberry/Rhubarb/0%Vanilla',is_on_offer:true};
 const result=guardOfferEvidence(m);assert.equal(result.is_on_offer,false);assert.equal(result.discount_label,null);assert.match(result.quote_text,/Eligibility for this exact product is not verified/);
 assert.equal(conflictingOfferVariant('Activia Mango','3 for €5 Activia Selected Range'),false);
});

test('deli requests cannot inherit an offer from a different preparation or flavour',()=>{
 const base={product_name:'Brady Family Wood Smoked Irish Shredded Ham (90 g)',department:'Ham',service_area:'deli' as const,sku:'smoked',score:1,quote_text:'Two for five euro.'};
 assert.equal(matchesRequestedProductVariant('Brady Family Traditional Irish Shredded Ham 90 g offer',base),false);
 assert.equal(matchesRequestedProductVariant('Brady Family Wood-Smoked Irish Shredded Ham 90 g offer',base),true);
 assert.equal(matchesRequestedProductVariant('Any shredded ham offers?',base),true);
 assert.equal(matchesRequestedProductVariant('Not traditional ham, wood smoked please',base),true);
 assert.equal(matchesRequestedProductVariant('Not wood smoked ham',base),false);
 assert.equal(matchesRequestedProductVariant('Honey roast ham',{...base,product_name:'Honey Roasted Ham'}),true);
 assert.equal(matchesRequestedProductVariant('Honey roast carved ham offers?',{...base,product_name:'Traditional Carved Ham (120 g)'}),false);
 assert.equal(matchesRequestedProductVariant('Chicken tikka pieces',{...base,department:'Poultry',product_name:'BBQ Chicken Pieces (100 g)'}),false);
 assert.equal(matchesRequestedProductVariant('traditional bread',{...base,department:'Bread',service_area:'bakery' as any,product_name:'Brown Bread'}),true);
});

test('voice applies the shared variant rules outside deli, including exclusions and alternatives',()=>{
 const cases:[string,string,string,boolean][]=[
  ['Smoked mackerel','Smoked Rainbow Trout','Smoked Fish',false],
  ['Wholemeal bread','Wholemeal Spaghetti','Meals',false],
  ['Wholemeal bread','Wholemeal Tortilla Wraps','Bread',false],
  ['Grated cheddar','Cheddar Slices','Cheese',false],
  ['Grated cheddar','Grated Cheddar','Cheese',true],
  ['Laundry liquid','Laundry Powder','Household',false],
  ['Wet cat food','Wet Dog Food','Pets',false],
  ['Nappies size 6','Nappies Size 5','Baby',false],
  ['Any size 6 nappies','Nappies Size 6','Baby',true],
  ['Rosé wine','White Wine','Wine',false],
  ['Red or white wine','Red Wine','Wine',true],
  ['Skimmed milk','Semi Skimmed Milk','Milk',false],
  ['Strawberry yogurt','Vanilla Yogurt','Dairy',false],
  ['Orange juice','Apple Juice','Drinks',false],
  ['Shampoo','Conditioner','Beauty',false],
  ['Breaded cod','Battered Cod','Fish',false],
  ['Wholemeal bread','White Bread','Bakery',false],
  ['Thin pizza','Deep Pan Pizza','Frozen',false],
  ['Puppy food','Adult Dog Food','Pets',false],
 ];
 for(const [query,product_name,department,expected] of cases)assert.equal(matchesRequestedProductVariant(query,{product_name,department,sku:'test',score:1,quote_text:''}),expected,query);
 assert.equal(matchesRequestedDietLabel('Bread, not gluten-free bread',{product_name:'White Bread',department:'Bakery',sku:'test',score:1,quote_text:''}),true);
});
