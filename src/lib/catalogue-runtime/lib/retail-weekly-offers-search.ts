// @ts-nocheck -- generated source is checked by the app build and catalogue tests.
// Generated from cara-platform by scripts/sync-catalogue-runtime.py. Do not edit.
import { positiveRetailQuery, matchesRetailQueryConstraints } from "./retail-query-constraints.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { stripPriceComparisonWords, type RetailPriceBasis } from "./retail-price-comparison.js";
import { matchesNappySizeContext, requestedNappySize, matchesMeatCookingContext, queryRequestsMeatBurgers, stripBurgerSearchContext } from "./retail-product-context.js";

import type {
  RetailWeeklyOfferRow,
  SupervaluFulfilment,
  SupervaluOfferChannel,
  SupervaluServiceArea,
} from "./supervalu-offers-types.js";
import {
  currentSupervaluOfferWeek,
  normalizeSearchText,
} from "./supervalu-offers-normalize.js";
import { formatInTimeZone } from "date-fns-tz";
import { retailSearchTokenMatchesText, retailSearchTokenSimilarity } from "./retail-search-fuzzy.js";
import { isRetailOfferObservationFresh, RETAIL_OFFER_MAX_SOURCE_AGE_MS, RETAIL_OFFERS_UNVERIFIED_MESSAGE } from "./retail-offer-freshness.js";
import { parseRetailMultibuyLabel } from "./retail-price-presentation.js";
import { filterWeeklyOffersByPromotionQuery, parseRetailPromotionQuery, shouldUseStructuredPromotionSearch } from "./retail-promotion-search.js";
import {
  formatSpokenDiscountLabel,
  formatSpokenEurAmount,
  formatSpokenInteger,
  speakEmbeddedEurAmounts,
} from "./spoken-eur-price.js";

const DUBLIN = "Europe/Dublin";
// A lookup tests thousands of rows against one reference date. Reuse the
// calendar conversion without retaining request dates or ignoring mutations.
const retailCalendarDays = new WeakMap<Date, { timestamp: number; day: string }>();
function retailCalendarDay(reference: Date): string {
  const timestamp = reference.getTime();
  const cached = retailCalendarDays.get(reference);
  if (cached?.timestamp === timestamp) return cached.day;
  const day = formatInTimeZone(reference, DUBLIN, "yyyy-MM-dd");
  retailCalendarDays.set(reference, { timestamp, day });
  return day;
}

/** Both boundaries are inclusive in the retailer's Dublin calendar. */
export function isRetailOfferWeekActive(
  row: Pick<RetailWeeklyOfferRow, "offer_week_start" | "offer_week_end">,
  reference = new Date(),
): boolean {
  const end = String(row.offer_week_end ?? "").trim();
  const start = String(row.offer_week_start ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) return false;
  const today = retailCalendarDay(reference);
  return start <= today && end >= today;
}

export function isRetailOfferPriceSemanticallyValid(
  row: Pick<
    RetailWeeklyOfferRow,
    "current_price_eur" | "was_price_eur" | "discount_label"
  >,
): boolean {
  const label = String(row.discount_label ?? "").trim();
  const validBundle = parseRetailMultibuyLabel(label) != null;
  // A verified bundle total remains useful even when stores disagree on the
  // individual shelf price. Null means unknown, never free or zero euro.
  if (row.current_price_eur == null) return validBundle;
  const current = Number(row.current_price_eur);
  if (!Number.isFinite(current) || current <= 0) return false;

  const was =
    row.was_price_eur == null ? null : Number(row.was_price_eur);
  if (was != null && (!Number.isFinite(was) || was <= 0)) return false;

  const saveAmount = label.match(
    /^save\s*€\s*([0-9]+(?:[.,][0-9]{1,2})?)/i,
  );
  if (saveAmount) {
    if (was == null || was <= current) return false;
    const amount = Number(saveAmount[1]!.replace(",", "."));
    return (
      Number.isFinite(amount) &&
      Math.abs((was - current) - amount) <= 0.03
    );
  }

  const savePercent = label.match(
    /^save\s*([0-9]+(?:[.,][0-9]+)?)\s*%/i,
  );
  if (savePercent) {
    if (was == null || was <= current) return false;
    const expected = Number(savePercent[1]!.replace(",", "."));
    const actual = ((was - current) / was) * 100;
    return Number.isFinite(expected) && Math.abs(actual - expected) <= 1.5;
  }

  const explicitOfferPrice = label.match(
    /(?:rewards?\s+price(?:\s+only)?|\bonly)\s*€\s*([0-9]+(?:[.,][0-9]{1,2})?)/i,
  );
  if (explicitOfferPrice && !validBundle) {
    const amount = Number(explicitOfferPrice[1]!.replace(",", "."));
    if (!Number.isFinite(amount) || Math.abs(current - amount) > 0.02) {
      return false;
    }
  }

  if (
    was != null &&
    current > was &&
    /save|reward|offer|deal|only/i.test(label)
  ) {
    return false;
  }

  return true;
}

export function filterRetailWeeklyOffersToActiveWeek(
  rows: RetailWeeklyOfferRow[],
  reference = new Date(),
): RetailWeeklyOfferRow[] {
  return rows.filter(
    (row) =>
      isRetailOfferWeekActive(row, reference) &&
      isRetailOfferObservationFresh(row.synced_at, reference) &&
      isRetailOfferPriceSemanticallyValid(row),
  );
}

export function activeRetailOfferWeekKey(reference = new Date()): string {
  return currentSupervaluOfferWeek(reference).start;
}

export type SyncedOffersFreshness = {
  stale: boolean;
  syncedAt: string | null;
  offerWeekStart: string | null;
  offerWeekEnd: string | null;
  message: string | null;
};

/** Warn voice lookup when synced offers are from a past week or sync is old. */
export function assessSyncedOffersFreshness(input: {
  syncedAt: string | null;
  offerWeekEnd: string | null;
  reference?: Date;
}): SyncedOffersFreshness {
  const reference = input.reference ?? new Date();
  const today = retailCalendarDay(reference);
  const week = currentSupervaluOfferWeek(reference);
  const offerWeekEnd = input.offerWeekEnd?.trim() || null;
  const syncedAt = input.syncedAt?.trim() || null;

  const weekExpired = offerWeekEnd == null || offerWeekEnd < today;
  const syncOld = !isRetailOfferObservationFresh(syncedAt, reference);

  if (!weekExpired && !syncOld) {
    return {
      stale: false,
      syncedAt,
      offerWeekStart: week.start,
      offerWeekEnd: week.end,
      message: null,
    };
  }

  return {
    stale: true,
    syncedAt,
    offerWeekStart: week.start,
    offerWeekEnd: offerWeekEnd ?? week.end,
    message: "Synced weekly offers may be out of date or unavailable. " + RETAIL_OFFERS_UNVERIFIED_MESSAGE,
  };
}

export type WeeklyOfferSearchFilters = {
  channel?: SupervaluOfferChannel | null;
  serviceArea?: SupervaluServiceArea | null;
  fulfilment?: SupervaluFulfilment | null;
};

const REWARDS_PRICE_POINT_EURO_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
};

const REWARDS_PRICE_POINT_CENT_WORDS: Record<string, number> = {
  ten: 10,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};

/**
 * Price-only Rewards browse, e.g. "Rewards Price for €2.50" or
 * "Real Rewards offers for two euro fifty". This is an offer filter, not a
 * product-name query.
 */
