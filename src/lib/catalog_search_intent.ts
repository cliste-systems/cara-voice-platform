import { inferRewardsPricePoint } from './rewards_price_point.js';

export type CatalogSearchIntent = 'offer' | 'price' | 'stock';

// Keep promotion mechanics intact: dropping these words changes which prices qualify.
const PROMOTION_MECHANIC = /\bmulti[- ]?buys?\b|\bmix\s*(?:and|&)\s*match\b|\bsuper\s*(?:7|seven)(?:['’]?s)?\b|\b(?:\d+|two|three|four|five|six)\s+for\s+(?:€\s*)?(?:\d+(?:[.,]\d+)?|(?:a\s+)?tenner|ten|five|twenty)\b|\bbuy\s+(?:one|two|\d+)\b.*\bget\b|\bhalf[- ]price\b|\b\d+\s*%\s*off\b/i;
export function callerRequestsLowestPrice(query: string): boolean {
  return /\b(?:cheapest|least expensive|lowest(?:[ -]priced?| cost)?|best price)\b/i.test(query);
}

const OFFER_WORDS = /\boffers?\b|\bdeals?\b|\bspecials?\b|\bpromos?\b|\bpromotions?\b|\breduced\b|\bdiscounts?\b|\bprice\s+cuts?\b|\bthis\s+week\b|\bon\s+sale\b|\bis it on\b|\bare they on\b/i;

export function inferCatalogSearchIntent(query: string): CatalogSearchIntent {
  const q = query.toLowerCase();
  if (
    /\brewards?\s+price\b|\breal\s+rewards\b.*\b(?:offers?|deals?|price|specials?)\b|\b(?:offers?|deals?|price|specials?)\b.*\breal\s+rewards\b|\brewards?\b.*(?:€\s*\d|\b\d+[.,]\d{1,2}\b|\b(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen)\s+(?:euro(?:s)?\s+)?(?:ten|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)\b)/i.test(q)
  ) {
    return 'offer';
  }
  if (OFFER_WORDS.test(q) || PROMOTION_MECHANIC.test(q)) return 'offer';
  if (callerRequestsLowestPrice(q)) return 'price';
  if (
    /\bhow much\b|\bprice\b|\bcost\b|\bwhat'?s the price\b|\bhow much is\b|\bwhat is the price\b/i.test(
      q,
    )
  ) {
    return 'price';
  }
  return 'stock';
}

export function resolveCatalogSearchIntent(input: {
  query: string;
  explicitIntent?: CatalogSearchIntent;
  callerAskedAboutOffers?: boolean;
}): CatalogSearchIntent | undefined {
  if (input.explicitIntent) return input.explicitIntent;
  const fromQuery = inferCatalogSearchIntent(input.query);
  if (fromQuery !== 'stock') return fromQuery;
  if (input.callerAskedAboutOffers) return 'offer';
  return undefined;
}

/** Caller wants a department/campaign rundown, rather than a specific product. */
export function inferWeeklyOffersListIntent(query: string): boolean {
  const trimmed = query.trim();
  if (!trimmed || PROMOTION_MECHANIC.test(trimmed)) return true;
  if (/\b(?:weekly offers|best offers?|list offers|list (?:five|5|\d+)|surprise me|highlights|apart from meat|not meat|non[- ]meat)\b/i.test(trimmed)) {
    return true;
  }
  if (inferWeeklyOffersBrowseCategories(trimmed).length >= 2) return true;
  const tokens = trimmed.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
  const browseWords = new Set([
    'what', 'which', 'whats', 's', 'is', 'are', 'there', 'any', 'anything', 'everything',
    'all', 'current', 'latest', 'weekly', 'this', 'week', 'today', 'now', 'the', 'a', 'an',
    'in', 'at', 'on', 'from', 'for', 'and', 'or', 'of', 'to', 'do', 'you', 'ye', 'have',
    'got', 'tell', 'me', 'your', 'please', 'list', 'show', 'across', 'every', 'whole',
    'offer', 'offers', 'special', 'specials', 'deal', 'deals', 'promo', 'promos',
    'promotion', 'promotions', 'reduced', 'discount', 'discounts', 'sale',
    'meat', 'butcher', 'butchers', 'fish', 'seafood', 'deli', 'dairy', 'bakery',
    'produce', 'fruit', 'veg', 'vegetables', 'grocery', 'groceries', 'ambient',
    'frozen', 'household', 'baby', 'pet', 'health', 'beauty', 'wine', 'beer',
    'spirits', 'off', 'licence', 'license', 'counter', 'counters', 'aisle', 'aisles',
    'section', 'sections', 'department', 'departments', 'shop', 'store', 'national',
    'pre', 'pack', 'prepack', 'packaged', 'fresh', 'chilled', 'food', 'foods',
  ]);
  return tokens.length > 0 && tokens.every((token) => browseWords.has(token));
}

function inferWeeklyOffersBrowseCategories(query: string): string[] {
  const trimmed = query.trim().toLowerCase();
  const tokens = trimmed
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1);
  const categoryHints = new Set([
    'milk',
    'bread',
    'crisps',
    'chocolate',
    'fruit',
    'yogurt',
    'cheese',
    'butter',
    'tea',
    'coffee',
    'biscuits',
    'sweets',
    'confectionery',
    'drinks',
    'household',
    'frozen',
  ]);
  const fromTokens = tokens.filter((token) => categoryHints.has(token));
  if (fromTokens.length >= 2) return fromTokens.slice(0, 5);
  if (/confectionery|sweets|candy/.test(trimmed)) return ['chocolate', 'sweets'];
  if (/\bapart from meat\b|\bnot meat\b|\bgrocery offers\b|\bnon[- ]meat\b/i.test(trimmed)) {
    return ['chocolate', 'crisps', 'yogurt', 'bread', 'fruit'];
  }
  if (/\blist\b|\bfive\b|\b5\b|weekly offers|best deal|sample|highlights/i.test(trimmed)) {
    return ['chocolate', 'crisps', 'yogurt', 'bread', 'fruit'];
  }
  return [];
}

