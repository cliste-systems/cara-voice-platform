// @ts-nocheck -- generated source is checked by the app build and catalogue tests.
// Generated from cara-platform by scripts/sync-catalogue-runtime.py. Do not edit.
import {
  catalogProductTokens,
  stripCatalogPackagingNoise,
  stripCatalogSearchBoilerplate,
} from "./supervalu-catalog-search.js";
import {
  inferWeeklyOffersListIntent,
  inferWeeklyOfferFulfilmentFromQuery,
  offerSearchProductTokens,
  tokenizeSupervaluSearchQuery,
} from "./retail-weekly-offers-search.js";
import { retailSearchTokenMatchesText } from "./retail-search-fuzzy.js";
import type { SupervaluFulfilment } from "./supervalu-offers-types.js";
import { queryRequestsLowestPrice, type RetailPriceBasis } from "./retail-price-comparison.js";
import { matchesBurgerProductContext } from "./retail-product-context.js";

export type ClarificationMatch = {
  productName?: string;
  product_name?: string;
  department?: string | null;
  service_area?: string | null;
  serviceArea?: string | null;
  fulfilment?: string | null;
  current_price_eur?: number | null;
  is_on_offer?: boolean;
  score?: number | null;
  price_basis?: RetailPriceBasis;
};

export type ProductClarificationKind = "fulfilment" | "refinement";

const COUNTER_PREPACK_AREA_HINTS: Record<string, string> = {
  butcher:
    "fresh at the butcher counter, priced per kilo, or the pre-pack packs in the meat aisle",
  fish: "fresh at the fish counter, or the pre-pack packs in the fish aisle",
  deli: "fresh sliced at the deli counter, or the chilled pre-pack packs",
};

/** Caller named a category, not a specific brand/type/size. */
export function isBroadProductQuery(query: string): boolean {
  const trimmed = query.trim();
  if (!trimmed) return false;
  if (inferWeeklyOffersListIntent(trimmed)) return true;

  const core =
    stripCatalogPackagingNoise(stripCatalogSearchBoilerplate(trimmed)) || trimmed;
  const tokens = tokenizeSupervaluSearchQuery(core);
  return tokens.length > 0 && tokens.length <= 2;
}

function shortProductLabel(productName: string): string {
  return productName
    .replace(/\([^)]*\)\s*$/, "")
    .replace(/\s{2,}/g, " ")
    .trim()
    .split(/\s+/)
    .slice(0, 5)
    .join(" ");
}

function distinctProductLabels(matches: ClarificationMatch[]): string[] {
  const seen = new Set<string>();
  const labels: string[] = [];
  for (const match of matches) {
    const name = String(match.productName ?? match.product_name ?? "").trim();
    if (!name) continue;
    const label = shortProductLabel(name);
    const key = label.toLowerCase();
    if (!label || seen.has(key)) continue;
    seen.add(key);
    labels.push(label);
  }
  return labels;
}

function matchFulfilment(match: ClarificationMatch): string {
  return String(match.fulfilment ?? "").trim().toLowerCase();
}

function matchServiceArea(match: ClarificationMatch): string {
  return String(match.serviceArea ?? match.service_area ?? "")
    .trim()
    .toLowerCase();
}

function matchProductName(match: ClarificationMatch): string {
  return String(match.productName ?? match.product_name ?? "").trim();
}

function queryRequestsFresh(query: string): boolean {
  return /\b(?:fresh|loose|whole|produce|fruit|veg|vegetable)\b/i.test(query);
}

function queryRequestsOwnBrand(query: string): boolean {
  return /\b(?:supervalu|own\s*brand|own[- ]label|store\s*brand|shops?\s*own)\b/i.test(
    query,
  );
}

const INGREDIENT_FORM_WORDS = new Set([
  "oil",
  "butter",
  "sauce",
  "dressing",
  "spread",
  "dip",
  "smashed",
  "crushed",
  "flavoured",
  "flavored",
  "seasoning",
  "marinade",
  "paste",
  "powder",
  "dinner",
  "dinners",
  "meal",
  "meals",
  "bun",
  "buns",
  "relish",
  "kit",
  "mayonnaise",
  "mayo",
  "ketchup",
  "cheese",
  "mix",
]);

