// @ts-nocheck -- generated source is checked by the app build and catalogue tests.
// Generated from cara-platform by scripts/sync-catalogue-runtime.py. Do not edit.
import { positiveRetailQuery, matchesRetailQueryConstraints } from "./retail-query-constraints.js";
import type { SupabaseClient } from "@supabase/supabase-js";

import { fetchSupervaluGatewaySearch, SUPERVALU_GATEWAY_PAGE_SIZE } from "./supervalu-gateway.js";
import { queryRequestsLowestPrice, stripPriceComparisonWords, type RetailPriceBasis } from "./retail-price-comparison.js";
import { matchesNappySizeContext, matchesMeatCookingContext, matchesBurgerProductContext, stripBurgerSearchContext } from "./retail-product-context.js";
import {
  searchNationalRetailCatalog,
  searchStoredRetailCatalog,
} from "./retail-catalog-search.js";
import {
  isPromotionalSupervaluProduct,
  normalizeSearchText,
} from "./supervalu-offers-normalize.js";
import type { SupervaluFulfilment, SupervaluGatewayProduct, SupervaluServiceArea } from "./supervalu-offers-types.js";
import { parseRetailMultibuyLabel } from "./retail-price-presentation.js";
import { retailSearchTokenMatchesText } from "./retail-search-fuzzy.js";
import { searchStructuredNationalPromotions, shouldUseStructuredPromotionSearch } from "./retail-promotion-search.js";
import {
  inferRewardsPricePointFromQuery,
  inferWeeklyOffersListIntent,
  offerSearchProductIdentityTokens,
  resolveWeeklyOfferSearchFilters,
  searchSyncedWeeklyOffersByQuery,
  RETAIL_WEEKLY_OFFERS_LIST_MAX_RESULTS,
  tokenizeSupervaluSearchQuery,
  scoreSupervaluSearchText,
  type WeeklyOfferMatch,
} from "./retail-weekly-offers-search.js";
import {
  formatSpokenDiscountLabel,
  formatSpokenEurAmount,
  speakEmbeddedEurAmounts,
} from "./spoken-eur-price.js";

export const SUPERVALU_CATALOG_SEARCH_MAX_QUERY_CHARS = 120;
export const SUPERVALU_CATALOG_SEARCH_MAX_RESULTS = 5;

const CATALOG_BRAND_QUERY_TOKENS = new Set(["supervalu", "own", "brand"]);
const CATALOG_PREP_NOISE_TOKENS = new Set(["dried", "fresh", "frozen", "medium", "large", "small"]);

export type CatalogQuoteIntent = "offer" | "price" | "stock";

