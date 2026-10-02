import assert from 'node:assert/strict';
import {it} from 'node:test';
import {departmentClarification} from './department_clarification.js';
it('asks for a product preference across the whole shop, not just alcohol',()=>{
 assert.match(departmentClarification('Any dog food deals?')??'',/dry or wet/);
 assert.equal(departmentClarification('adult dog dry kibble, no cat food'),null);
 for(const query of ['any offers','any toiletries on offer','cosmetics offers','personal hygiene offers','alcohol department offers','off-licence offers','bakery offers','dairy offers','deli counter offers','meat counter offers','fish offers','fruit and veg offers','frozen food offers','household offers','baby offers','pet food offers','health and beauty offers','personal care offers','food cupboard offers','electrical department offers'])assert.ok(departmentClarification(query),query);
});
it('allows meaningful product preferences and explicit invitations to choose',()=>{
 for(const query of ['Choose one verified offer from bakery and one from household, any items are fine.','Any department is fine.','any items are fine'])assert.equal(departmentClarification(query),null,query);
 for(const query of ['alcohol offers lager','red wine offers','dairy cheese offers','bakery bread offers','deli counter ham','meat chicken offers','fish salmon offers','frozen pizza offers','baby nappies offers','pet dog treats','household laundry detergent','wine gums','beer battered cod','3 for 10 chicken','Super Fresh 5','show me a few examples from alcohol','anything is fine','all departments'])assert.equal(departmentClarification(query),null,query);
});
it('clarifies the complete public department navigation in customer requests',()=>{
 const departments=['Fruit & Vegetables','Bakery','Meat & Poultry','Fish & Seafood','Deli Counter','Cheese','Milk, Yogurt, Butter & Eggs','Health & Wellness','Chilled Food','Food Cupboard','Frozen Foods','Drinks','Beauty & Personal Care','Baby','Household & Cleaning','Pets','Wine, Beer & Spirits','Newsagent & Tobacconist'];
 for(const department of departments)for(const query of [`Any offers in ${department}?`,`Have ye got any deals in the ${department} section?`,`What products are available in ${department}?`])assert.ok(departmentClarification(query),query);
});