export function inferRewardsPricePointFromQuery(query: string): number | null {
  const q = query.toLowerCase();
  if (!/\b(?:real\s+rewards?|rewards?)(?:\s+price)?\b/i.test(q) || /\bpoints?\b/i.test(q)) return null;

  // A named product with a pack count is not a price-only Rewards browse.
  const subject = parseRetailPromotionQuery(query).subjectTokens.filter(token => !["euro", "euros"].includes(token));
  if (subject.length > 0) return null;
  const rewards = q.match(/\brewards?(?:\s+price)?\b/);
  const amountText = q.includes("€") ? q.slice(q.indexOf("€")) : q.slice((rewards?.index ?? 0)+(rewards?.[0].length ?? 0));
  const numeric = amountText.match(/(?:€\s*)?(\d{1,3}(?:[.,]\d{1,2})?)/);
  if (numeric) {
    const amount = Number(numeric[1]!.replace(",", "."));
    if (Number.isFinite(amount) && amount > 0) return Math.round(amount * 100) / 100;
  }

  const euroWords = Object.keys(REWARDS_PRICE_POINT_EURO_WORDS).join("|");
  const centWords = Object.keys(REWARDS_PRICE_POINT_CENT_WORDS).join("|");
  const spoken = q.match(
    new RegExp(`\\b(${euroWords})\\s+(?:euro(?:s)?\\s+)?(${centWords})\\b`, "i"),
  );
  if (!spoken) return null;

  const euros = REWARDS_PRICE_POINT_EURO_WORDS[spoken[1]!.toLowerCase()];
  const cents = REWARDS_PRICE_POINT_CENT_WORDS[spoken[2]!.toLowerCase()];
  if (euros == null || cents == null) return null;
  return euros + cents / 100;
}

function isRewardsOfferRow(row: RetailWeeklyOfferRow): boolean {
  return /\brewards?\s+price\b|\breal\s+rewards?\b/i.test(
    String(row.discount_label ?? ""),
  );
}

/** Caller wants a rundown of synced offers, not one specific product. */
export function inferWeeklyOffersListIntent(query: string): boolean {
  const trimmed = query.trim();
  if (!trimmed) return true;
  if (offerSearchProductIdentityTokens(trimmed).length > 2 && /\b\d+(?:[.,]\d+)?\s*(?:g|kg|ml|cl|litres?|liters?|l|bags?|packs?|pieces?)\b/i.test(trimmed)) return false;
  if (inferRewardsPricePointFromQuery(trimmed) != null) return true;
  if (shouldUseStructuredPromotionSearch(trimmed)) return true;
  if (
    /\bweekly offers\b|\bwhat offers\b|\bwhat'?s on offer\b|\bwhats on offer\b|\bbest offer|\blist offers\b|\blist (?:five|5|\d+)\b|\bany offers\b|\boffers (?:this week|do you have|you have|on|in)\b|\bsurprise me\b|\bhighlights\b|\btell me (?:the|your) offers\b|\bapart from meat\b|\bnot meat\b|\bgrocery offers\b|\bwhat (?:meat )?offers\b|\b(?:meat|butcher|deli|fish|produce|bakery|wine|beer|spirits|alcohol|dairy|ambient|grocery|fruit|veg|seafood|provisions|frozen|household|baby|pet|pets) offers\b|\boff[- ]licence offers\b|\b(?:what )?(?:alcohol|wine|beer|spirits|dairy|ambient|fruit|veg|produce|bakery|deli|fish|butcher|grocery|provisions|frozen|household|baby|pet|pets)\b.*\b(?:on offer|offers?|this week|specials?)\b/i.test(
      trimmed,
    )
  ) {
    return true;
  }
  const tokens = queryTokens(trimmed);
  if (tokens.length === 0 && /\b(?:offers?|promotions?|promos?|specials?|deals?)\b/i.test(trimmed)) return true;
  if (
    tokens.length === 1 &&
    /^(meat|butcher|deli|fish|produce|bakery|grocery|offers?|promos?|wine|beer|alcohol|dairy|ambient|spirits|fruit|veg|vegetables|seafood|provisions|frozen|household|fishmonger)$/i.test(
      tokens[0] ?? "",
    )
  ) {
    return true;
  }
  if (
    offerSearchProductTokens(trimmed).length >= 2 &&
    inferWeeklyOffersBrowseCategories(trimmed).length < 2
  ) {
    return false;
  }
  if (tokens.filter((token) => inferWeeklyOffersBrowseCategories(trimmed).includes(token)).length >= 2 &&
      offerSearchProductTokens(trimmed).every(token=>inferWeeklyOffersBrowseCategories(trimmed).includes(token))) {
    return true;
  }
  if (
    inferWeeklyOfferServiceAreaFromQuery(trimmed) &&
    /\b(?:offers?|specials?|deals?|promos?|on offer|this week)\b/i.test(trimmed) &&
    offerSearchProductTokens(trimmed).length === 0
  ) {
    return true;
  }
  return false;
}

export function inferWeeklyOffersExcludeMeat(query: string): boolean {
  return /\bapart from meat\b|\bnot meat\b|\bgrocery offers\b|\bnon[- ]meat\b/i.test(
    query.trim(),
  );
}

export function inferWeeklyOffersBrowseCategories(query: string): string[] {
  const trimmed = query.trim().toLowerCase();
  const tokens = tokenizeSupervaluSearchQuery(trimmed);
  const categoryHints = new Set([
    "milk",
    "bread",
    "crisps",
    "chocolate",
    "fruit",
    "yogurt",
    "cheese",
    "butter",
    "tea",
    "coffee",
    "biscuits",
    "sweets",
    "confectionery",
    "drinks",
    "household",
    "frozen",
    "ham",
    "wine",
    "beer",
    "potatoes",
  ]);
  const fromTokens = tokens.filter((token) => categoryHints.has(token));
  if (fromTokens.length >= 2) return fromTokens.slice(0, 5);
  if (/deli|ham|cooked meat/i.test(trimmed)) return ["ham", "salami"];
  if (/wine|beer|off[- ]licence|spirits|alcohol|alcoholic|liquor|liqueur|cider/i.test(trimmed)) {
    return ["wine", "beer", "spirits"];
  }
  if (/fruit|veg|vegetable|produce|potato/i.test(trimmed)) {
    return ["fruit", "potatoes", "vegetables"];
  }
  if (/bakery|bread|scone|croissant|baguette/i.test(trimmed)) {
    return ["bread", "croissant", "scone"];
  }
  if (/\b(?:provisions|ambient|household|tea|coffee|biscuits|back store|backstore)\b/i.test(trimmed)) {
    return ["tea", "coffee", "biscuits", "household"];
  }
  if (/dairy|milk|yogurt|cheese|butter/i.test(trimmed)) {
    return ["milk", "yogurt", "cheese", "butter"];
  }
  if (/fish|seafood|salmon|cod/i.test(trimmed)) {
    return ["salmon", "cod", "prawns"];
  }
  if (/butcher|meat counter|meat department/i.test(trimmed)) {
    return ["striploin", "rashers", "sausages"];
  }
  if (/confectionery|sweets|candy/.test(trimmed)) return ["chocolate", "sweets"];
  if (inferWeeklyOffersExcludeMeat(trimmed)) {
    return ["chocolate", "crisps", "yogurt", "bread", "fruit"];
  }
  if (
    /\blist\b|\b(?:show|give|choose|list)\s+(?:me\s+)?(?:five|5)\b|weekly offers|best deal|sample|highlights/i.test(
      trimmed,
    )
  ) {
    return ["chocolate", "crisps", "yogurt", "bread", "fruit"];
  }
  return [];
}