export function trackCallerCatalogSearchIntent(
  text: string,
  flags: { callerAskedAboutOffers?: boolean; callerWantsLowestPrice?: boolean; callerLowestPriceOffersOnly?: boolean; callerBarbecueCooking?: boolean; callerMeatPreference?: boolean; rewardsPricePoint?: number | null },
): void {
  const t = text.toLowerCase();
  if (/\b(?:vegetarian|vegan|meat[- ]free|plant[- ]based)\b/i.test(text)) flags.callerMeatPreference = false;
  else if (/\bmeat\b/i.test(text)) flags.callerMeatPreference = true;
  // Keep the intended preparation across "burgers" / "what is cheapest" follow-ups.
  if (/\b(?:not for (?:a )?(?:barbecue|barbeque|bbq)|ready[- ]?made|ready meal|microwave)\b/i.test(text)) {
    flags.callerBarbecueCooking = false;
  } else if (/\b(?:barbecue|barbeque|bbq)\b/i.test(text) && !/\b(?:sauce|marinade|flavou?r|rub)\b/i.test(text)) {
    flags.callerBarbecueCooking = true;
  }
  if (callerRequestsLowestPrice(text)) {
    flags.callerWantsLowestPrice = true;
    flags.callerLowestPriceOffersOnly = OFFER_WORDS.test(text) || PROMOTION_MECHANIC.test(text);
    flags.callerAskedAboutOffers = flags.callerLowestPriceOffersOnly;
    flags.rewardsPricePoint = null;
    return;
  }
  const rewardsPricePoint = inferRewardsPricePoint(text);
  flags.rewardsPricePoint = rewardsPricePoint;
  if (rewardsPricePoint != null) {
    flags.callerAskedAboutOffers = true;
    flags.callerWantsLowestPrice = false;
    flags.callerLowestPriceOffersOnly = false;
    return;
  }
  if (inferCatalogSearchIntent(t) === 'offer') {
    flags.callerAskedAboutOffers = true;
    flags.callerWantsLowestPrice = false;
    flags.callerLowestPriceOffersOnly = false;
    return;
  }
  if (
    /\bhow much\b|\bwhat'?s the price\b|\bhow much is\b|\bprice of\b|\bwhat is the price\b/i.test(
      t,
    )
  ) {
    flags.callerAskedAboutOffers = false;
    flags.callerWantsLowestPrice = false;
    flags.callerLowestPriceOffersOnly = false;
    return;
  }
  if (
    /\b(do you sell|do you stock|do you carry|have you got)\b/i.test(t) &&
    !/\boffer\b/i.test(t)
  ) {
    flags.callerAskedAboutOffers = false;
    flags.callerWantsLowestPrice = false;
    flags.callerLowestPriceOffersOnly = false;
  }
}
