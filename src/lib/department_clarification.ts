/** A department names a place to look, not the caller's product preference. */
const DEPARTMENTS = new Set([
  'alcohol', 'alcoholic drinks', 'drinks', 'off licence', 'off license',
  'meat', 'butcher', 'butchers', 'deli', 'delicatessen', 'fish', 'seafood',
  'bakery', 'dairy', 'produce', 'fruit', 'veg', 'vegetables', 'fruit veg', 'fruit vegetables',
  'frozen', 'frozen food', 'household', 'cleaning', 'baby', 'baby care', 'pet', 'pets', 'pet food',
  'health', 'beauty', 'health beauty', 'personal care', 'grocery', 'groceries', 'food cupboard',
  'ambient', 'confectionery', 'snacks', 'chilled', 'wine', 'beer', 'spirits',
  'fruit vegetables', 'meat poultry', 'fish seafood', 'deli counter', 'cheese',
  'milk yogurt butter eggs', 'milk yoghurt butter eggs', 'health wellness',
  'chilled food', 'frozen foods', 'beauty personal care', 'household cleaning',
  'wine beer spirits', 'newsagent tobacconist', 'newsagent', 'tobacconist',
]);
const FILLER = new Set(('i im was just wondering hello hi there do you ye have got any anything what whats is are the a an in on at from for of and this week weekly today current latest offers offer deals deal specials special promotions promotion please section sections department departments aisle aisles counter counters prepack prepacked pre packed fresh range stock sell selling available products items can could tell me about your').split(' '));
export function departmentClarification(query: string): string | null {
  const q = query.toLowerCase().replace(/[’']/g, '').replace(/off[- ]licen[cs]e/g,'off licence');
  // An explicit invitation to choose examples is different from "any offers?".
  if (callerInvitesExamples(query)) return null;
  if (/\b(?:super\s*(?:7|seven|fresh\s*5)|rewards.*(?:€|\d)|\d+\s+for\s+\d+)\b/.test(q)) return null;
  const words=q.replace(/[^a-z0-9\s]/g,' ').split(/\s+/).filter(Boolean).filter(w=>!FILLER.has(w));
  const subject=words.join(' ');
  const explicitUnnamedDepartment = /\b(?:department|section|aisle)\b/.test(q) && words.length===1;
  if (!subject) return 'What sort of product were you looking for?';
  if (!DEPARTMENTS.has(subject) && !explicitUnnamedDepartment) return null;
  return 'What sort of thing did you have in mind in that section?';
}
export function callerInvitesExamples(query:string):boolean {
 return /\b(?:surprise me|(?:anything|any items?|any department) (?:is|are) fine|whatever you recommend|(?:a few|some|offer|verified|two|three|couple of) examples|choose.*(?:examples|offers?)|give me a selection|show me a selection|all departments|every department|whole shop|all.shop rundown)\b/i.test(query);
}