export function inferWeeklyOfferServiceAreaFromQuery(
  query: string,
): SupervaluServiceArea | null {
  // A meat preference for burgers does not require the butcher department;
  // frozen or pre-pack meat burgers may belong to other catalogue areas.
  const q = (queryRequestsMeatBurgers(query) && !/\b(?:butcher|counter|department|section|aisle)\b/i.test(query)
    ? stripBurgerSearchContext(query) : positiveRetailQuery(query)).toLowerCase();
  // Named products get their department from catalogue evidence. Ingredient
  // words inside a specific product name must not hard-scope the lookup.
  if (!/\b(?:counter|department|section|aisle|butcher|deli|bakery|off[ -]licen[cs]e)\b/.test(q)
      && offerSearchProductIdentityTokens(q).length > 2) return null;
  // A product ingredient does not establish a department. Explicit counter /
  // department language still wins through the normal rules below.
  if (!/\b(?:counter|department|section|aisle)\b/.test(q) &&
      /\b(?:wine gums|beer batter|fish fingers|fish cakes|cream clean|ice cream|peanut butter|butter beans|coconut milk|almond milk|oat milk|meat[ -]free|plant[ -]based|dog food|cat food|pet food)\b/.test(q)) return null;
  if (/\b(?:apart from|not|non[- ]|except)\s*meat\b/.test(q)) return null;
  if (
    /off[- ]licence|off licence|wine|beer|stout|lager|guinness|spirits|cider|alcohol|alcoholic|liquor|liqueur|drinks aisle/i.test(
      q,
    )
  ) {
    return "off_licence";
  }
  if (
    /\bfish\b|fish counter|fishmonger|fish department|seafood counter|salmon|cod|haddock|seafood|prawn|trout|mackerel|tuna/i.test(
      q,
    )
  ) {
    return "fish";
  }
  if (/deli counter|deli department|deli|carrolls|sliced ham|cooked meat|salami|charcuterie/i.test(q)) {
    return "deli";
  }
  if (
    /\bmeat\b|butcher counter|butcher department|meat counter|meat department|fresh meat|butcher|striploin|sirloin|steak|rashers|sausages/i.test(
      q,
    )
  ) {
    return "butcher";
  }
  if (
    /fruit and veg|fruit & veg|fruit counter|veg counter|fruit|veg|vegetable|potato|apple|produce|green grocers/i.test(
      q,
    )
  ) {
    return "produce";
  }
  if (/bakery|in[- ]store bakery|bread counter|croissant|scone|baguette/i.test(q)) {
    return "bakery";
  }
  if (/\bdairy\b|dairy wall|dairy section|milk|yogurt|yoghurt|cheese|butter|cream/i.test(q)) {
    return "dairy";
  }
  if (
    /ambient|provisions|back store|backstore|household|frozen|grocery|centre aisle|center aisle/i.test(
      q,
    )
  ) {
    return "grocery";
  }
  return null;
}

export function inferWeeklyOfferFulfilmentFromQuery(
  query: string,
): SupervaluFulfilment | null {
  const q = positiveRetailQuery(query).toLowerCase();
  if (/sealed (?:packets|packs)|\b(?:not|rather than|without)\b.*\bcounter\b/i.test(query)) return "prepack";
  if (
    /pre\s*-?\s*pack|packaged|quick fry|meat aisle|fish aisle|chilled aisle|chilled pack|in the aisle|on the shelf|shelf pack/i.test(
      q,
    )
  ) {
    return "prepack";
  }
  if (
    /(?:butcher|meat|fish|deli|seafood)\s+counter|counter\s+(?:ham|meat|fish|salmon|steak|prawns?)|the counter|fresh sliced|per kilo|per kg|by weight|priced per/i.test(
      q,
    )
  ) {
    return "counter";
  }
  if (/\bcounter\b/i.test(q) && !/pre\s*-?\s*pack|packaged/i.test(q)) {
    return "counter";
  }
  if (/fruit|veg|produce/i.test(q) && /fresh counter/i.test(q)) {
    return "counter";
  }
  return null;
}

/** Legacy channel inference — maps to service_area/fulfilment where possible. */
export function inferWeeklyOfferChannelFromQuery(
  query: string,
): SupervaluOfferChannel | null {
  const serviceArea = inferWeeklyOfferServiceAreaFromQuery(query);
  const fulfilment = inferWeeklyOfferFulfilmentFromQuery(query);
  if (serviceArea === "butcher" && fulfilment === "counter") return "butcher_counter";
  if (serviceArea === "butcher" && fulfilment === "prepack") return "prepack";
  if (serviceArea === "fish" && fulfilment === "counter") return "butcher_counter";
  if (serviceArea === "fish" && fulfilment === "prepack") return "prepack";
  if (serviceArea === "deli" && fulfilment === "counter") return "butcher_counter";
  if (serviceArea === "deli" && fulfilment === "prepack") return "prepack";
  if (/butcher counter|meat counter|butchers counter|the butcher counter/i.test(query.toLowerCase())) {
    return "butcher_counter";
  }
  if (/pre\s*-?\s*pack|packaged|quick fry|meat aisle|fish aisle|chilled aisle/i.test(query.toLowerCase())) {
    return "prepack";
  }
  return null;
}

export function resolveWeeklyOfferSearchFilters(
  query: string,
  explicit?: WeeklyOfferSearchFilters,
): WeeklyOfferSearchFilters {
  return {
    channel: explicit?.channel ?? null,
    serviceArea: explicit?.serviceArea ?? inferWeeklyOfferServiceAreaFromQuery(query),
    // Respect explicit caller meaning ("meat counter", "pre-pack aisle", "per kilo").
    // Ambiguous product-only requests still return null so Cara can clarify once.
    fulfilment:
      explicit?.fulfilment ?? inferWeeklyOfferFulfilmentFromQuery(query),
  };
}

function rowMatchesFilters(
  row: RetailWeeklyOfferRow,
  filters: WeeklyOfferSearchFilters,
  options?: { excludeMeat?: boolean; alcoholOnly?: boolean },
): boolean {
  if (options?.excludeMeat && ["butcher", "deli", "fish"].includes(row.service_area)) return false;
  if (options?.alcoholOnly && row.is_alcohol !== true) return false;
  if (filters.serviceArea && row.service_area !== filters.serviceArea) return false;
  if (filters.fulfilment && row.fulfilment !== filters.fulfilment) return false;
  if (
    !filters.serviceArea &&
    filters.channel &&
    (row.offer_channel ?? "prepack") !== filters.channel
  ) {
    return false;
  }
  return true;
}

function inferAlcoholOnlyFromQuery(query: string): boolean {
  return /\balcohol|alcoholic|wine|beer|spirits|cider|liquor|liqueur|off[- ]licence/i.test(
    query.toLowerCase(),
  );
}

function browseRetailWeeklyOffers(
  rows: RetailWeeklyOfferRow[],
  categories: string[],
  limit: number,
  options?: { excludeMeat?: boolean; filters?: WeeklyOfferSearchFilters; alcoholOnly?: boolean },
): WeeklyOfferMatch[] {
  const seen = new Set<string>();
  const matches: WeeklyOfferMatch[] = [];
  const filters = options?.filters ?? {};

  for (const category of categories) {
    const tokens = queryTokens(category);
    if (tokens.length === 0) continue;
    const categoryMatches = rows
      .filter((row) => {
        if (!rowMatchesFilters(row, filters, options)) return false;
        return scoreOffer(row.search_text, tokens, row.department) >= 0.5;
      })
      .sort(
        (a, b) =>
          scoreOffer(b.search_text, tokens, b.department) -
            scoreOffer(a.search_text, tokens, a.department) ||
          a.product_name.localeCompare(b.product_name),
      );

    for (const row of categoryMatches) {
      const key = row.sku ?? row.product_name;
      if (seen.has(key)) continue;
      seen.add(key);
      matches.push(rowToMatch(row, 1));
      if (matches.length >= limit) return matches;
    }
  }

  return matches;
}

function isSpecificProductOfferQuery(query: string): boolean {
  return (
    offerSearchProductTokens(query).length > 0 &&
    !inferWeeklyOffersListIntent(query)
  );
}

function categoryMetadataText(row: RetailWeeklyOfferRow): string {
  return normalizeSearchText(
    `${row.department ?? ""} ${(row.category_breadcrumb ?? "").replace(/Wine,? Beer & Spirits/gi, "")}`,
  );
}

/**
 * Generic category/department browse detection from the actual catalogue.
 * This avoids a hardcoded category list: cereals, yogurts, crisps, shampoo,
 * frozen pizza, pet food, etc. all work when the query matches department
 * metadata across multiple offer rows.
 */