const SEARCH_PREFERENCE_TOKENS = new Set([
  "fresh",
  "loose",
  "whole",
  "supervalu",
  "brand",
  "own",
  "cheapest",
  "cheap",
  "lowest",
  "price",
  "value",
  "budget",
]);

function literalProductTokens(query: string): string[] {
  return offerSearchProductTokens(query).filter(
    (token) => !SEARCH_PREFERENCE_TOKENS.has(token),
  );
}

function normalizedWords(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function productFormScore(query: string, match: ClarificationMatch): number {
  const productTokens = literalProductTokens(query);
  if (productTokens.length === 0) return 0;

  const nameWords = normalizedWords(matchProductName(match));
  const departmentWords = normalizedWords(String(match.department ?? ""));
  let score = 0;

  for (const token of productTokens) {
    const stem = token.replace(/s$/, "");
    const nameIndex = nameWords.findIndex(
      (word) =>
        word === token ||
        word === stem ||
        retailSearchTokenMatchesText(word, token),
    );
    if (nameIndex >= 0) {
      score += 4;
      const next = nameWords[nameIndex + 1] ?? "";
      if (INGREDIENT_FORM_WORDS.has(next) && !normalizedWords(query).includes(next)) score -= 3;
      continue;
    }

    if (
      departmentWords.some(
        (word) =>
          word === token ||
          word === stem ||
          retailSearchTokenMatchesText(word, token),
      )
    ) {
      score += 2;
    }
  }

  const requestedForm = productTokens.at(-1);
  if (requestedForm && INGREDIENT_FORM_WORDS.has(requestedForm) && productTokens.length > 1) {
    // "Burger sauce" is the sauce itself, not a prepared burger served with sauce.
    const phrase = productTokens.map((token) => token.replace(/s$/, "")).join(" ");
    if (nameWords.map((word) => word.replace(/s$/, "")).join(" ").includes(phrase)) score += 2;
  }

  if (queryRequestsFresh(query)) {
    const text = `${matchProductName(match)} ${match.department ?? ""} ${matchServiceArea(match)}`.toLowerCase();
    if (/\b(?:fresh|loose|whole|produce|fruit|veg|vegetable)\b/.test(text)) {
      score += 3;
    }
    if (nameWords.some((word) => INGREDIENT_FORM_WORDS.has(word))) {
      score -= 3;
    }
  }

  if (queryRequestsOwnBrand(query)) {
    if (/^supervalu\b/i.test(matchProductName(match))) score += 3;
    else score -= 1;
  }

  return score;
}

function isUnrequestedProductForm(query: string, match: ClarificationMatch): boolean {
  const requestedWords = normalizedWords(query);
  const nameWords = normalizedWords(matchProductName(match));
  if (/\bburgers?\b/i.test(query) && !/\b(?:snacks?|crisps|bites)\b/i.test(query) &&
      /\b(?:snacks?|crisps)\b/i.test(`${matchProductName(match)} ${match.department ?? ""}`)) return true;
  return literalProductTokens(query).some((token) => {
    const index = nameWords.findIndex((word) => retailSearchTokenMatchesText(word, token));
    const form = nameWords[index + 1];
    return index >= 0 && form != null && INGREDIENT_FORM_WORDS.has(form) && !requestedWords.includes(form);
  });
}

function fulfilmentClarificationAreaHint(serviceArea: string): string | null {
  return COUNTER_PREPACK_AREA_HINTS[serviceArea] ?? null;
}

function queryMatchesDepartmentScope(
  query: string,
  matches: ClarificationMatch[],
): boolean {
  const tokens = offerSearchProductTokens(query);
  if (tokens.length === 0 || tokens.length > 3 || matches.length < 2) return false;
  return (
    matches.filter((match) => {
      const department = String(match.department ?? "");
      return tokens.every((token) =>
        retailSearchTokenMatchesText(department, token),
      );
    }).length >= 2
  );
}

function narrowMatchesByProductTokens<T extends ClarificationMatch>(
  query: string,
  matches: T[],
): T[] {
  if (inferWeeklyOffersListIntent(query)) return matches;

  const productTokens = literalProductTokens(query);
  if (productTokens.length === 0 || matches.length <= 1) return matches;

  const byProductName = matches.filter((match) => {
    const name = String(match.productName ?? match.product_name ?? "");
    if (productTokens.length >= 2) {
      return productTokens.every((token) => retailSearchTokenMatchesText(name, token));
    }
    return productTokens.some((token) => retailSearchTokenMatchesText(name, token));
  });
  return byProductName;
}

/** Narrow to counter or pre-pack only when the tool was called with an explicit fulfilment choice. */
export function filterOfferMatchesByExplicitFulfilment<T extends ClarificationMatch>(
  matches: T[],
  explicitFulfilment?: SupervaluFulfilment | null,
): T[] {
  if (!explicitFulfilment) return matches;
  const narrowed = matches.filter(
    (match) => matchFulfilment(match) === explicitFulfilment,
  );
  return narrowed;
}

/** @deprecated Use filterOfferMatchesByExplicitFulfilment — query text is not used for fulfilment. */
export function filterOfferMatchesByInferredFulfilment<T extends ClarificationMatch>(
  _query: string,
  matches: T[],
  explicitFulfilment?: SupervaluFulfilment | null,
): T[] {
  return filterOfferMatchesByExplicitFulfilment(matches, explicitFulfilment);
}

/** Counter vs pre-pack weekly offers both match — ask which before quoting. */
export function buildOfferFulfilmentClarificationHint(
  matches: ClarificationMatch[],
  explicitFulfilment?: SupervaluFulfilment | null,
): string | null {
  if (explicitFulfilment) return null;
  if (matches.length < 2) return null;

  const areas = new Set(
    matches.map((match) => matchServiceArea(match)).filter(Boolean),
  );
  if (areas.size !== 1) return null;

  const fulfilments = new Set(matches.map((match) => matchFulfilment(match)).filter(Boolean));
  if (!fulfilments.has("counter") || !fulfilments.has("prepack")) return null;

  const serviceArea = [...areas][0] ?? "";
  const areaHint = fulfilmentClarificationAreaHint(serviceArea);
  if (!areaHint) return null;

  return (
    "Both fresh counter and pre-pack options are on offer this week — ask ONE short clarifying question, for example: " +
    `"Do you mean ${areaHint}?" Do NOT quote any prices or product names until they choose. Then call the tool again with fulfilment set to counter or prepack.`
  );
}

/** When several types/brands match a broad query, Cara should ask one clarifying question first. */
export function buildBroadProductClarificationHint(
  query: string,
  matches: ClarificationMatch[],
  options?: { allowDepartmentBrowse?: boolean },
): string | null {
  if (inferWeeklyOffersListIntent(query)) return null;
  if (!isBroadProductQuery(query)) return null;
  if (matches.length < 2) return null;

  // If the caller's words match the returned department/category itself,
  // this is a browse request ("cereals", "yogurts", "crisps"), not an
  // ambiguous individual product. Return the category offers directly.
  if (options?.allowDepartmentBrowse !== false && queryMatchesDepartmentScope(query, matches)) {
    return null;
  }

  const labels = distinctProductLabels(matches);
  if (labels.length < 2) return null;

  const productTokens = catalogProductTokens(query);
  if (productTokens.length > 0) {
    const relevant = matches.filter((match) => {
      const name = String(match.productName ?? match.product_name ?? "").toLowerCase();
      return productTokens.some((token) => {
        const stem = token.replace(/s$/, "");
        return name.includes(stem);
      });
    });
    if (relevant.length < 2) return null;
  }

  const examples = labels.slice(0, 4).join("; ");
  return (
    "Several types or brands match — ask ONE short clarifying question: which type or brand they mean " +
    `(for example: ${examples}). Do not quote a specific price until they narrow it down.`
  );
}

export function buildProductClarificationHint(
  query: string,
  matches: ClarificationMatch[],
  explicitFulfilment?: SupervaluFulfilment | null,
): string | null {
  const narrowed = filterOfferMatchesByExplicitFulfilment(matches, explicitFulfilment ?? inferWeeklyOfferFulfilmentFromQuery(query));
  if (inferWeeklyOffersListIntent(query)) return null;
  return (
    buildOfferFulfilmentClarificationHint(narrowed, explicitFulfilment) ??
    buildBroadProductClarificationHint(query, narrowed)
  );
}

export function resolveProductSearchResponse<T extends ClarificationMatch>(
  query: string,
  matches: T[],
  options?: {
    fulfilment?: SupervaluFulfilment | null;
    intent?: "offer" | "price" | "stock";
  },
): {
  matches: T[];
  clarificationHint: string | null;
  clarificationKind: ProductClarificationKind | null;
  comparisonNote?: string;
} {
  const wantsCheapest = queryRequestsLowestPrice(query);
  let narrowed = filterOfferMatchesByExplicitFulfilment(
    matches,
    options?.fulfilment ?? inferWeeklyOfferFulfilmentFromQuery(query),
  );
  narrowed = narrowed.filter((match) => matchesBurgerProductContext(query, matchProductName(match), String(match.department ?? "")));

  // Offer browsing is answerable now: return labelled products and prices
  // across counter/pre-pack instead of making the caller narrow first.
  // Explicit counter or aisle wording remains a hard constraint above.
  if (!wantsCheapest && (options?.intent === "offer" || inferWeeklyOffersListIntent(query))) {
    return { matches: narrowed, clarificationHint: null, clarificationKind: null };
  }

  if (wantsCheapest) {
    narrowed = narrowed.filter((match) => !isUnrequestedProductForm(query, match));
  }

  // Rank the caller's intended product form before choosing a price. This keeps
  // "fresh SuperValu avocado" on actual avocados instead of cheaper avocado oil,
  // sauces or other ingredient-form matches.
  if (narrowed.length > 1) {
    const scored = narrowed.map((match) => ({
      match,
      formScore: productFormScore(query, match),
    }));
    const bestFormScore = Math.max(...scored.map((entry) => entry.formScore));
    if (bestFormScore >= 3) {
      narrowed = scored
        .filter((entry) => entry.formScore >= bestFormScore - 1)
        .map((entry) => entry.match);
    }
  }

  if (!queryMatchesDepartmentScope(query, narrowed)) {
    narrowed = narrowMatchesByProductTokens(query, narrowed);
  }

  if (wantsCheapest) {
    const priced = narrowed
      .map((match, index) => ({
        match,
        index,
        price: Number(match.current_price_eur),
        sourceScore: Number(match.score ?? 0),
      }))
      .filter((entry) => Number.isFinite(entry.price) && entry.price > 0)
      .sort(
        (a, b) =>
          a.price - b.price ||
          b.sourceScore - a.sourceScore ||
          a.index - b.index,
      );
    const lowestByBasis = new Map<RetailPriceBasis, T>();
    for (const entry of priced) {
      const basis = entry.match.price_basis ?? (matchFulfilment(entry.match) === "counter" ? "counter_unknown" : "pack");
      if (basis !== "counter_unknown" && !lowestByBasis.has(basis)) lowestByBasis.set(basis, entry.match);
    }
    // A counter amount without a verified selling unit cannot be ranked against
    // pack totals or per-kilo rates. Keep one option as unranked context only.
    const unrankedCounter = narrowed.find((match) =>
      (match.price_basis ?? (matchFulfilment(match) === "counter" ? "counter_unknown" : "pack")) === "counter_unknown",
    );
    const unpricedOption = narrowed.find((match) =>
      match !== unrankedCounter && !(Number(match.current_price_eur) > 0) &&
      (priced.length === 0 || match.is_on_offer === true),
    );
    narrowed = [...lowestByBasis.values(), ...(unrankedCounter ? [unrankedCounter] : []), ...(unpricedOption ? [unpricedOption] : [])];
    return {
      matches: narrowed,
      clarificationHint: null,
      clarificationKind: null,
      comparisonNote: "Compare only the matching listed prices checked: pack/item totals and per-kilo counter rates are separate comparisons, not an absolute cheapest product or best value per kilo. Pack sizes can differ. State the product form: prepared single-serve burgers are not equivalent to burgers for cooking. Options without a verified single price, or counter prices with an unconfirmed selling unit, are unranked and need confirmation. Keep all Rewards membership, multibuy quantity and availability conditions in the answer.",
    };
  }
  const fulfilmentHint = buildOfferFulfilmentClarificationHint(
    narrowed,
    options?.fulfilment,
  );
  const refinementHint = buildBroadProductClarificationHint(query, narrowed, {
    allowDepartmentBrowse: options?.intent !== "price",
  });
  const clarificationHint = fulfilmentHint ?? refinementHint;
  const clarificationKind: ProductClarificationKind | null = fulfilmentHint
    ? "fulfilment"
    : refinementHint
      ? "refinement"
      : null;
  return {
    clarificationHint,
    clarificationKind,
    matches: narrowed,
  };
}
