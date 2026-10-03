/** A department names a place to look, not the caller's product preference. */
const DEPARTMENTS = new Set([
  'soft drink', 'soft drinks', 'fizzy drink', 'fizzy drinks', 'non alcoholic drinks', 'alcohol', 'alcoholic drinks', 'drinks', 'off licence', 'off license',
  'sliced meat', 'sliced meats', 'cooked meats', 'meat', 'butcher', 'butchers', 'deli', 'delicatessen', 'fish', 'seafood',
  'bakery', 'dairy', 'produce', 'fruit', 'veg', 'vegetables', 'fruit veg', 'fruit vegetables',
  'frozen', 'frozen food', 'household', 'cleaning', 'baby', 'baby care', 'pet', 'pets', 'pet food',
  'toiletries', 'personal hygiene', 'cosmetics', 'health', 'beauty', 'health beauty', 'personal care', 'grocery', 'groceries', 'food cupboard',
  'ambient', 'confectionery', 'snacks', 'chilled', 'wine', 'beer', 'spirits',
  'fruit vegetables', 'meat poultry', 'fish seafood', 'deli counter', 'cheese',
  'milk yogurt butter eggs', 'milk yoghurt butter eggs', 'health wellness',
  'chilled food', 'frozen foods', 'beauty personal care', 'household cleaning',
  'wine beer spirits', 'newsagent tobacconist', 'newsagent', 'tobacconist',
]);
const FILLER = new Set(('i im was just wondering hello hi there do you ye have got any anything all else general overall multibuy multibuys lunch lunches party parties discounts discount cheap cheaper stuff things packaged what whats is are the a an in on at from for of and this week weekly today current latest offers offer deals deal specials special promotions promotion please section sections department departments aisle aisles counter counters prepack prepacked pre packed fresh range stock sell selling available products items can could tell me about your').split(' '));
export function departmentClarification(query: string): string | null {
  const q = query.toLowerCase().replace(/[’']/g, '').replace(/off[- ]licen[cs]e/g,'off licence');
  // An explicit invitation to choose examples is different from "any offers?".
  if (callerInvitesExamples(query)) return null;
  if (/^(?:(?:all|current|weekly)\s+)?multibuys?[.!?]?$/i.test(q.trim())) return null;
  if (/\b(?:super\s*(?:7|seven|fresh\s*5)|rewards.*(?:€|\d)|\d+\s+for\s+\d+)\b/.test(q)) return null;
  const words=q.replace(/[^a-z0-9\s]/g,' ').split(/\s+/).filter(Boolean).filter(w=>!FILLER.has(w));
  const subject=words.join(' ');
  if (/^steaks?$/.test(words.filter(word=>!['meat','butcher','butchers'].includes(word)).join(' '))) return 'Were you after beef steaks, or another kind?';
  if (/^(?:dog|cat) food$/.test(subject)) return 'Was it dry or wet food you were after?';
  const explicitUnnamedDepartment = /\b(?:department|section|aisle)\b/.test(q) && words.length===1;
  if (!subject) return 'What sort of product were you looking for?';
  if (!DEPARTMENTS.has(subject) && !explicitUnnamedDepartment) return null;
  return 'What sort of thing did you have in mind in that section?';
}
export function callerInvitesExamples(query:string):boolean {
 return /\b(?:show|give|choose|pick|list)\b.{0,60}\bexamples\b/i.test(query) || /\b(?:surprise me|(?:anything|any items?|any department) (?:is|are) fine|whatever you recommend|(?:a few|some|offer|verified|two|three|couple of) examples|choose.*(?:examples|offers?)|give me a selection|show me a selection|all departments|every department|whole shop|all.shop rundown)\b/i.test(query);
}
const SCOPE_GROUPS=[['deli','delicatessen'],['alcohol','off licence','off license','wine','beer','spirits'],['meat','butcher','poultry'],['fish','seafood'],['bakery'],['dairy','milk','yogurt','yoghurt','butter','eggs'],['produce','fruit','veg','vegetables'],['frozen'],['household','cleaning'],['baby','nappies','nappy'],['pets','pet','dog','cat'],['health','wellness'],['beauty','personal care','toiletries','cosmetics'],['cheese'],['chilled'],['food cupboard','grocery','groceries','ambient'],['drinks','soft drinks'],['newsagent','tobacconist']];
export function departmentName(scope:number|undefined):string|undefined { return scope===undefined ? undefined : SCOPE_GROUPS[scope]?.[0]; }
export function departmentScope(query:string):number|undefined {
 const normalized=query.toLowerCase().replace(/[-&]/g,' ');
 const index=SCOPE_GROUPS.findIndex(group=>group.some(alias=>new RegExp(`\\b${alias}\\b`).test(normalized)));
 return index===-1?undefined:index;
}
/** A broader follow-up after a real product search is permission to browse that same department. */
export function callerBroadensOfferSearch(query:string,history:string[],lastLookup?:{callerQuery:string; department?:number}):boolean {
 if(!lastLookup||! /\b(?:offers?|deals?|specials?|promotions?)\b/i.test(query)||! /\bat all\b|\b(?:anything|everything|all|general|overall)\b|\bany (?:other|else)\b/i.test(query))return false;
 const previousScope=lastLookup.department??departmentScope(lastLookup.callerQuery);
 const currentScope=departmentScope(query);
 return previousScope!==undefined&&(currentScope===undefined||currentScope===previousScope);
}