function categoryBrowseMatches(
  rows: RetailWeeklyOfferRow[],
  query: string,
  filters: WeeklyOfferSearchFilters,
  options?: { excludeMeat?: boolean; alcoholOnly?: boolean },
): RetailWeeklyOfferRow[] {
  // Keep real subdepartments such as frozen / household in the metadata
  // query even though they are not product-name tokens.
  const tokens = offerSearchProductIdentityTokens(query).filter((token) =>
    !["meat", "butcher", "butchers", "fish", "seafood", "deli", "produce", "fruit", "veg", "vegetables", "bakery", "grocery", "dairy", "ambient", "provisions", "alcohol"].includes(token),
  );
  if (tokens.length === 0 || tokens.length > 3) return [];

  const scoped = rows.filter((row) => {
    if (!rowMatchesFilters(row, filters, options)) return false;
    const categoryText = categoryMetadataText(row);
    return tokens.every((token) =>
      retailSearchTokenMatchesText(categoryText, token),
    );
  });

  const uniqueProducts = new Set(
    scoped.map((row) => row.sku ?? normalizeSearchText(row.product_name)),
  );
  return uniqueProducts.size >= 1 ? scoped : [];
}

function sampleRetailWeeklyOffersAcrossDepartments(
  rows: RetailWeeklyOfferRow[],
  limit: number,
  options?: { excludeMeat?: boolean; filters?: WeeklyOfferSearchFilters; alcoholOnly?: boolean },
): WeeklyOfferMatch[] {
  const filters = options?.filters ?? {};
  const filtered = rows.filter((row) =>
    rowMatchesFilters(row, filters, options),
  );
  const byDepartment = new Map<string, RetailWeeklyOfferRow[]>();
  for (const row of filtered) {
    const bucketKey = `${row.service_area}:${row.fulfilment}:${row.department}`;
    const bucket = byDepartment.get(bucketKey) ?? [];
    bucket.push(row);
    byDepartment.set(bucketKey, bucket);
  }
  // Interleave service areas before subdepartments, so a large bakery or
  // grocery taxonomy cannot fill the result window before meat/fish/produce.
  const byArea = new Map<string, string[]>();
  for (const key of [...byDepartment.keys()].sort()) {
    const area = key.split(":")[0]!;
    byArea.set(area, [...(byArea.get(area) ?? []), key]);
  }
  const departments: string[] = [];
  while ([...byArea.values()].some((keys) => keys.length > 0)) {
    for (const keys of byArea.values()) {
      const key = keys.shift();
      if (key) departments.push(key);
    }
  }
  const matches: WeeklyOfferMatch[] = [];
  while (
    matches.length < limit &&
    departments.some((dept) => (byDepartment.get(dept)?.length ?? 0) > 0)
  ) {
    for (const dept of departments) {
      const bucket = byDepartment.get(dept);
      const row = bucket?.shift();
      if (!row) continue;
      matches.push(rowToMatch(row, 1));
      if (matches.length >= limit) break;
    }
  }
  return matches;
}

export const RETAIL_WEEKLY_OFFERS_SEARCH_MAX_QUERY_CHARS = 120;
export const RETAIL_WEEKLY_OFFERS_SEARCH_MAX_RESULTS = 5;
export const RETAIL_WEEKLY_OFFERS_LIST_MAX_RESULTS = 16;
export const RETAIL_WEEKLY_OFFERS_PROMPT_MAX_ITEMS = 16;

const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "for", "to", "of", "in", "on", "at", "is", "it",
  "do", "you", "we", "i", "me", "my", "your", "how", "much", "what", "about",
  "with", "from", "that", "this", "are", "be", "can", "have", "has", "does",
  "did", "will", "would", "please", "cost", "price", "offer", "offers",
  "special", "specials", "deal", "deals", "promotion", "promotions", "promo", "promos", "weekly", "list", "show", "which", "all", "current", "available", "anything", "everything", "every", "latest", "national", "week", "today", "stock", "sell", "yous", "ye", "got",
  "any", "there", "some", "just", "hello", "yeah", "yep", "well", "also",
  "actually", "whats", "like", "right", "so", "wondering", "know", "tell", "best", "highlights", "surprise", "apart", "not", "non", "except",
  "could", "would", "thanks", "thank", "hi", "em", "uh", "um",
  "product", "products", "item", "items", "range", "across", "different", "example", "examples", "few", "including",
]);

