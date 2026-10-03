// @ts-nocheck -- generated source is checked by the app build and catalogue tests.
// Generated from cara-platform by scripts/sync-catalogue-runtime.py. Do not edit.
/** Explicit product variants must be supported by the product or category evidence.
 * Context keeps words such as pods, white and sliced from constraining unrelated products.
 * Multiple alternatives in one family are allowed; missing evidence is not a match.
 */
const VARIANT_RULES: {context: RegExp; variants: RegExp[]}[] = [
  {context:/\b(?:ham|chicken|turkey|salami|beef|pastrami)\b/, variants:[/\btraditional\b/,/\bwood smoked\b/,/\bhoney roast(?:ed)?\b/,/\bwafer thin\b/,/\bcrumbed\b/,/\bcarved\b/,/\bshredded\b/,/\btikka\b/]},
  {context:/\bcheese|\bcheddar|\bmozzarella|\bgouda/, variants:[/\bgrated\b/,/\bslic(?:ed|es)\b/,/\b(?:block|solid block)\b/,/\b(?:spread|spreadable)\b/]},
  {context:/\b(?:milk|yogurt|yoghurt|cream)\b/, variants:[/\b(?:whole|full fat)\b/,/\b(?:semi skimmed|low fat)\b/,/(?<!semi )\bskimmed\b/]},
  {context:/\bwine\b/, variants:[/\bred\b/,/\bwhite\b/,/\bros(?:e\b|é(?=\s|$))/]},
  {context:/\b(?:laundry|detergent|washing)\b/, variants:[/\b(?:pods?|capsules?)\b/,/\bliquid\b/,/\bpowder\b/]},
  {context:/\b(?:shampoo|conditioner)\b/, variants:[/\bshampoo\b/,/\bconditioner\b/]},
  {context:/\b(?:dog|cat|canine|feline|puppy|puppies|kitten|kittens)\b/, variants:[/\b(?:dog|dogs|canine)\b/,/\b(?:cat|cats|feline)\b/]},
  {context:/\b(?:dog|cat|canine|feline|puppy|puppies|kitten|kittens)\b/, variants:[/\b(?:wet|pouches?)\b/,/\b(?:dry|kibble)\b/]},
  {context:/\b(?:dog|cat|canine|feline|puppy|puppies|kitten|kittens)\b/, variants:[/\b(?:puppy|puppies)\b/,/\bkittens?\b/,/\badult\b/]},
  {context:/\b(?:bread|rolls?|bagels?)\b/, variants:[/\bwholemeal\b/,/\bbrown\b/,/\bwhite\b/,/\bsourdough\b/]},
  {context:/\b(?:rice|pasta)\b/, variants:[/\b(?:microwave|ready to heat)\b/]},
  {context:/\b(?:yogurt|yoghurt|juice|ice cream)\b/, variants:[/\bstrawberry\b/,/\braspberry\b/,/\bvanilla\b/,/\bmango\b/,/\bpeach\b/,/\bblueberry\b/,/\borange\b/,/\bapple\b/]},
  {context:/\b(?:pizza)\b/, variants:[/\bthin\b/,/\bdeep pan\b/]},
  {context:/\b(?:salmon|trout|mackerel|haddock|cod)\b/, variants:[/\bsmoked\b/,/\bbreaded\b/,/\bbattered\b/]},
];
function normalizeVariant(text:string):string {
 return text.toLowerCase().replace(/[-’']/g,' ').replace(/\bwoodsmoked\b/g,'wood smoked').replace(/\s+/g,' ');
}
export function matchesRetailProductVariants(query:string,name:string,category=''):boolean {
 const original=normalizeVariant(query), positive=normalizeVariant(positiveRetailQuery(query));
 const evidence=normalizeVariant(`${name} ${category}`);
 const exclusions=[...original.matchAll(/\b(?:not|no(?!\s+(?:drain|added\s+sugar|artificial))|without|excluding|except|rather than)\s+(?:the\s+)?([^,.!?;]+)/g)].map(m=>m[1]!);
 for(const rule of VARIANT_RULES) {
  if(!rule.context.test(original))continue;
  const requested=rule.variants.filter(v=>v.test(positive));
  const supported=requested;
  if(supported.length && (/\bor\b/.test(positive) ? !supported.some(v=>v.test(evidence)) : !supported.every(v=>v.test(evidence))))return false;
  for(const exclusion of exclusions)for(const variant of rule.variants) {
   if(variant.test(exclusion)&&variant.test(evidence))return false;
  }
 }
 // Sizes identify baby products, rather than an arbitrary numeral in a pack name.
 const size=/\b(?:napp(?:y|ies)|diapers?|pull ups?)\b/.test(positive)?positive.match(/\bsize\s*(\d+)\b/):null;
 if(size&&(!/\b(?:napp(?:y|ies)|diapers?|pull ups?)\b/.test(evidence)||!new RegExp(`\\bsize\\s*${size[1]}\\b`).test(evidence)))return false;
 // These labels are evidence requirements, never allergy or certification guarantees.
 for(const label of [/\bgluten free\b/,/\bdairy free\b/,/\bvegan\b/]) {
  if(label.test(positive)&&!label.test(evidence)&&!(label.source==='\\bvegan\\b'&&/\bplant based\b/.test(evidence)))return false;
 }
 return true;
}

/** Keep exclusions out of positive matching, but enforce them on candidates. */
export function positiveRetailQuery(query: string): string {
  return query
    .replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(?=(?:pack|can|bottle|piece)s?\b)/gi, (_match,word:string) => `${({one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,eleven:11,twelve:12} as Record<string,number>)[word.toLowerCase()]} `)
    .replace(/\bcans\b/gi, "can")
    .replace(/\b(\d+(?:[.,]\d+)?)\s*(ml|cl|kg|g|l)\b/gi, "$1 $2")
    .replace(/\b(?:regular|normal|alcoholic)\b/gi, word => /\b(?:guinness|beer|lager|stout|cider)\b/i.test(query) ? " " : word)
    .replace(/\b(?:to|for)\s+(?:boil(?:ing)?|cook(?:ing)?)\s+(?:it\s+)?myself\b/gi, " ")
    .replace(/\b(?:that\s+)?(?:expir(?:e|es|ing)|end(?:s|ing)?)\b.*?(?:this Sunday|\d{4}-\d{2}-\d{2})/gi, " ")
    .replace(/\b(?:not|no(?!\s+(?:drain|added\s+sugar|artificial\s+(?:colours?|colors?|flavou?rs?)))|without|excluding|except|rather than)\s+(?:the\s+)?[^,.!?;]+/gi, " ")
    .replace(/\b(?:standard price|regular price|bundle price|anything is fine|any make|any brand|in cans please|solid block|sealed packets)\b/gi, " ")
    .replace(/\bsealed\b/gi, " ")
    .replace(/\bkibble\b/gi, "dry food")
    .replace(/\bdry\s+dry\b/gi, "dry")
    .replace(/\badult\b/gi, word => /\bdogs?\b/i.test(query) ? " " : word)
    .replace(/\bdark\s+(?=stout)/gi, "")
    .replace(/\s+/g, " ").trim();
}
export function matchesRetailQueryConstraints(query: string, name: string, category = ""): boolean {
  if (!matchesRetailProductVariants(query,name,category)) return false;
  const text = `${name} ${category}`.toLowerCase();
  const positive = positiveRetailQuery(query);
  const normalizedCuts=(value:string)=>value.toLowerCase().replace(/\brib[ -]?eye\b/g,"ribeye").replace(/\bt[ -]?bone\b/g,"tbone");
  const requestedCuts=["striploin","sirloin","ribeye","topside","rump","tbone"].filter(cut=>new RegExp(`\\b${cut}\\b`,"i").test(normalizedCuts(positive)));
  if(requestedCuts.length && !requestedCuts.some(cut=>new RegExp(`\\b${cut}\\b`,"i").test(normalizedCuts(text))))return false;
  const species = ["beef", "pork", "lamb", "chicken", "turkey", "duck", "venison"];
  const requestedSpecies = species.filter(word=>new RegExp(`\\b${word}\\b`,"i").test(positive));
  if (requestedSpecies.length===1) {
    const requested=requestedSpecies[0]!;
    const nameSpecies=species.filter(word=>new RegExp(`\\b${word}\\b`,"i").test(name));
    if (nameSpecies.length && !nameSpecies.includes(requested)) return false;
    if (!new RegExp(`\\b${requested}\\b`,"i").test(text)) return false;
  }
  if (/\b(?:regular|normal|alcoholic)\b/i.test(query) && /\b(?:guinness|beer|lager|stout|cider)\b/i.test(query) && /0[.,]0|alcohol[- ]free|non[- ]?alcoholic/i.test(name)) return false;
  if (/\badult\b/i.test(query) && /\bdogs?\b/i.test(query) && (!/\badult\b/i.test(text) || /\b(?:puppy|puppies)\b/i.test(name))) return false;
  if (/\bwhisk(?:e)?y\b/i.test(positive) && !/\bwhisk(?:e)?y\b/i.test(text)) return false;
  if (/\bminiatures?\b/i.test(positive)) {
    const volume=name.match(/\b(\d+(?:[.,]\d+)?)\s*(ml|cl|l)\b/i);
    if(!volume)return false;
    const ml=Number(volume[1]!.replace(",",".")) * ({ml:1,cl:10,l:1000}[volume[2]!.toLowerCase()] ?? 1);
    if(ml>200)return false;
  }
  if (/\bsmoked salmon\b/i.test(positive) && !/\bsmoked\b/i.test(text) || /\bsmoked salmon\b/i.test(positive) && !/\bsalmon\b/i.test(text)) return false;
  if (/\bgluten[- ]free\b/i.test(positive) && /\bbread\b/i.test(positive) && (!/\b(?:bread|crispbread|breadrolls?)\b/i.test(text) || /\bbreaded\b/i.test(name))) return false;
  if (/\bdogs?\b/i.test(positive) && /\b(?:dry|kibble)\b/i.test(query) && (!/\b(?:dogs?|canine)\b/i.test(text) || !/\b(?:dry|kibble)\b/i.test(text))) return false;
  if (/\bcats?\b/i.test(positive) && /\bdry\b/i.test(query) && (!/\bcats?\b/i.test(text) || !/\bdry\b/i.test(text))) return false;
  if (/\bpasta\b/i.test(query) && /\b(?:boil|cooking|cook)\b/i.test(query)) {
    if (!/\b(?:pasta|spaghetti|penne|fusilli|linguine|ravioli|tortellini|tagliatelle|rigatoni|macaroni)\b/i.test(text) || /\b(?:instant|ready to heat|microwave|hot snacks)\b/i.test(text)) return false;
  }
  if (/\bice cream\b/i.test(query) && !/\bice cream\b/i.test(text)) return false;
  const negatives = [...query.matchAll(/\b(?:not|no(?!\s+(?:drain|added\s+sugar|artificial\s+(?:colours?|colors?|flavou?rs?)))|without|excluding|except|rather than)\s+(?:the\s+)?([^,.!?;]+)/gi)];
  for (const negative of negatives) {
    const clause = negative[1]!;
    for (const [words, candidate] of [
      [/\b(?:spread|spreadable)\b/i, /\b(?:spread|spreadable)\b/i],
      [/\bslices?\b/i, /\b(?:sliced|slices)\b/i],
      [/\bred wine\b/i, /\bred\b/i],
      [/\bdog food\b/i, /\bdog\b/i],
      [/\b(?:wet|pouches)\b/i, /\b(?:wet|pouch|pouches)\b/i],
      [/\bpods?\b/i, /\bpods?\b/i],
      [/\bapples?\b/i, /\bapples?\b/i],
      [/\bbananas?\b/i, /\bbananas?\b/i],
      [/\bsoftener\b/i, /\bsoftener\b/i],
      [/\baerosol\b/i, /\b(?:aerosol|spray)\b/i],
      [/\bprotein bars?\b/i, /\bbar(?:s)?\b/i],
      [/\b(?:microwave rice|ready meals?)\b/i, /\b(?:microwave|ready meal)\b/i],
      [/\bnitrosurge\b/i, /\bnitrosurge\b/i],
    ] as [RegExp, RegExp][]) if (words.test(clause) && candidate.test(text)) return false;
  }
  if (/\b(?:stout|lager)\b/i.test(positiveRetailQuery(query)) && /\bcans?\b/i.test(query)) {
    const type = /\bstout\b/i.test(query) ? /\bstout\b/i : /\b(?:lager|pilsner)\b/i;
    if (!type.test(text)) return false;
  }
  if (!/\bor\b/i.test(positive) && /\bwhite wine\b/i.test(positive) && !/\bwhite\b/i.test(text)) return false;
  if (/\bdairy[- ]free\b/i.test(query) && /\bice cream\b/i.test(query) && !/dairy[- ]free|non[- ]dairy|vegan|swedish glace|plant[- ]based/i.test(text)) return false;
  return true;
}
