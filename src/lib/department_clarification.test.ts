import assert from 'node:assert/strict';
import {it} from 'node:test';
import {departmentClarification,callerBroadensOfferSearch,departmentScope} from './department_clarification.js';
it('asks for a product preference across the whole shop, not just alcohol',()=>{
 assert.match(departmentClarification('Any dog food deals?')??'',/dry or wet/);
 assert.equal(departmentClarification('adult dog dry kibble, no cat food'),null);
 for(const query of ['any offers','any soft drink deals','soft drinks offers','fizzy drinks deals','any toiletries on offer','cosmetics offers','personal hygiene offers','alcohol department offers','off-licence offers','bakery offers','dairy offers','deli counter offers','meat counter offers','fish offers','fruit and veg offers','frozen food offers','household offers','baby offers','pet food offers','health and beauty offers','personal care offers','food cupboard offers','electrical department offers'])assert.ok(departmentClarification(query),query);
});
it('allows meaningful product preferences and explicit invitations to choose',()=>{
 for(const query of ['Choose one verified offer from bakery and one from household, any items are fine.','Any department is fine.','any items are fine'])assert.equal(departmentClarification(query),null,query);
 for(const query of ['alcohol offers lager','red wine offers','dairy cheese offers','bakery bread offers','deli counter ham','meat chicken offers','fish salmon offers','frozen pizza offers','baby nappies offers','pet dog treats','household laundry detergent','wine gums','beer battered cod','3 for 10 chicken','Super Fresh 5','show me a few examples from alcohol','anything is fine','all departments'])assert.equal(departmentClarification(query),null,query);
});
it('clarifies the complete public department navigation in customer requests',()=>{
 const departments=['Fruit & Vegetables','Bakery','Meat & Poultry','Fish & Seafood','Deli Counter','Cheese','Milk, Yogurt, Butter & Eggs','Health & Wellness','Chilled Food','Food Cupboard','Frozen Foods','Drinks','Beauty & Personal Care','Baby','Household & Cleaning','Pets','Wine, Beer & Spirits','Newsagent & Tobacconist'];
 for(const department of departments)for(const query of [`Any offers in ${department}?`,`Have ye got any deals in the ${department} section?`,`What products are available in ${department}?`])assert.ok(departmentClarification(query),query);
});

it('broadens only after a completed search in the same department',()=>{
 const history=['Any offers in deli?','Sliced ham at the counter','Any offers at all in deli?'];
 const previous={callerQuery:history[1]!,department:departmentScope(history[0]!)};
 assert.equal(callerBroadensOfferSearch(history[2]!,history,previous),true);
 assert.equal(callerBroadensOfferSearch(history[2]!,history),false);
 assert.equal(callerBroadensOfferSearch('Any offers at all in alcohol?',history,previous),false);
 assert.equal(callerBroadensOfferSearch('Any general offers?',history,previous),true);
 assert.ok(departmentClarification('Any offers at all in deli?'));
 for(const name of ['deli','meat','fish','bakery','dairy','produce','frozen','household','baby','pets','health','beauty','cheese','chilled','grocery','drinks','wine','newsagent']) {
  const last={callerQuery:`a specific product in ${name}`,department:departmentScope(name)};
  assert.equal(callerBroadensOfferSearch(`Any offers at all in ${name}?`,[],last),true,name);
 }
});

it('lunch, party, sliced-meat and generic multibuy requests still need an initial preference',()=>{
 for(const query of ['Any deli offers for lunch?','Is there any deli multibuy?','Any packaged sliced-meat offers?','Deli deals for a party?'])assert.ok(departmentClarification(query),query);
 assert.equal(departmentClarification('Chicken tikka offers for lunch'),null);
 assert.equal(departmentClarification('Show me a few current deli examples, packed ones are fine too'),null);
});