export function tokenizeSupervaluSearchQuery(query: string): string[] {
  return [
    ...new Set(
      stripPriceComparisonWords(stripBurgerSearchContext(query))
        .toLowerCase()
        .replace(/\b(?:i[\u2019']?m|i am)\s+(?:looking for|after)\b/g, " ")
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .map((token) => token.trim())
        .filter((token) => token.length > 1 && !STOPWORDS.has(token)),
    ),
  ];
}

export function scoreSupervaluSearchText(
  searchText: string,
  tokens: string[],
  department: string,
): number {
  if (tokens.length === 0) return 0;
  let score = 0;
  for (const token of tokens) {
    score += retailSearchTokenSimilarity(searchText, token);
  }
  if (/butcher|beef|meat|steak|striploin|lamb|poultry|chicken|deli|ham/i.test(department)) {
    score += 0.15;
  }
  return score / tokens.length;
}

function queryTokens(query: string): string[] {
  return tokenizeSupervaluSearchQuery(query);
}

function scoreOffer(
  searchText: string,
  tokens: string[],
  department: string,
): number {
  return scoreSupervaluSearchText(searchText, tokens, department);
}

function scoreOfferRow(row: RetailWeeklyOfferRow, tokens: string[]): number {
  const textScore = scoreOffer(row.search_text, tokens, row.department);
  const nameScore = scoreOffer(
    normalizeSearchText(row.product_name),
    tokens,
    row.department,
  );
  return Math.max(textScore, nameScore);
}

const FULFILMENT_QUERY_TOKENS = new Set([
  "loose",
  "counter",
  "weight",
  "kilo",
  "kg",
  "by",
  "per",
  "fish",
  "butcher",
  "butchers",
  "deli",
  "prepack",
  "prepacked",
  "packaged",
  "aisle",
  "fresh",
  "sliced",
  "fishmonger",
  "fishcounter",
  "meat",
  "shop",
  "store",
  "section",
  "department",
  "departments",
  "wall",
  "back",
  "off",
  "licence",
  "license",
  "seafood",
  "produce",
  "fruit",
  "veg",
  "vegetables",
  "bakery",
  "grocery",
  "dairy",
  "ambient",
  "provisions",
  "frozen",
  "household",
  "alcohol",
  "wine",
  "beer",
  "spirits",
  "backstore",
]);

/** Location phrases constrain fulfilment; they are not product-name words. */
export function stripRetailCounterLocation(query: string): string {
  return query.replace(/\b(?:butchers?|meat|deli|fish|seafood|bakery|cheese)\s+(?:counter|department|section|aisle)\b/gi, " ");
}

/** Keep nouns that identify products (fish fingers, wine gums, frozen pizza). */
export function offerSearchProductIdentityTokens(query: string): string[] {
  const structural = new Set(["counter", "prepack", "prepacked", "packaged", "aisle", "section", "department", "departments", "wall", "back", "off", "licence", "license", "shop", "store", "per", "kilo", "kg", "weight", "loose"]);
  return tokenizeSupervaluSearchQuery(stripRetailCounterLocation(query)).filter((token) => !structural.has(token));
}

export function offerSearchProductTokens(query: string): string[] {
  return tokenizeSupervaluSearchQuery(query).filter(
    (token) => !FULFILMENT_QUERY_TOKENS.has(token),
  );
}

function preferProductNameMatches<
  T extends { row: RetailWeeklyOfferRow; score: number },
>(matches: T[], tokens: string[]): T[] {
  const productTokens = tokens.filter((token) => !FULFILMENT_QUERY_TOKENS.has(token));
  if (productTokens.length === 0 || matches.length <= 1) return matches;

  const nameIncludesToken = (productName: string, token: string) =>
    retailSearchTokenMatchesText(productName, token);

  if (productTokens.length >= 2) {
    const strictMatches = matches.filter((entry) =>
      productTokens.every((token) => nameIncludesToken(entry.row.product_name, token)),
    );
    if (strictMatches.length > 0) return strictMatches;
  }

  const nameMatches = matches.filter((entry) =>
    productTokens.some((token) => nameIncludesToken(entry.row.product_name, token)),
  );
  return nameMatches;
}

export type WeeklyOfferMatch = {
  id: string;
  sku?: string | null;
  offerWeekStart?: string;
  offerWeekEnd?: string;
  productName: string;
  department: string;
  offerChannel: SupervaluOfferChannel;
  serviceArea: SupervaluServiceArea;
  fulfilment: SupervaluFulfilment;
  currentPriceEur: number | null;
  wasPriceEur: number | null;
  discountLabel: string | null;
  pricePerUnit: string | null;
  priceBasis?: RetailPriceBasis;
  isAlcohol: boolean;
  campaignNames: string[];
  score: number;
  quoteText: string;
};

function quoteUsesPerKilo(input: {
  priceUnitType?: string | null;
  sellBy?: string | null;
  pricePerUnit?: string | null;
  serviceArea?: SupervaluServiceArea;
  fulfilment?: SupervaluFulfilment;
}): boolean {
  const unitType = String(input.priceUnitType ?? "").toLowerCase();
  const sellBy = String(input.sellBy ?? "").toLowerCase();
  if (unitType === "each" || sellBy === "each") return false;
  if (unitType === "kilogram") return true;
  if (sellBy === "unit" || sellBy === "weight") return true;
  if (
    input.fulfilment === "counter" &&
    /\/kg/i.test(String(input.pricePerUnit ?? ""))
  ) {
    return true;
  }
  if (
    (input.serviceArea === "butcher" ||
      input.serviceArea === "deli" ||
      input.serviceArea === "fish") &&
    input.fulfilment === "counter"
  ) {
    return true;
  }
  return false;
}

/** Strip pack-size suffixes — price is spoken separately. */
export function shortProductNameForOfferQuote(productName: string): string {
  return productName
    .replace(/\s*\(\d+(?:\.\d+)?\s*(?:g|kg|ml|l|pack|each|unit)[^)]*\)\s*$/i, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function formatOfferPercentOff(
  currentPriceEur: number | null,
  wasPriceEur: number | null | undefined,
): string | null {
  if (currentPriceEur == null || wasPriceEur == null || wasPriceEur <= currentPriceEur || wasPriceEur <= 0) {
    return null;
  }
  const pct = Math.round(((wasPriceEur - currentPriceEur) / wasPriceEur) * 100);
  if (pct < 5) return null;
  return `${formatSpokenInteger(pct)} percent off`;
}

function resolveOfferChannelPrefix(input: {
  serviceArea?: SupervaluServiceArea;
  fulfilment?: SupervaluFulfilment;
  offerChannel?: SupervaluOfferChannel;
}): string {
  const serviceArea = input.serviceArea ?? "grocery";
  const fulfilment = input.fulfilment ?? "prepack";
  if (serviceArea === "butcher" && fulfilment === "counter") {
    return "At the butcher counter this week";
  }
  if (serviceArea === "butcher" && fulfilment === "prepack") {
    return "In the pre-pack meat aisle this week";
  }
  if (serviceArea === "deli" && fulfilment === "counter") {
    return "At the deli counter this week";
  }
  if (serviceArea === "deli" && fulfilment === "prepack") {
    return "In the chilled pre-pack deli range this week";
  }
  if (serviceArea === "fish" && fulfilment === "counter") {
    return "At the fish counter this week";
  }
  if (serviceArea === "fish" && fulfilment === "prepack") {
    return "In the pre-pack fish aisle this week";
  }
  if (serviceArea === "produce" && fulfilment === "counter") {
    return "At the fruit and veg counter this week";
  }
  if (serviceArea === "bakery" && fulfilment === "counter") {
    return "At the in-store bakery counter this week";
  }
  if (serviceArea === "off_licence") {
    return "On the off-licence range this week";
  }
  // Packaged is a fulfilment type across every department, not a meat aisle.
  if (!input.serviceArea && input.offerChannel === "butcher_counter") {
    return "At the butcher counter this week";
  }
  return "This week on the SuperValu national range";
}

/** Only derive a unit rate when one explicit pack weight/volume is unambiguous. */
function verifiedPackUnitPrice(input: {productName:string;currentPriceEur:number|null;pricePerUnit?:string|null;fulfilment?:SupervaluFulfilment}): string|null|undefined {
  if (input.fulfilment === "counter" || !(Number(input.currentPriceEur)>0) || !input.pricePerUnit) return input.pricePerUnit;
  const size=input.productName.match(/\(([0-9]+(?:[.,][0-9]+)?)\s*(kg|g|ml|l)\)\s*$/i);
  const rate=input.pricePerUnit.match(/€?\s*[0-9]+(?:[.,][0-9]+)?\s*\/\s*(kg|l|100g|100ml)\b/i);
  if (!size || !rate || /\b[0-9]+\s*(?:packs?|pieces?|x)\b/i.test(input.productName)) return input.pricePerUnit;
  const units=size[2]!.toLowerCase();const quantity=Number(size[1]!.replace(",","."));
  const basis=rate[1]!.toLowerCase();
  const compatible=/^(?:kg|g)$/.test(units)?/^(?:kg|100g)$/.test(basis):/^(?:l|100ml)$/.test(basis);
  if (!compatible || !(quantity>0)) return input.pricePerUnit;
  const baseQuantity=quantity*(units==="kg"||units==="l"?1000:1);
  const price=Number(input.currentPriceEur)/(baseQuantity/(basis==="kg"||basis==="l"?1000:100));
  return `€${price.toFixed(2)}/${basis}`;
}

export function formatWeeklyOfferQuote(input: {
  productName: string;
  offerChannel?: SupervaluOfferChannel;
  serviceArea?: SupervaluServiceArea;
  fulfilment?: SupervaluFulfilment;
  currentPriceEur: number | null;
  wasPriceEur?: number | null;
  discountLabel?: string | null;
  pricePerUnit?: string | null;
  priceUnitType?: string | null;
  sellBy?: string | null;
  isAlcohol?: boolean;
}): string {
  input = {...input, pricePerUnit: verifiedPackUnitPrice(input)};
  const perKilo = quoteUsesPerKilo(input);
  const price = input.currentPriceEur != null && input.currentPriceEur > 0 ? formatSpokenEurAmount(input.currentPriceEur) : null;
  const productName = shortProductNameForOfferQuote(input.productName);
  const channelPrefix = resolveOfferChannelPrefix(input);
  const sentences = [`${channelPrefix}. ${productName}.`];

  const mass=(value:string)=>[...value.matchAll(/\b(\d+(?:[.,]\d+)?)\s*(kg|g|ml|cl|l)\b/gi)].map(m=>({dimension:/^(?:kg|g)$/i.test(m[2]!)?'mass':'volume',n:Number(m[1]!.replace(',','.'))*({kg:1000,g:1,ml:1,cl:10,l:1000}[m[2]!.toLowerCase()]??1)}));
  const pack=mass(input.productName).at(-1);
  const advertised=mass(input.discountLabel??'');
  // A shared unit applies to both ends of an advertised range, e.g. 150-180g.
  for(const range of (input.discountLabel??'').matchAll(/\b(\d+(?:[.,]\d+)?)\s*(kg|g|ml|cl|l)?\s*[-–]\s*(\d+(?:[.,]\d+)?)\s*(kg|g|ml|cl|l)\b/gi)){
    for(const [number,unit] of [[range[1],range[2]??range[4]],[range[3],range[4]]]){
      advertised.push({dimension:/^(?:kg|g)$/i.test(unit!)?'mass':'volume',n:Number(number!.replace(',','.'))*({kg:1000,g:1,ml:1,cl:10,l:1000}[unit!.toLowerCase()]??1)});
    }
  }
  const packCount=Number(input.productName.match(/\b(\d+)\s*pack\b/i)?.[1]??1);
  const comparable=advertised.filter(a=>a.dimension===pack?.dimension).map(a=>a.n);
  const candidates=pack?[pack.n,pack.n*packCount]:[];
  const weightConflict=comparable.length>0 && candidates.length>0 && !candidates.some(n=>comparable.some(x=>Math.abs(x-n)<0.01)||(/\d\s*(?:kg|g|ml|cl|l)?\s*[-–]\s*\d/i.test(input.discountLabel??'')&&n>=Math.min(...comparable)&&n<=Math.max(...comparable)));
  if(weightConflict&&parseRetailMultibuyLabel(input.discountLabel)){
    if(price)sentences.push(`Verified listed single price ${price}${perKilo?' per kilo':' each'}.`);
    sentences.push(`The advertised promotion label refers to a different pack size or range: ${formatSpokenDiscountLabel(input.discountLabel)}. Eligibility for this exact pack is not verified. Do not present the requested pack as qualifying for that bundle.`);
    return sentences.join(' ');
  }
  const spokenLabel = formatSpokenDiscountLabel(input.discountLabel);
  const multibuyMatch = String(input.discountLabel ?? "").match(
    /\b(\d+)\s+for\s+€?\s*(\d+(?:[.,]\d{1,2})?)/i,
  );
  if (multibuyMatch) {
    const quantity = Number(multibuyMatch[1]);
    const total = Number(multibuyMatch[2]?.replace(",", "."));
    if (Number.isFinite(quantity) && quantity >= 2 && Number.isFinite(total) && total > 0) {
      // Preserve the retailer's full conditions (eligible pack, coupon,
      // membership and quantity limits), not only the first numeric mechanic.
      const terms = (spokenLabel ?? `${formatSpokenInteger(quantity)} for ${formatSpokenEurAmount(total)}`)
        .replace(/\brewards?\s+price\b/gi, "with Real Rewards");
      sentences.push(/[.!?]$/.test(terms) ? terms : `${terms}.`);
      if (!/mix\s*(?:and|&)\s*match/i.test(input.discountLabel ?? "")) sentences.push("Eligibility to mix different products is not verified by this listing.");
      if (price != null) {
        sentences.push(perKilo ? `Current listed single price ${price} per kilo.` : `Current listed single price ${price} each.`);
      }

      if (
        price != null && !perKilo &&
        input.pricePerUnit?.trim() &&
        /\/kg/i.test(input.pricePerUnit)
      ) {
        sentences.push(`${speakEmbeddedEurAmounts(input.pricePerUnit.trim())}.`);
      }
      return sentences.join(" ");
    }
  }

  const genericBundle = parseRetailMultibuyLabel(input.discountLabel);
  if (genericBundle && !genericBundle.totalEur && !genericBundle.buyQuantity && !genericBundle.mixMatch && /minimum quantity/i.test(input.discountLabel ?? "")) {
    if (price != null) sentences.push(`Listed single-pack price ${price}.`);
    sentences.push("A multibuy is advertised, but its bundle total or discount is not supplied. The minimum quantity refers to the multibuy; it does not establish that the listed single-pack price requires multiple packs.");
    return sentences.join(" ");
  }
  if (genericBundle && spokenLabel) {
    if (/bundle\s+offer/i.test(input.discountLabel ?? "")) sentences.push("This is a cross-product bundle requiring the named items, not multiple packs of this product alone.");
    sentences.push(`${spokenLabel}.`);
    if (price != null) sentences.push(perKilo ? `Current listed single price ${price} per kilo.` : `Current listed single price ${price} each.`);
    return sentences.join(" ");
  }

  const percentOff = formatOfferPercentOff(
    input.currentPriceEur,
    input.wasPriceEur,
  );
  // A source label may carry restrictions even when it begins "Only" or
  // the same saving can be calculated from the prices. Preserve those terms.
  const plainPriceLabel = /^only\s*€\s*\d+(?:[.,]\d{1,2})?\s*[.!]?$/i.test(String(input.discountLabel ?? "").trim());
  if (spokenLabel && !plainPriceLabel) {
    sentences.push(/[.!?]$/.test(spokenLabel) ? spokenLabel : `${spokenLabel}.`);
  } else if (percentOff) {
    sentences.push(`${percentOff}.`);
  }

  if (price != null) sentences.push(perKilo ? `Now ${price} per kilo.` : `Now ${price}.`);

  if (input.currentPriceEur != null && input.wasPriceEur && input.wasPriceEur > input.currentPriceEur) {
    const was = formatSpokenEurAmount(input.wasPriceEur);
    sentences.push(perKilo ? `Usually ${was} per kilo.` : `Usually ${was}.`);
  }

  if (
    !perKilo &&
    input.pricePerUnit?.trim() &&
    /\/kg/i.test(input.pricePerUnit)
  ) {
    sentences.push(`${speakEmbeddedEurAmounts(input.pricePerUnit.trim())}.`);
  } else if (
    perKilo &&
    input.pricePerUnit?.trim() &&
    !/per kilo/i.test(sentences.join(" "))
  ) {
    sentences.push(`${speakEmbeddedEurAmounts(input.pricePerUnit.trim())}.`);
  }

  return sentences.join(" ");
}

function rowToMatch(row: RetailWeeklyOfferRow, score: number): WeeklyOfferMatch {
  const offerChannel = row.offer_channel ?? "prepack";
  const serviceArea = row.service_area ?? "grocery";
  const fulfilment = row.fulfilment ?? "prepack";
  return {
    id: row.id,
    sku: row.sku,
    offerWeekStart: row.offer_week_start,
    offerWeekEnd: row.offer_week_end,
    productName: row.product_name,
    department: row.department,
    offerChannel,
    serviceArea,
    fulfilment,
    currentPriceEur: row.current_price_eur == null ? null : Number(row.current_price_eur),
    wasPriceEur:
      row.was_price_eur == null ? null : Number(row.was_price_eur),
    discountLabel: row.discount_label,
    pricePerUnit: verifiedPackUnitPrice({productName:row.product_name,currentPriceEur:row.current_price_eur,pricePerUnit:row.price_per_unit,fulfilment}) ?? null,
    priceBasis: quoteUsesPerKilo({ priceUnitType: row.price_unit_type, sellBy: row.sell_by, pricePerUnit: row.price_per_unit, serviceArea, fulfilment }) ? "per_kilo" : "pack",
    isAlcohol: row.is_alcohol === true,
    campaignNames: row.campaign_names ?? [],
    score,
    quoteText: formatWeeklyOfferQuote({
      productName: row.product_name,
      offerChannel,
      serviceArea,
      fulfilment,
      currentPriceEur: row.current_price_eur == null ? null : Number(row.current_price_eur),
      wasPriceEur:
        row.was_price_eur == null ? null : Number(row.was_price_eur),
      discountLabel: row.discount_label,
      pricePerUnit: row.price_per_unit,
      priceUnitType: row.price_unit_type,
      sellBy: row.sell_by,
      isAlcohol: row.is_alcohol === true,
    }),
  };
}

// National offers are shared read-only data. Coalesce concurrent loads for the
// same project/department; a short expiry keeps new Thursday publications fresh.
type OfferCacheEntry = { refreshedAt: number; rows?: RetailWeeklyOfferRow[]; refresh?: Promise<RetailWeeklyOfferRow[]> };
const weeklyOfferLoads = new Map<string, OfferCacheEntry>();
const WEEKLY_OFFER_CACHE_MS = 60_000;
const WEEKLY_OFFER_FALLBACK_MS = 5 * 60_000;

export async function loadRetailWeeklyOffersForBanner(
  supabase: SupabaseClient,
  retailBanner: string,
  options?: { serviceArea?: SupervaluServiceArea | null; reference?: Date },
): Promise<RetailWeeklyOfferRow[]> {
  if (options?.serviceArea) {
    const rows = await loadRetailWeeklyOffersForBanner(supabase,retailBanner,{reference:options.reference});
    return rows.filter(row=>row.service_area===options.serviceArea);
  }
  const project = (supabase as unknown as { supabaseUrl?: string }).supabaseUrl;
  if (!project) return fetchRetailWeeklyOffersForBanner(supabase, retailBanner, options);
  const reference = options?.reference ?? new Date();
  const key = `${project}:${retailBanner}:${options?.serviceArea ?? "all"}:${retailCalendarDay(reference)}`;
  let entry = weeklyOfferLoads.get(key);
  if (!entry) {
    entry = {refreshedAt: 0};
    if (weeklyOfferLoads.size >= 32) weeklyOfferLoads.delete(weeklyOfferLoads.keys().next().value!);
    weeklyOfferLoads.set(key, entry);
  }
  const cache = entry;
  const safeRows = () => filterRetailWeeklyOffersToActiveWeek(cache.rows ?? [], reference);
  if (cache.rows && Date.now() - cache.refreshedAt < WEEKLY_OFFER_CACHE_MS) return [...safeRows()];
  if (!cache.refresh) {
    cache.refresh = fetchRetailWeeklyOffersForBanner(supabase, retailBanner, options).then(rows => {
      cache.rows = rows; cache.refreshedAt = Date.now(); return rows;
    }).finally(() => {cache.refresh = undefined;});
  }
  // A short verified snapshot covers transient database stalls. Date and source
  // freshness are checked again on every read; expired offers never survive.
  if (cache.rows && Date.now() - cache.refreshedAt < WEEKLY_OFFER_FALLBACK_MS) {
    void cache.refresh.catch(() => {});
    return [...safeRows()];
  }
  return [...await cache.refresh];
}

async function fetchRetailWeeklyOffersForBanner(
  supabase: SupabaseClient,
  retailBanner: string,
  options?: { serviceArea?: SupervaluServiceArea | null; reference?: Date },
): Promise<RetailWeeklyOfferRow[]> {
  const reference = options?.reference ?? new Date();
  const pageSize = 1000;
  const rows: RetailWeeklyOfferRow[] = [];
  const readPage = async (from: number) => {
    let query = supabase
      .from("retail_weekly_offers")
      .select("id,sku,product_name,department,offer_channel,service_area,fulfilment,current_price_eur,was_price_eur,discount_label,price_per_unit,category_breadcrumb,campaign_names,sell_by,price_unit_type,is_alcohol,offer_week_start,offer_week_end,search_text,synced_at")
      .eq("retail_banner", retailBanner)
      .eq("is_national", true)
      .lte("offer_week_start", retailCalendarDay(reference))
      .gte("offer_week_end", retailCalendarDay(reference));

    if (options?.serviceArea) {
      query = query.eq("service_area", options.serviceArea);
    }

    query = query
      .order("service_area", { ascending: true })
      .order("department", { ascending: true })
      .order("product_name", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);

    const { data, error } = await query;
    if (error) throw new Error(error.message);

    return (data ?? []) as RetailWeeklyOfferRow[];
  };
  let from = 0;
  while (true) {
    // The first page discovers small catalogues; subsequent pages overlap in bounded waves.
    const starts = from === 0 ? [0] : [from, from + pageSize, from + 2 * pageSize];
    const pages = await Promise.all(starts.map(readPage));
    for (const data of pages) {
    const batch = filterRetailWeeklyOffersToActiveWeek(
      data,
      reference,
    );
    rows.push(...batch);
    // Pagination must be based on rows fetched from Supabase, not rows that
    // survived active-week / price validation. Otherwise one invalid row on
    // page 1 can silently hide every later department from Cara.
    if (data.length < pageSize) return rows;
    from += pageSize;
    }
  }

  return rows;
}

/** Latest offer_week_end stored for a banner (null when none synced). */
export async function loadLatestRetailOfferWeekEnd(
  supabase: SupabaseClient,
  retailBanner: string,
  reference = new Date(),
): Promise<string | null> {
  const rows = await loadRetailWeeklyOffersForBanner(supabase, retailBanner, {reference});
  return rows.reduce<string | null>((latest,row) => !latest || row.offer_week_end > latest ? row.offer_week_end : latest, null);
}

/** Compare literal identities across spoken/typed punctuation, retaining sizes and + variants. */
function literalProductIdentity(text: string): {key: string; offsets: number[]} {
  let key = ""; const offsets: number[] = [];
  for (const token of text.toLowerCase().matchAll(/\d+(?:\.\d+)?|[a-z]+|\+/g)) {
    if (token[0] === "and") continue;
    key += token[0];
    for (let i=0;i<token[0].length;i++) offsets.push(token.index!+i);
  }
  return {key,offsets};
}

function stripAlternativePromotionComparison(query: string): string {
  // "Is it a multibuy or a reduced price?" asks which applies; it is not a
  // request to hide every non-multibuy product. Keep restrictive filters intact.
  if (/\bmulti[- ]?buys?\b/i.test(query) && /\breduced\s+price\b/i.test(query)
      && !/\b(?:only|not|without|exclude|excluding)\b/i.test(query)) {
    return query.replace(/\bmulti[- ]?buys?\b|\breduced\s+price\b/gi," ");
  }
  return query;
}

/** Product-token search on synced weekly offers, with category/list browse fallback. */
export function searchSyncedWeeklyOffersInRows(
  rows: RetailWeeklyOfferRow[],
  query: string,
  options?: WeeklyOfferSearchFilters & { limit?: number; reference?: Date },
): WeeklyOfferMatch[] {
  const original = stripAlternativePromotionComparison(query).trim().slice(0, RETAIL_WEEKLY_OFFERS_SEARCH_MAX_QUERY_CHARS);
  if (!original) return [];
  const reference = options?.reference ?? new Date();
  const tokenLimit = options?.limit ?? RETAIL_WEEKLY_OFFERS_SEARCH_MAX_RESULTS;
  const sunday = new Date(`${retailCalendarDay(reference)}T12:00:00Z`);
  sunday.setUTCDate(sunday.getUTCDate() + (7 - sunday.getUTCDay()) % 7);
  const expiry = /\b(?:expir(?:e|es|ing)|end(?:s|ing)?)\b.*\bthis Sunday\b/i.test(query) ? sunday.toISOString().slice(0,10)
    : query.match(/\b(?:expir(?:e|es|ing)|end(?:s|ing)?)\b.*?(\d{4}-\d{2}-\d{2})/i)?.[1];
  const dateChecked = rows.filter(row=>(!expiry || row.offer_week_end===expiry) && isRetailOfferWeekActive(row,reference) && isRetailOfferObservationFresh(row.synced_at,reference));
  // A full name wins before interpreting "No Drain", "No Added Sugar",
  // ingredient names, sizes or packaging as customer search instructions.
  const identity = literalProductIdentity(original);
  const literalMatches = dateChecked.filter(row=>{
    const product=literalProductIdentity(row.product_name).key;
    const index=product ? identity.key.indexOf(product) : -1;
    if(index<0)return false;
    const start=identity.offsets[index]!;
    const end=identity.offsets[index+product.length-1]!+1;
    const request=original.slice(0,start)+" "+original.slice(end);
    const scope=resolveWeeklyOfferSearchFilters(positiveRetailQuery(request),options);
    return matchesRetailQueryConstraints(request,row.product_name,`${row.department} ${row.category_breadcrumb ?? ""}`)
      && rowMatchesFilters(row,scope,{excludeMeat:inferWeeklyOffersExcludeMeat(request),alcoholOnly:inferAlcoholOnlyFromQuery(request)})
      && filterWeeklyOffersByPromotionQuery([row],request).length>0;
  });
  if(literalMatches.length)return literalMatches.slice(0,tokenLimit).map(row=>rowToMatch(row,1));

  const trimmed=positiveRetailQuery(original);
  if(!trimmed)return [];
  const activeRows=dateChecked.filter(row=>(!expiry || row.offer_week_end===expiry)
    && matchesRetailQueryConstraints(original,row.product_name,`${row.department} ${row.category_breadcrumb ?? ""}`)
    && matchesMeatCookingContext(trimmed,row.product_name,`${row.department} ${row.category_breadcrumb ?? ""}`)
    && matchesNappySizeContext(trimmed,row.product_name,row.category_breadcrumb ?? ""));
  rows = filterWeeklyOffersByPromotionQuery(activeRows, stripAlternativePromotionComparison(query));
  const filters = resolveWeeklyOfferSearchFilters(trimmed, options);
  const excludeMeat = inferWeeklyOffersExcludeMeat(trimmed);
  const alcoholOnly = inferAlcoholOnlyFromQuery(trimmed);
  const nappySize=requestedNappySize(trimmed);
  if(nappySize && offerSearchProductIdentityTokens(trimmed).every(token=>/^(?:baby|nappies|nappy|diaper|diapers|size|plus|one|two|three|four|five|six|seven|eight|nine|[0-9]+)$/.test(token))) {
    return rows.filter(row=>rowMatchesFilters(row,filters,{excludeMeat,alcoholOnly})).slice(0,tokenLimit).map(row=>rowToMatch(row,1));
  }
  const listIntent = inferWeeklyOffersListIntent(trimmed);
  const browseCategories = inferWeeklyOffersBrowseCategories(trimmed);
  const listLimit = Math.max(tokenLimit, RETAIL_WEEKLY_OFFERS_LIST_MAX_RESULTS);
  const browseOptions = { excludeMeat, filters, alcoholOnly };
  const rewardsPricePoint = inferRewardsPricePointFromQuery(trimmed);
  if (rewardsPricePoint != null) {
    return rows
      .filter((row) => rowMatchesFilters(row, filters, { excludeMeat, alcoholOnly }))
      .filter(
        (row) =>
          isRewardsOfferRow(row) &&
          Math.abs(Number(row.current_price_eur) - rewardsPricePoint) <= 0.01,
      )
      .sort(
        (a, b) =>
          Number(a.is_alcohol === true) - Number(b.is_alcohol === true) ||
          a.product_name.localeCompare(b.product_name),
      )
      .slice(0, tokenLimit)
      .map((row, index) => rowToMatch(row, 1 - index * 0.01));
  }

  const categoryMatches = categoryBrowseMatches(
    rows,
    trimmed,
    filters,
    { excludeMeat, alcoholOnly },
  );

  // A caller asking for a real department/category ("cereals", "yogurts",
  // "crisps", etc.) wants offers from that category, not a fake product-name
  // clarification. Detect it from catalogue metadata instead of hardcoding.
  if (!listIntent && categoryMatches.length > 0) {
    const tokens = offerSearchProductTokens(trimmed);
    const directProductMatches = categoryMatches.filter((row) =>
      tokens.every((token) =>
        retailSearchTokenMatchesText(row.product_name, token),
      ),
    );
    // If at least one actual product name matches the caller's words, do not
    // let a department/category breadcrumb turn unrelated products into hits.
    // Example: "steaks" should not return battered fish merely because its
    // category is "Breaded Fillets & Steaks".
    if (directProductMatches.length === 0) {
      return categoryMatches
        .map((row) => ({ row, score: scoreOfferRow(row, tokens) }))
        .sort(
          (a, b) =>
            b.score - a.score ||
            a.row.product_name.localeCompare(b.row.product_name),
        )
        .slice(0, tokenLimit)
        .map((entry) => rowToMatch(entry.row, entry.score));
    }
  }

  if (listIntent) {
    if (categoryMatches.length > 0) {
      return sampleRetailWeeklyOffersAcrossDepartments(categoryMatches, listLimit, browseOptions);
    }
    // Explicit multi-category requests may name several products. General
    // department requests must browse the actual complete department, not a
    // hardcoded selection of tea, biscuits, bread, etc.
    if (!filters.serviceArea && !filters.fulfilment && offerSearchProductTokens(trimmed).length >= 2 && browseCategories.length >= 2) {
      const browsed = browseRetailWeeklyOffers(rows, browseCategories, listLimit, browseOptions);
      if (browsed.length > 0) return browsed;
    }
    if (/\b(?:household|frozen)\b/i.test(trimmed) && categoryMatches.length === 0) return [];
    if (offerSearchProductTokens(trimmed).length === 0 || shouldUseStructuredPromotionSearch(trimmed)) {
      return sampleRetailWeeklyOffersAcrossDepartments(rows, listLimit, browseOptions);
    }
  }

  const tokens = offerSearchProductTokens(trimmed);
  if (tokens.length === 0) {
    if (filters.serviceArea || filters.fulfilment) {
      return sampleRetailWeeklyOffersAcrossDepartments(rows, tokenLimit, browseOptions);
    }
    return [];
  }

  let matches = rows
    .filter((row) => rowMatchesFilters(row, filters, { excludeMeat, alcoholOnly }))
    .map((row) => ({
      row,
      score: scoreOfferRow(row, tokens),
    }))
    .filter((entry) => entry.score >= 0.5)
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.row.product_name.localeCompare(b.row.product_name),
    );
  matches = preferProductNameMatches(matches, tokens);

  if (matches.length === 0) {
    if (filters.serviceArea && !isSpecificProductOfferQuery(trimmed)) {
      return sampleRetailWeeklyOffersAcrossDepartments(rows, tokenLimit, browseOptions);
    }
    if (browseCategories.length > 0 && !isSpecificProductOfferQuery(trimmed)) {
      return browseRetailWeeklyOffers(rows, browseCategories, tokenLimit, browseOptions);
    }
  }

  return matches.slice(0, tokenLimit).map((entry) => rowToMatch(entry.row, entry.score));
}

export async function searchSyncedWeeklyOffersByQuery(
  supabase: SupabaseClient,
  retailBanner: string,
  query: string,
  options?: WeeklyOfferSearchFilters & { limit?: number; reference?: Date },
): Promise<WeeklyOfferMatch[]> {
  const filters = resolveWeeklyOfferSearchFilters(query, options);
  const reference = options?.reference ?? new Date();
  const rows = await loadRetailWeeklyOffersForBanner(supabase, retailBanner, {
    serviceArea: filters.serviceArea, reference,
  });
  return searchSyncedWeeklyOffersInRows(rows, query, { ...options, reference });
}

export async function searchRetailWeeklyOffers(
  supabase: SupabaseClient,
  retailBanner: string,
  query: string,
  options?: WeeklyOfferSearchFilters & { reference?: Date },
): Promise<WeeklyOfferMatch[]> {
  return searchSyncedWeeklyOffersByQuery(supabase, retailBanner, query, options);
}

export function buildRetailWeeklyOffersPromptSection(input: {
  offers: RetailWeeklyOfferRow[];
  syncedAt: string | null;
  reference?: Date;
}): string | null {
  const offers = filterRetailWeeklyOffersToActiveWeek(input.offers, input.reference);
  if (offers.length === 0) return null;

  const syncedLabel = input.syncedAt
    ? new Date(input.syncedAt).toLocaleString("en-IE", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "Europe/Dublin",
      })
    : "recently";

  const sampled = sampleRetailWeeklyOffersAcrossDepartments(
    offers,
    RETAIL_WEEKLY_OFFERS_PROMPT_MAX_ITEMS,
  );

  const areaCounts: Record<string, number> = {};
  for (const row of offers) {
    areaCounts[row.service_area] = (areaCounts[row.service_area] ?? 0) + 1;
  }

  const lines = sampled.map((offer) => {
    const price = offer.currentPriceEur == null ? "bundle offer" : formatSpokenEurAmount(offer.currentPriceEur);
    const was =
      offer.wasPriceEur != null
        ? ` (was ${formatSpokenEurAmount(offer.wasPriceEur)})`
        : "";
    const label = offer.discountLabel
      ? ` — ${formatSpokenDiscountLabel(offer.discountLabel) ?? offer.discountLabel}`
      : "";
    return `• ${offer.productName} (${offer.serviceArea}/${offer.fulfilment}): ${price}${was}${label}`;
  });

  return [
    "This week's SuperValu offers (synced " +
      syncedLabel +
      ", " +
      offers.length +
      " promos; butcher " +
      (areaCounts.butcher ?? 0) +
      ", deli " +
      (areaCounts.deli ?? 0) +
      ", produce " +
      (areaCounts.produce ?? 0) +
      ", off-licence " +
      (areaCounts.off_licence ?? 0) +
      ", grocery " +
      (areaCounts.grocery ?? 0) +
      "):",
    ...lines,
    "Use searchSuperValuProducts for offer/price questions — quote only what it returns.",
  ].join("\n");
}
