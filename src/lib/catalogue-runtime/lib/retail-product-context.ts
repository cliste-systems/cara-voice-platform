// @ts-nocheck -- generated source is checked by the app build and catalogue tests.
// Generated from cara-platform by scripts/sync-catalogue-runtime.py. Do not edit.
/** Cooking context is a constraint on burger form, not part of its product name. */
export function queryRequestsBurgersForCooking(query: string): boolean {
  return /\bburgers?\b/i.test(query) &&
    /\b(?:bbq|barbecues?|barbeques?|barbecuing|barbequing|grill|grilling|raw|uncooked|cooking)\b/i.test(query) &&
    !/\bburger\s+(?:sauce|buns?|relish|mayonnaise|mayo|seasoning)\b/i.test(query);
}

export function queryRequestsMeatBurgers(query: string): boolean {
  return /\bburgers?\b/i.test(query) && /\bmeat\b/i.test(query) &&
    !/\b(?:vegetarian|vegan|veggie|plant[ -]based|meat[ -]free|meatless|no meat|without meat)\b/i.test(query);
}

export function stripBurgerSearchContext(query: string): string {
  let result = query;
  if (queryRequestsBurgersForCooking(query) || queryRequestsMeatForCooking(query)) result = result.replace(/\b(?:bbq|barbecues?|barbeques?|barbecuing|barbequing|grill|grilling|raw|uncooked|cooking)\b/gi, " ");
  if (queryRequestsMeatBurgers(query)) result = result.replace(/\bmeat\b/gi, " ");
  return result.replace(/\s{2,}/g, " ").trim();
}

/** Use catalogue evidence; do not guess a product's preparation from its brand. */
export function isPreparedBurgerProduct(productName: string, department = ""): boolean {
  return /\b(?:single[ -]serve|ready[ -]meals?|ready[ -]to[ -]eat|microwave|microwavable|fully[ -]cooked|pre[ -]cooked)\b/i.test(`${productName} ${department}`) ||
    /\bburgers?\s+(?:(?:with|and|&)\s+)?(?:fries|chips|dinners?|meals?)\b/i.test(productName);
}

export function matchesBurgerProductContext(query: string, productName: string, department = ""): boolean {
  if (queryRequestsBurgersForCooking(query) && isPreparedBurgerProduct(productName, department)) return false;
  if (!queryRequestsMeatBurgers(query)) return true;
  const text = `${productName} ${department}`;
  if (/\b(?:vegetarian|vegan|veggie|plant[ -]based|meat[ -]free|meatless|no[ -]beef)\b/i.test(text)) return false;
  return /\b(?:beef|chicken|turkey|lamb|pork|steak|venison|bison|buffalo|duck|meats?)\b/i.test(text);
}

/** Explicit cooking intent must not turn into a barbecue-flavoured deli search. */
export function queryRequestsMeatForCooking(query: string): boolean {
  return /\b(?:chicken|turkey|pork|beef|lamb|meat|steaks?|sausages?|burgers?)\b/i.test(query) &&
    /\b(?:for\s+(?:the\s+)?(?:bbq|barbecues?|barbeques?|grill|grilling|cooking)|to\s+(?:cook|grill|barbecue)|raw|uncooked)\b/i.test(query) &&
    !/\b(?:sauce|marinade|rub|seasoning)\b/i.test(query);
}

export function matchesMeatCookingContext(query: string, productName: string, category = ""): boolean {
  if (!queryRequestsMeatForCooking(query)) return true;
  return !/\b(?:cooked|rotisserie|ready[ -]meals?|ready[ -]to[ -]eat|microwavable|microwave|sliced cooked meats)\b/i.test(`${productName} ${category}`) &&
    !/\broast(?:ed)?\b.{0,40}\b(?:chicken|turkey)\s+(?:pieces|slices)\b/i.test(productName);
}


export function requestedNappySize(query: string): string|null {
  if (!/\b(?:napp(?:y|ies)|diapers?)\b/i.test(query)) return null;
  const words:Record<string,string>={one:"1",two:"2",three:"3",four:"4",five:"5",six:"6",seven:"7",eight:"8",nine:"9"};
  const normalized=query.replace(/\b(one|two|three|four|five|six|seven|eight|nine)\b/gi,word=>words[word.toLowerCase()] ?? word);
  const size=normalized.match(/\bsize\s*([0-9]+)(?:\s*(\+|plus))?/i);
  return size ? `${size[1]}${size[2]?"+":""}` : null;
}

export function matchesNappySizeContext(query: string, productName: string, category=""): boolean {
  const wanted=requestedNappySize(query);if(!wanted)return true;
  if (!/\b(?:napp(?:y|ies)|diapers?|pampers|huggies)\b/i.test(`${productName} ${category}`)) return false;
  if (/\bnappy pants\b/i.test(query) && !/\b(?:nappy pants|pants)\b/i.test(productName)) return false;
  const size=`${productName} ${category}`.match(/\bsize\s*([0-9]+)(?:\s*(\+|plus))?/i);
  return Boolean(size && `${size[1]}${size[2]?"+":""}`===wanted);
}