/** Collapse caller/STT phrasing like "Super Value own brand" into searchable product words. */
export function normalizeCatalogBrandQuery(query: string): string {
  return query
    .replace(/\bsuper\s+value\b/gi, "SuperValu")
    .replace(/\bown[\s-]?brand\b/gi, " ")
    .replace(/\b(?:the\s+)?supervalu\s+brand\b/gi, "SuperValu")
    .replace(/\bbrand\b/gi, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function queryRequestsSupervaluOwnLabel(query: string): boolean {
  const q = query.toLowerCase();
  return (
    /\bsupervalu\b/.test(q) ||
    /\bsuper\s+value\b/.test(q) ||
    /\bown[\s-]?brand\b/.test(q)
  );
}

export function catalogProductTokens(query: string): string[] {
  const core =
    stripCatalogPackagingNoise(
      stripCatalogSearchBoilerplate(normalizeCatalogBrandQuery(query)),
    ) ||
    normalizeCatalogBrandQuery(query);
  return offerSearchProductIdentityTokens(core).filter(
    (token) =>
      !CATALOG_BRAND_QUERY_TOKENS.has(token) && !CATALOG_PREP_NOISE_TOKENS.has(token),
  );
}

function productNameMatchesTokens(productName: string, tokens: string[]): boolean {
  if (tokens.length === 0) return true;
  if (tokens.length >= 2) {
    return tokens.every((token) => retailSearchTokenMatchesText(productName, token));
  }
  return retailSearchTokenMatchesText(productName, tokens[0]!);
}

/** Drop partial fish/meat matches when the caller asked for a specific product phrase. */
export function filterCatalogMatchesByQuery(
  query: string,
  matches: SupervaluCatalogMatch[],
): SupervaluCatalogMatch[] {
  matches = matches.filter(match=>matchesRetailQueryConstraints(query,match.productName,match.department));
  const identity = (text:string)=>normalizeSearchText(text).replace(/[^a-z0-9]/g, "");
  const requestKey=identity(query);
  const namedMatches=matches.filter(match=>{
    const nameKey=identity(match.productName);
    return nameKey.length>=5 && requestKey.includes(nameKey);
  });
  if(namedMatches.length)return namedMatches;
  query = positiveRetailQuery(query);
  matches = matches.filter((match) => matchesBurgerProductContext(query, match.productName, match.department) && matchesMeatCookingContext(query, match.productName, match.department) && matchesNappySizeContext(query,match.productName,match.department));
  if (matches.length === 0 || inferWeeklyOffersListIntent(query)) return matches;

  const productTokens = catalogProductTokens(query);
  if (productTokens.length === 0) {
    return matches;
  }

  const applyOwnLabelFilter = (pool: SupervaluCatalogMatch[]) => {
    if (!queryRequestsSupervaluOwnLabel(query)) return pool;
    return pool.filter((match) => /\bsupervalu\b/i.test(match.productName));
  };

  const strictMatches = matches.filter((match) =>
    productNameMatchesTokens(match.productName, productTokens),
  );
  if (strictMatches.length > 0) {
    return applyOwnLabelFilter(strictMatches);
  }

  if (productTokens.length >= 3) return [];
  const broadMatches = matches.filter((match) =>
    productTokens.some((token) =>
      productNameMatchesTokens(match.productName, [token]),
    ),
  );
  if (broadMatches.length > 0) {
    return applyOwnLabelFilter(broadMatches);
  }

  return matches;
}

function shortCatalogProductLabel(productName: string): string {
  return productName
    .replace(/\([^)]*\)\s*$/, "")
    .replace(/\s{2,}/g, " ")
    .trim()
    .split(/\s+/)
    .slice(0, 5)
    .join(" ");
}

export function formatOwnBrandFallbackQuote(
  productQuery: string,
  alternatives: SupervaluCatalogMatch[],
): string {
  const labels = [
    ...new Set(alternatives.map((match) => shortCatalogProductLabel(match.productName))),
  ].slice(0, 3);
  const examples =
    labels.length > 0
      ? ` Other brands on the range include ${labels.join("; ")}.`
      : "";
  return [
    `I don't see a SuperValu own-label match for ${productQuery.trim()} on the national range I checked — that doesn't mean we never stock it on the shelf.${examples}`,
    "I can't confirm today's shelf stock from here — a team member can double-check the own-label section if you'd like.",
  ].join(" ");
}

/** Infer whether the caller wants offer status, a price, or stock/range info. */
export function inferCatalogSearchIntent(query: string): CatalogQuoteIntent {
  const q = query.toLowerCase();
  if (queryRequestsLowestPrice(q)) return "price";
  if (inferRewardsPricePointFromQuery(q) != null || shouldUseStructuredPromotionSearch(q)) {
    return "offer";
  }
  if (
    /\boffers?\b|\bon offer\b|\bthis week\b|\bspecials?\b|\bpromo|\bpromotion|\bdeals?\b|\breduced\b|\bany offers\b|\bis it on\b|\bare they on\b|\boffers?\s+this\b/i.test(
      q,
    )
  ) {
    return "offer";
  }
  if (
    /\bhow much\b|\bprice\b|\bcost\b|\bwhat'?s the price\b|\bhow much is\b|\bwhat is the price\b/i.test(
      q,
    )
  ) {
    return "price";
  }
  return "stock";
}

/** Strip offer/price phrasing so gateway search matches product names. */
export function stripCatalogSearchBoilerplate(query: string): string {
  return stripPriceComparisonWords(stripBurgerSearchContext(query))
    .replace(
      /\b(on offer|this week|any offers?|offers?|specials?|promotions?|promos?|deals?|reduced|how much is|how much|what(?:'s| is) the price|what(?:'s| is) the cost|price of|cost of|do you stock|do you sell|do you carry|are they on|is it on)\b/gi,
      " ",
    )
    .replace(
      /\b(just wondering|i was wondering|hello|hi|yeah|yep|there|any|some|well|please|thanks|thank you|could you|can you|would you|tell me|let me know|do you know|have you got|have ye got|got any|is there|are there|what are|what'?s|whats|what is|what were|wondering)\b/gi,
      " ",
    )
    .replace(/^(?:is|are|the|a|an)\b\s*/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Strip packaging / aisle phrasing callers use — not product names on the gateway. */
export function stripCatalogPackagingNoise(query: string): string {
  return query
    .replace(
      /\b(packets?|packs?|pre\s*-?\s*pack(?:ed|s)?|packaged|sealed|chilled|aisle|tray|fridge|shelf|counter|loose|fresh sliced)\b/gi,
      " ",
    )
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Expand caller phrasing into gateway queries that actually return results. */
export function expandSupervaluCatalogSearchQueries(query: string): string[] {
  const trimmed = normalizeCatalogBrandQuery(query.trim());
  if (!trimmed) return [];

  const boilerplate = stripCatalogSearchBoilerplate(trimmed) || trimmed;
  const core = stripCatalogPackagingNoise(boilerplate) || boilerplate;
  const ordered: string[] = [];
  const seen = new Set<string>();
  const add = (value: string) => {
    const normalized = value.trim();
    if (!normalized) return;
    const key = normalized.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    ordered.push(normalized);
  };

  if (core !== boilerplate && core !== trimmed) add(core);
  if (boilerplate !== trimmed) add(boilerplate);
  add(trimmed);

  const tokens = tokenizeSupervaluSearchQuery(core);
  if (tokens.length >= 2) {
    add(tokens.slice(0, 2).join(" "));
    add(tokens[0]!);
  } else if (tokens.length === 1) {
    add(tokens[0]!);
  }

  const productTokens = catalogProductTokens(trimmed);
  if (queryRequestsSupervaluOwnLabel(trimmed) && productTokens.length > 0) {
    add(`SuperValu ${productTokens.join(" ")}`);
    add(productTokens.join(" "));
  }

  if (/sriracha/i.test(trimmed)) {
    add(trimmed.replace(/sriracha/gi, "chilli"));
    if (/hellmann/i.test(trimmed)) {
      add("Hellmann's chilli");
    }
  }

  return ordered;
}

export type SupervaluCatalogProduct = {
  productName: string;
  department: string;
  sku: string | null;
  sourceUrl: string | null;
  searchText: string;
  currentPriceEur: number | null;
  wasPriceEur: number | null;
  discountLabel: string | null;
  pricePerUnit: string | null;
  isOnOffer: boolean;
};

export type SupervaluCatalogMatch = {
  offerWeekStart?: string;
  offerWeekEnd?: string;
  priceConflict?: boolean;
  productName: string;
  department: string;
  sku: string | null;
  currentPriceEur: number | null;
  wasPriceEur: number | null;
  discountLabel: string | null;
  isOnOffer: boolean;
  score: number;
  quoteText: string;
  serviceArea?: string;
  fulfilment?: string;
  isAlcohol?: boolean;
  campaignNames?: string[];
  source?: "synced" | "gateway" | "catalog";
  priceBasis?: RetailPriceBasis;
};

function parseGatewayPriceEur(product: SupervaluGatewayProduct): number | null {
  const current = Number(product.priceNumeric ?? product.wholePrice ?? 0);
  if (Number.isFinite(current) && current > 0) return current;
  const fromLabel = String(product.price ?? "")
    .replace(/[^\d.,]/g, "")
    .replace(",", ".");
  const parsed = Number(fromLabel);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function normalizeSupervaluCatalogProduct(
  product: SupervaluGatewayProduct,
): SupervaluCatalogProduct | null {
  const productName = String(product.name ?? "").trim();
  if (!productName) return null;

  const sku = String(product.sku ?? product.productId ?? "").trim() || null;
  const department =
    String(product.attributes?.altCategory ?? "").trim() || "Grocery";
  const currentPriceEur = parseGatewayPriceEur(product);
  const wasRaw = Number(product.wasPriceNumeric ?? 0);
  const wasPriceEur =
    currentPriceEur != null &&
    Number.isFinite(wasRaw) &&
    wasRaw > currentPriceEur
      ? wasRaw
      : null;

  return {
    productName,
    department,
    sku,
    sourceUrl: String(product.url ?? "").trim() || null,
    searchText: normalizeSearchText(
      [productName, department, sku ?? ""].filter(Boolean).join(" "),
    ),
    currentPriceEur,
    wasPriceEur,
    discountLabel: String(product.priceLabel ?? "").trim() || null,
    pricePerUnit: String(product.pricePerUnit ?? "").trim() || null,
    isOnOffer: isPromotionalSupervaluProduct(product),
  };
}

function catalogProductToMatch(
  product: SupervaluCatalogProduct,
  score: number,
  intent: CatalogQuoteIntent,
): SupervaluCatalogMatch {
  return {
    productName: product.productName,
    department: product.department,
    sku: product.sku,
    currentPriceEur: product.currentPriceEur,
    wasPriceEur: product.wasPriceEur,
    discountLabel: product.discountLabel,
    isOnOffer: product.isOnOffer,
    score,
    quoteText: formatCatalogStockQuote({
      productName: product.productName,
      department: product.department,
      currentPriceEur: product.currentPriceEur,
      wasPriceEur: product.wasPriceEur,
      discountLabel: product.discountLabel,
      pricePerUnit: product.pricePerUnit,
      isOnOffer: product.isOnOffer,
      intent,
    }),
    source: "gateway",
  };
}

export function formatCatalogStockQuote(input: {
  productName: string;
  department?: string | null;
  currentPriceEur?: number | null;
  wasPriceEur?: number | null;
  discountLabel?: string | null;
  pricePerUnit?: string | null;
  isOnOffer?: boolean;
  intent?: CatalogQuoteIntent;
}): string {
  const dept =
    input.department && input.department !== "Grocery"
      ? ` (${input.department})`
      : "";
  const intent = input.intent ?? "stock";
  const onOffer =
    input.isOnOffer ??
    ((input.wasPriceEur != null &&
      input.currentPriceEur != null &&
      input.wasPriceEur > input.currentPriceEur) ||
      Boolean(input.discountLabel?.trim()));
  const parts: string[] = [];

  if (onOffer && parseRetailMultibuyLabel(input.discountLabel)) {
    parts.push(`${input.productName}${dept}. ${formatSpokenDiscountLabel(input.discountLabel)} on the SuperValu national range.`);
    if (input.currentPriceEur != null && input.currentPriceEur > 0) {
      parts.push(`Single item price ${formatSpokenEurAmount(input.currentPriceEur)}.`);
    }
    parts.push("I can't confirm today's shelf stock from here.");
    return parts.join(" ");
  }

  if (intent === "offer") {
    if (onOffer && input.currentPriceEur != null) {
      const price = formatSpokenEurAmount(input.currentPriceEur);
      const wasPrice =
        input.wasPriceEur != null
          ? formatSpokenEurAmount(input.wasPriceEur)
          : null;
      parts.push(
        wasPrice
          ? `${input.productName}${dept} is on offer this week at ${price} — was ${wasPrice} — on the SuperValu national range.`
          : `${input.productName}${dept} is on offer this week at ${price} on the SuperValu national range.`,
      );
      const spokenLabel = formatSpokenDiscountLabel(input.discountLabel);
      if (spokenLabel) {
        parts[parts.length - 1] += ` Offer label: ${spokenLabel}.`;
      }
    } else {
      parts.push(
        `${input.productName}${dept} is not showing as on offer this week on the national range I checked.`,
      );
    }
    parts.push(
      "I can't confirm in-store shelf promos — a team member can double-check if you'd like.",
    );
    return parts.join(" ");
  }

  if (input.currentPriceEur != null) {
    const price = formatSpokenEurAmount(input.currentPriceEur);
    if (onOffer) {
      const wasPrice =
        input.wasPriceEur != null
          ? formatSpokenEurAmount(input.wasPriceEur)
          : null;
      parts.push(
        wasPrice
          ? `${input.productName}${dept} is on offer at ${price} — was ${wasPrice} — on the SuperValu national range.`
          : `${input.productName}${dept} is on offer at ${price} on the SuperValu national range.`,
      );
      const spokenLabel = formatSpokenDiscountLabel(input.discountLabel);
      if (spokenLabel) {
        parts[parts.length - 1] += ` Offer label: ${spokenLabel}.`;
      }
    } else if (intent === "price") {
      parts.push(
        `${input.productName}${dept} is ${price} — that's the regular price; it's not on offer this week on the range I checked.`,
      );
    } else {
      parts.push(
        `${input.productName}${dept} is listed at ${price} on the SuperValu national range — not on offer this week.`,
      );
    }
    if (input.pricePerUnit) {
      parts.push(`Unit price: ${speakEmbeddedEurAmounts(input.pricePerUnit)}.`);
    }
  } else {
    parts.push(
      `As far as I'm aware, yes — we carry ${input.productName}${dept} as part of the SuperValu range.`,
    );
  }

  parts.push(
    "I can't confirm today's shelf price or that it's in stock at this exact moment.",
  );
  if (intent !== "price") {
    parts.push(
      "I can ask a team member to call you back to confirm availability — would that suit you?",
    );
  }

  return parts.join(" ");
}

export function formatCatalogStockNoMatchQuote(query: string): string {
  return [
    `I couldn't find "${query.trim()}" on the SuperValu product range I checked — I don't want to guess.`,
    "I can ask someone on the shop floor to call you back if you'd like, or you can check when you're in.",
  ].join(" ");
}

export function formatOfferFulfilmentMissQuote(input: {
  query: string;
  requestedFulfilment: SupervaluFulfilment;
  alternateMatches: Array<{ quoteText: string }>;
}): string {
  const product = input.query.trim();
  const channel =
    input.requestedFulfilment === "counter"
      ? "at the butcher counter this week"
      : "in the pre-pack aisle this week";
  const alternateChannel =
    input.requestedFulfilment === "counter"
      ? "in the pre-pack aisle this week"
      : "at the butcher counter this week";

  if (input.alternateMatches.length === 0) {
    return [
      `No synced weekly offer for "${product}" ${channel} on the list I checked.`,
      "Do not say we never sell that product or that the butcher counter does not carry it — only that it is not on this week's synced offer list for that section.",
      "Offer a team callback if they need someone to check the counter in person.",
    ].join(" ");
  }

  const quotes = input.alternateMatches
    .map((match) => match.quoteText.trim())
    .filter(Boolean)
    .join("\n\n");

  return [
    `No synced weekly offer for "${product}" ${channel} on the list I checked.`,
    `There IS a synced offer ${alternateChannel} — if that is what they meant, quote only this:`,
    quotes,
    "Do not say we do not sell that product at the counter — say this week's synced offer list does not include it for the section they asked about.",
  ].join("\n\n");
}


function syncedOfferToCatalogMatch(offer: WeeklyOfferMatch): SupervaluCatalogMatch {
  return {
    productName: offer.productName,
    department: offer.department,
    sku: offer.sku ?? null,
    offerWeekStart: offer.offerWeekStart,
    offerWeekEnd: offer.offerWeekEnd,
    currentPriceEur: offer.currentPriceEur,
    wasPriceEur: offer.wasPriceEur,
    discountLabel: offer.discountLabel,
    isOnOffer: true,
    score: offer.score,
    quoteText: offer.quoteText,
    serviceArea: offer.serviceArea,
    fulfilment: offer.fulfilment,
    isAlcohol: offer.isAlcohol,
    campaignNames: offer.campaignNames,
    source: "synced",
    priceBasis: offer.priceBasis,
  };
}

function normalizeProductKey(value: string): string {
  return normalizeSearchText(value);
}

function mergeGatewayWithSyncedOffers(
  gatewayMatches: SupervaluCatalogMatch[],
  syncedMatches: WeeklyOfferMatch[],
  intent: CatalogQuoteIntent,
  comparePrices = false,
): SupervaluCatalogMatch[] {
  if (syncedMatches.length === 0) return gatewayMatches;

  const syncedCatalog = syncedMatches.map(syncedOfferToCatalogMatch);
  if (intent === "offer") {
    if (gatewayMatches.length === 0) return syncedCatalog;
    const seen = new Set(
      syncedCatalog.map((match) => normalizeProductKey(match.productName)),
    );
    const extras = gatewayMatches.filter(
      (match) =>
        match.isOnOffer &&
        !seen.has(normalizeProductKey(match.productName)),
    );
    return [...syncedCatalog, ...extras].slice(0, comparePrices ? Infinity : SUPERVALU_CATALOG_SEARCH_MAX_RESULTS);
  }

  const syncedByName = new Map<string, WeeklyOfferMatch>();
  for (const offer of syncedMatches) {
    syncedByName.set(normalizeProductKey(offer.productName), offer);
  }

  const merged = gatewayMatches.map((match) => {
    const synced = syncedByName.get(normalizeProductKey(match.productName));
    if (!synced) return match;
    return syncedOfferToCatalogMatch(synced);
  });

  if (comparePrices) {
    const seen = new Set(merged.map((match) => normalizeProductKey(match.productName)));
    merged.push(...syncedCatalog.filter((match) => !seen.has(normalizeProductKey(match.productName))));
  }
  return merged;
}

/** @deprecated Browse sampling removed — use product-token search via searchSupervaluCatalogLive. */
export function inferCatalogOfferBrowseCategories(_query: string): string[] {
  return [];
}

function scoreGatewayItems(
  items: Awaited<ReturnType<typeof fetchSupervaluGatewaySearch>>,
  tokens: string[],
): { product: SupervaluCatalogProduct; score: number }[] {
  return items
    .map((item) => {
      const product = normalizeSupervaluCatalogProduct(item);
      if (!product) return null;
      return {
        product,
        score: scoreSupervaluSearchText(product.searchText, tokens, product.department),
      };
    })
    .filter(
      (entry): entry is { product: SupervaluCatalogProduct; score: number } =>
        entry != null && entry.score >= 0.5,
    )
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.product.productName.localeCompare(b.product.productName),
    );
}

function isStrongCatalogMatch(
  scored: { score: number }[],
  tokens: string[],
): boolean {
  if (scored.length === 0) return false;
  if (tokens.length <= 1) return scored[0]!.score >= 0.5;
  return scored[0]!.score > 0.5;
}

async function searchSupervaluCatalogLiveSingle(
  query: string,
  options?: { storeId?: string; intent?: CatalogQuoteIntent },
): Promise<SupervaluCatalogMatch[]> {
  const trimmed = query.trim().slice(0, SUPERVALU_CATALOG_SEARCH_MAX_QUERY_CHARS);
  if (!trimmed) return [];

  const intent = options?.intent ?? inferCatalogSearchIntent(trimmed);
  const comparePrices = queryRequestsLowestPrice(trimmed);
  const productQuery = stripCatalogSearchBoilerplate(trimmed) || trimmed;
  const coreQuery = stripCatalogPackagingNoise(productQuery) || productQuery;
  const tokens = tokenizeSupervaluSearchQuery(coreQuery);
  if (tokens.length === 0) return [];

  const candidates = expandSupervaluCatalogSearchQueries(trimmed);
  let bestScored: { product: SupervaluCatalogProduct; score: number }[] = [];

  const gatewayDeadline = AbortSignal.timeout(6_000);
  for (const candidate of candidates) {
    const seenPages = new Set<string>();
    const items: Awaited<ReturnType<typeof fetchSupervaluGatewaySearch>> = [];
    for (let skip = 0; ; skip += SUPERVALU_GATEWAY_PAGE_SIZE) {
      const page = await fetchSupervaluGatewaySearch({ query: candidate, storeId: options?.storeId, skip, signal: gatewayDeadline });
      // A gateway that ignores pagination must not keep a caller waiting forever.
      const signature = JSON.stringify(page.map((product) => [product.sku, product.name]));
      if (seenPages.has(signature)) break;
      seenPages.add(signature);
      items.push(...page);
      if (!comparePrices || page.length < SUPERVALU_GATEWAY_PAGE_SIZE) break;
    }
    const scored = scoreGatewayItems(items, tokens);
    if (scored.length === 0) continue;
    if (
      !bestScored[0] ||
      scored[0]!.score > bestScored[0]!.score ||
      (scored[0]!.score === bestScored[0]!.score &&
        scored.length > bestScored.length)
    ) {
      bestScored = scored;
    }
    if (isStrongCatalogMatch(scored, tokens)) break;
  }

  const scored = bestScored;

  if (scored.length === 0) return [];

  if (intent === "offer") {
    const promoMatches = scored.filter(({ product }) => product.isOnOffer);
    if (promoMatches.length === 0) {
      const best = scored[0]!;
      return [catalogProductToMatch(best.product, best.score, intent)];
    }
    return promoMatches
      .slice(0, comparePrices ? Infinity : SUPERVALU_CATALOG_SEARCH_MAX_RESULTS)
      .map(({ product, score }) => catalogProductToMatch(product, score, intent));
  }

  return scored
    .slice(0, comparePrices ? Infinity : SUPERVALU_CATALOG_SEARCH_MAX_RESULTS)
    .map(({ product, score }) => catalogProductToMatch(product, score, intent));
}

async function searchSupervaluCatalogLiveInternal(
  query: string,
  options?: {
    storeId?: string;
    intent?: CatalogQuoteIntent;
    supabase?: SupabaseClient;
    retailBanner?: string;
    fulfilment?: SupervaluFulfilment | null;
    serviceArea?: SupervaluServiceArea | null;
    reference?: Date;
  },
): Promise<SupervaluCatalogMatch[]> {
  const trimmed = query.trim().slice(0, SUPERVALU_CATALOG_SEARCH_MAX_QUERY_CHARS);
  if (!trimmed) return [];

  const intent = options?.intent ?? inferCatalogSearchIntent(trimmed);
  const reference = options?.reference ?? new Date();
  const listIntent = inferWeeklyOffersListIntent(trimmed);
  const comparePrices = queryRequestsLowestPrice(trimmed);
  const resultLimit = comparePrices ? Infinity : listIntent ? RETAIL_WEEKLY_OFFERS_LIST_MAX_RESULTS : SUPERVALU_CATALOG_SEARCH_MAX_RESULTS;

  const filters = resolveWeeklyOfferSearchFilters(positiveRetailQuery(trimmed), {
    fulfilment: options?.fulfilment,
    serviceArea: options?.serviceArea,
  });
  const fulfilment = filters.fulfilment ?? null;
  const serviceArea = filters.serviceArea ?? null;

  // Mechanics are data constraints, not product names. Keep this ahead of
  // ordinary catalogue fallback so an absent 3-for-10 never becomes an
  // unrelated cheap product (or a regular-price stock answer).
  if (shouldUseStructuredPromotionSearch(trimmed) && options?.supabase && options?.retailBanner) {
    const [structured, synced] = await Promise.all([
      searchStructuredNationalPromotions(options.supabase, {
        retailBanner: options.retailBanner, query: trimmed, fulfilment, serviceArea, reference,
        limit: RETAIL_WEEKLY_OFFERS_LIST_MAX_RESULTS,
        signal: AbortSignal.timeout(2_000),
      }).catch((error: unknown) => {
        // Consensus enriches the independently validated weekly results. A slow
        // RPC must not discard those results or exceed the voice tool deadline.
        console.warn("[catalog-search] Promotion consensus unavailable; using matching weekly offers", error instanceof Error ? error.message : "Unknown error");
        return [];
      }),
      searchSyncedWeeklyOffersByQuery(options.supabase, options.retailBanner, trimmed, {
        fulfilment, serviceArea, reference, limit: resultLimit,
      }),
    ]);
    const unique = new Map<string, SupervaluCatalogMatch>();
    for (const match of [...structured, ...synced.map(syncedOfferToCatalogMatch)]) {
      const key = normalizeProductKey(match.productName);
      if (!unique.has(key)) unique.set(key, match);
    }
    return [...unique.values()].slice(0, comparePrices ? Infinity : RETAIL_WEEKLY_OFFERS_LIST_MAX_RESULTS);
  }

  let storedMatches: SupervaluCatalogMatch[] = [];
  let syncedMatches: WeeklyOfferMatch[] = [];
  if (options?.supabase && options?.retailBanner) {
    const input = {
      retailBanner: options.retailBanner, query: trimmed, intent,
      fulfilment, serviceArea, reference,
      limit: resultLimit,
    };
    [storedMatches, syncedMatches] = await Promise.all([
      options.storeId
        ? searchStoredRetailCatalog(options.supabase, { ...input, sourceStoreId: options.storeId })
        : searchNationalRetailCatalog(options.supabase, input),
      searchSyncedWeeklyOffersByQuery(options.supabase, options.retailBanner, trimmed, {
        limit: resultLimit, fulfilment, serviceArea, reference,
      }),
    ]);
  }

  if (intent === "offer" && listIntent && syncedMatches.length > 0) {
    return syncedMatches.map(syncedOfferToCatalogMatch);
  }

  if (intent === "offer" && listIntent && (fulfilment || filters.serviceArea)) {
    return syncedMatches.map(syncedOfferToCatalogMatch);
  }

  // No explicit store source means "national only". Never silently fall back to
  // a default storefront such as 5550: that can leak local butcher/bakery lines
  // and local promotions into another SuperValu store's answers.
  if (!options?.storeId && options?.supabase && options?.retailBanner) {
    const mergedNational = mergeGatewayWithSyncedOffers(
      storedMatches,
      syncedMatches,
      intent,
      comparePrices,
    );
    let filteredNational = filterCatalogMatchesByQuery(trimmed, mergedNational);
    if (fulfilment) {
      filteredNational = filteredNational.filter(
        (match) => match.fulfilment === fulfilment,
      );
    }
    if (serviceArea) {
      filteredNational = filteredNational.filter(
        (match) => match.serviceArea === serviceArea,
      );
    }
    return filteredNational;
  }

  if (storedMatches.length > 0) {
    return filterCatalogMatchesByQuery(trimmed, mergeGatewayWithSyncedOffers(storedMatches, syncedMatches, intent, comparePrices));
  }

  const gatewayMatches = await searchSupervaluCatalogLiveSingle(trimmed, {
    storeId: options?.storeId,
    intent,
  });

  const merged = mergeGatewayWithSyncedOffers(gatewayMatches, syncedMatches, intent, comparePrices);
  let filtered = filterCatalogMatchesByQuery(trimmed, merged);
  if (fulfilment) {
    filtered = filtered.filter((match) => match.fulfilment === fulfilment);
  }
  if (serviceArea) {
    filtered = filtered.filter((match) => match.serviceArea === serviceArea);
  }
  return filtered;
}

export type SupervaluCatalogSearchResult = {
  matches: SupervaluCatalogMatch[];
  ownBrandFallbackQuote: string | null;
};

export async function searchSupervaluCatalogLiveWithFallback(
  query: string,
  options?: {
    storeId?: string;
    intent?: CatalogQuoteIntent;
    supabase?: SupabaseClient;
    retailBanner?: string;
    fulfilment?: SupervaluFulfilment | null;
    serviceArea?: SupervaluServiceArea | null;
    reference?: Date;
  },
): Promise<SupervaluCatalogSearchResult> {
  const trimmed = query.trim().slice(0, SUPERVALU_CATALOG_SEARCH_MAX_QUERY_CHARS);
  if (!trimmed) return { matches: [], ownBrandFallbackQuote: null };

  const normalized = normalizeCatalogBrandQuery(trimmed);
  const searchQuery = normalized || trimmed;
  const matches = await searchSupervaluCatalogLiveInternal(searchQuery, options);

  if (matches.length > 0 || !queryRequestsSupervaluOwnLabel(searchQuery)) {
    return { matches, ownBrandFallbackQuote: null };
  }

  const productOnly = catalogProductTokens(searchQuery).join(" ").trim();
  if (!productOnly || productOnly.toLowerCase() === searchQuery.toLowerCase()) {
    return { matches: [], ownBrandFallbackQuote: null };
  }

  const alternatives = await searchSupervaluCatalogLiveInternal(productOnly, options);
  if (alternatives.length === 0) {
    return { matches: [], ownBrandFallbackQuote: null };
  }

  return {
    matches: [],
    ownBrandFallbackQuote: formatOwnBrandFallbackQuote(productOnly, alternatives),
  };
}

export async function searchSupervaluCatalogLive(
  query: string,
  options?: {
    storeId?: string;
    intent?: CatalogQuoteIntent;
    supabase?: SupabaseClient;
    retailBanner?: string;
    fulfilment?: SupervaluFulfilment | null;
    serviceArea?: SupervaluServiceArea | null;
    reference?: Date;
  },
): Promise<SupervaluCatalogMatch[]> {
  const result = await searchSupervaluCatalogLiveWithFallback(query, options);
  return result.matches;
}
