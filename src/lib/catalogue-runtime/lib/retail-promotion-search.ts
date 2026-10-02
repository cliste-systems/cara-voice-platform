// @ts-nocheck -- generated source is checked by the app build and catalogue tests.
// Generated from cara-platform by scripts/sync-catalogue-runtime.py. Do not edit.
import { isRetailOfferObservationFresh } from "./retail-offer-freshness.js";
import { parseRetailMultibuyLabel } from "./retail-price-presentation.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { formatInTimeZone } from "date-fns-tz";

import {
  offerSearchProductIdentityTokens,
  resolveWeeklyOfferSearchFilters,
} from "./retail-weekly-offers-search.js";
import type {
  RetailWeeklyOfferRow,
  SupervaluFulfilment,
  SupervaluServiceArea,
} from "./supervalu-offers-types.js";
import {
  formatSpokenDiscountLabel,
  formatSpokenEurAmount,
} from "./spoken-eur-price.js";
import type { SupervaluCatalogMatch } from "./supervalu-catalog-search.js";

const DUBLIN = "Europe/Dublin";
export const RETAIL_PROMOTION_LIST_MAX_RESULTS = 16;

const NUMBER_WORDS: Record<string, string> = {
  one: "1",
  two: "2",
  three: "3",
  four: "4",
  five: "5",
  six: "6",
  seven: "7",
  eight: "8",
  nine: "9",
  ten: "10",
  eleven: "11",
  twelve: "12",
  thirteen: "13",
  fourteen: "14",
  fifteen: "15",
  sixteen: "16",
  seventeen: "17",
  eighteen: "18",
  nineteen: "19",
};

const NUMBER_TENS: Record<string, number> = {
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};

const PROMOTION_NOISE = new Set([
  "offer",
  "offers",
  "deal",
  "deals",
  "special",
  "specials",
  "promotion",
  "promotions",
  "promo",
  "promos",
  "week",
  "weekly",
  "today",
  "this",
  "what",
  "which",
  "whats",
  "what's",
  "any",
  "list",
  "show",
  "tell",
  "me",
  "the",
  "are",
  "is",
  "do",
  "you",
  "have",
  "on",
  "in",
  "for",
  "price",
  "prices",
  "rewards",
  "reward",
  "real",
  "members",
  "member",
  "only",
  "save",
  "saving",
  "off",
  "half",
  "buy",
  "mix",
  "match",
  "bundle",
  "value",
  "multibuy",
  "multibuys",
  "across", "different", "department", "departments", "example", "examples", "few", "including",
  "multi",
  "buys",
  "earn",
  "collect",
  "extra",
  "bonus",
  "points",
  "point",
]);

const AREA_NOISE = new Set([
  "fruit",
  "veg",
  "vegetable",
  "vegetables",
  "produce",
  "butcher",
  "butchers",
  "meat",
  "fish",
  "seafood",
  "deli",
  "bakery",
  "grocery",
  "dairy",
  "ambient",
  "provisions",
  "frozen",
  "household",
  "wine",
  "beer",
  "spirits",
  "alcohol",
  "counter",
  "prepack",
  "packaged",
  "aisle",
]);

export type RetailPromotionMechanic =
  | "multibuy"
  | "loyalty"
  | "half_price"
  | "save_percent"
  | "save_amount"
  | "fixed_price"
  | "named"
  | "unstructured";

export type ParsedRetailPromotionQuery = {
  mechanic: RetailPromotionMechanic;
  quantity: number | null;
  totalEur: number | null;
  percent: number | null;
  amountEur: number | null;
  loyaltyRequired: boolean;
  namedPhrase: string | null;
  serviceArea: SupervaluServiceArea | null;
  fulfilment: SupervaluFulfilment | null;
  subjectTokens: string[];
};

function numberValue(value: number | string | null | undefined): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeNumberWords(value: string): string {
  let out = value.toLowerCase();

  // Convert compound spoken numbers before single words: "twenty five" -> 25.
  for (const [tensWord, tensValue] of Object.entries(NUMBER_TENS)) {
    for (const [onesWord, onesValue] of Object.entries(NUMBER_WORDS)) {
      const ones = Number(onesValue);
      if (ones < 1 || ones > 9) continue;
      out = out.replace(
        new RegExp(`\\b${tensWord}[ -]${onesWord}\\b`, "gi"),
        String(tensValue + ones),
      );
    }
    out = out.replace(
      new RegExp(`\\b${tensWord}\\b`, "gi"),
      String(tensValue),
    );
  }

  for (const [word, digit] of Object.entries(NUMBER_WORDS)) {
    out = out.replace(new RegExp(`\\b${word}\\b`, "gi"), digit);
  }

  // Natural Irish/UK retail phrasing should resolve to the same mechanic as
  // badge syntax. Keep these as lexical normalisation, not query-specific
  // business rules, so the promotion engine remains generic.
  out = out
    .replace(/\b(?:a\s+)?tenner\b/gi, "€10")
    .replace(/\b(?:a\s+)?fiver\b/gi, "€5")
    .replace(
      /\b([0-9]+)\s+euros?\s+([0-9]{1,2})(?:\s+cents?)?\b/gi,
      "€$1.$2",
    )
    .replace(/\b([0-9]+(?:[.,][0-9]{1,2})?)\s+quid\b/gi, "€$1")
    .replace(/\b([0-9]+(?:[.,][0-9]{1,2})?)\s+euros?\b/gi, "€$1")
    .replace(/\b([0-9]{1,2})\s+cents?\b/gi, "$1c")
    .replace(/\bpercent\b/gi, "%")
    .replace(/\s+/g, " ")
    .trim();

  return out;
}

function parseMoney(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function parseMoneyExpression(value: string): number | null {
  const euro = value.match(/€\s*([0-9]+(?:[.,][0-9]{1,2})?)/i);
  if (euro) return parseMoney(euro[1]);
  const cents = value.match(/\b([0-9]{1,2})\s*c\b/i);
  if (cents) {
    const amount = Number(cents[1]) / 100;
    return Number.isFinite(amount) ? amount : null;
  }
  const bare = value.match(/\b([0-9]+(?:[.,][0-9]{1,2})?)\b/);
  return bare ? parseMoney(bare[1]) : null;
}

function promotionScopeText(query: string): string {
  return normalizeNumberWords(query)
    .replace(/(?:buy\s+)?\d+\s+for\s+(?:€\s*)?\d+(?:[.,]\d{1,2})?(?:\s*euro)?/gi, " ")
    .replace(/save\s+(?:(?:€\s*)?\d+(?:[.,]\d{1,2})?|\d{1,2}\s*c)/gi, " ")
    .replace(/save\s+\d+(?:[.,]\d+)?\s*%/gi, " ")
    .replace(/\d+(?:[.,]\d+)?\s*%\s*off/gi, " ")
    .replace(/only\s+(?:(?:€\s*)?\d+(?:[.,]\d{1,2})?|\d{1,2}\s*c)/gi, " ")
    .replace(/half[ -]+price/gi, " ")
    .replace(/super\s*7(?:[’']?s)?/gi, " ")
    .replace(/super[ -]*fresh[ -]*(?:5|five)|super[ -]*stars?/gi, " ")
    .replace(/mix\s*(?:&|and)\s*match/gi, " ")
    .replace(/\b(?:bogof|bogo)\b|\bbuy[ -]+\d+[ -]+(?:and[ -]+)?get[ -]+\d+[ -]+(?:free|half[ -]+price|\d+\s*%[ -]*off)/gi, " ")
    .replace(/\breal\s+rewards?\b|\brewards?\s+(?:price|offers?|deals?)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function promotionSubjectTokens(
  scopeText: string,
  serviceArea: SupervaluServiceArea | null,
): string[] {
  const tokens = offerSearchProductIdentityTokens(scopeText).filter(
    (token) =>
      !/^\d+(?:\.\d+)?$/.test(token) &&
      !PROMOTION_NOISE.has(token),
  );

  // If the scope has already been captured structurally (fruit & veg ->
  // produce, wine -> off-licence), do not also require every product name to
  // contain those area words. For product phrases such as "wine gums" or
  // "fish fingers", no area is inferred, so the complete product identity is
  // preserved here.
  return serviceArea
    ? tokens.filter((token) => !AREA_NOISE.has(token))
    : tokens;
}

export function parseRetailPromotionQuery(
  query: string,
): ParsedRetailPromotionQuery {
  const normalized = normalizeNumberWords(query);
  const scopeText = promotionScopeText(query);
  const filters = resolveWeeklyOfferSearchFilters(scopeText);

  const multibuy = normalized.match(
    /(?:buy\s+)?(\d+)\s+for\s+(?:€\s*)?(\d+(?:[.,]\d{1,2})?)(?:\s*euro)?\b/i,
  );
  const loyaltyRequired =
    /\breal\s+rewards?\b|\bwith\s+(?:real\s+)?rewards?\b|\brewards?\s+(?:price|offer|deal)s?\b|\bmembers?\s+(?:price|offer|deal)s?\b/i.test(
      normalized,
    );
  const halfPrice = /\bhalf[ -]+price\b|\b50\s*%\s*off\b/i.test(normalized);
  const savePercent = normalized.match(
    /\bsave\s+(\d+(?:[.,]\d+)?)\s*%|(\d+(?:[.,]\d+)?)\s*%\s*(?:off|discount)\b/i,
  );
  const saveAmount = normalized.match(
    /\bsave\s+((?:€\s*)?\d+(?:[.,]\d{1,2})?|\d{1,2}\s*c)\b/i,
  );
  const fixedPrice = !multibuy
    ? normalized.match(
        /\bonly\s+((?:€\s*)?\d+(?:[.,]\d{1,2})?|\d{1,2}\s*c)\b/i,
      )
    : null;
  const loyaltyPriceAmount = normalized.match(
    /\brewards?\s+price(?:\s+only)?(?:\s+of)?\s+((?:€\s*)?\d+(?:[.,]\d{1,2})?|\d{1,2}\s*c)\b/i,
  );
  const mixMatch = /\bmix\s*(?:&|and)\s*match\b/i.test(normalized);
  const namedPhrase = /\bpoints?\b/i.test(normalized)
    ? "points"
    : /\bsuper[ -]*(?:fresh[ -]*(?:5|five)|stars?)\b/i.test(normalized)
      ? "super fresh 5"
      : /\bsuper\s*7(?:[’']?s)?\b/i.test(normalized)
    ? "super 7"
    : /\bbundle\s+offer\b/i.test(normalized)
      ? "bundle offer"
      : /\bbest\s+value\b/i.test(normalized)
        ? "best value"
        : /\bgreat\s+value\b/i.test(normalized)
          ? "great value"
          : null;

  let mechanic: RetailPromotionMechanic = "unstructured";
  if (multibuy || mixMatch || parseRetailMultibuyLabel(normalized)) mechanic = "multibuy";
  else if (halfPrice) mechanic = "half_price";
  else if (savePercent) mechanic = "save_percent";
  else if (saveAmount) mechanic = "save_amount";
  else if (fixedPrice) mechanic = "fixed_price";
  else if (namedPhrase === "points") mechanic = "named";
  else if (loyaltyRequired) mechanic = "loyalty";
  else if (namedPhrase) mechanic = "named";

  return {
    mechanic,
    quantity: multibuy ? Number(multibuy[1]) : null,
    totalEur: multibuy ? parseMoney(multibuy[2]) : null,
    percent: savePercent ? parseMoney(savePercent[1] ?? savePercent[2]) : halfPrice ? 50 : null,
    amountEur: saveAmount
      ? parseMoneyExpression(saveAmount[1])
      : fixedPrice
        ? parseMoneyExpression(fixedPrice[1])
        : loyaltyPriceAmount
          ? parseMoneyExpression(loyaltyPriceAmount[1])
          : null,
    loyaltyRequired,
    namedPhrase,
    serviceArea: filters.serviceArea ?? null,
    fulfilment: filters.fulfilment ?? null,
    subjectTokens: promotionSubjectTokens(scopeText, filters.serviceArea ?? null),
  };
}

export function shouldUseStructuredPromotionSearch(query: string): boolean {
  return parseRetailPromotionQuery(query).mechanic !== "unstructured";
}

/** Apply the same mechanic to synced offers; a campaign query must never
 * fall through to unrelated generic offers when that campaign is absent. */
export function filterWeeklyOffersByPromotionQuery<T extends Pick<RetailWeeklyOfferRow, "product_name" | "department" | "discount_label" | "current_price_eur"> & Partial<Pick<RetailWeeklyOfferRow, "category_breadcrumb" | "source_url" | "campaign_names">>>(
  rows: T[],
  query: string,
): T[] {
  const wanted = parseRetailPromotionQuery(query);
  if (wanted.mechanic === "unstructured") return rows;
  const close = (a: number | null, b: number | null) => b == null || (a != null && Math.abs(a - b) <= 0.02);
  return rows.filter((row) => {
    const label = String(row.discount_label ?? "");
    const observed = parseRetailPromotionQuery(label);
    if (wanted.loyaltyRequired && !observed.loyaltyRequired) return false;
    const subject = `${row.product_name} ${row.department}`.toLowerCase();
    if (!wanted.subjectTokens.every((token) => subject.includes(token.replace(/s$/, "")))) return false;
    switch (wanted.mechanic) {
      case "multibuy": {
        const wantedBundle = parseRetailMultibuyLabel(query);
        const observedBundle = parseRetailMultibuyLabel(label);
        if (!observedBundle || observed.mechanic !== "multibuy") return false;
        if (wantedBundle?.kind === "buy_get" && (
          observedBundle.kind !== "buy_get" ||
          observedBundle.buyQuantity !== wantedBundle.buyQuantity ||
          observedBundle.getQuantity !== wantedBundle.getQuantity ||
          observedBundle.benefit !== wantedBundle.benefit
        )) return false;
        if (wantedBundle?.mixMatch && !observedBundle.mixMatch) return false;
        return close(observed.quantity, wanted.quantity) && close(observed.totalEur, wanted.totalEur);
      }
      case "loyalty":
        return observed.loyaltyRequired && close(Number(row.current_price_eur), wanted.amountEur);
      case "half_price":
        return observed.mechanic === "half_price" || observed.percent === 50;
      case "save_percent":
        return close(observed.percent, wanted.percent) && observed.percent != null;
      case "save_amount":
        return observed.mechanic === "save_amount" && close(observed.amountEur, wanted.amountEur);
      case "fixed_price":
        return observed.mechanic === "fixed_price" && close(Number(row.current_price_eur), wanted.amountEur);
      case "named": {
        const evidence = normalizeNumberWords(`${label} ${row.category_breadcrumb ?? ""} ${row.source_url ?? ""} ${(row.campaign_names ?? []).join(" ")}`).replace(/super\s*7/g, "super 7").replace(/[^a-z0-9]+/g, " ");
        if (wanted.namedPhrase === "super fresh 5") {
          // The Super Stars landing page contains several independent widgets.
          // Caller aliases do not make every SKU on that page a Fresh 5 member.
          // Explicit membership wins; only a real Fresh 5 promotion label is
          // accepted when structured campaign membership is unavailable.
          const membership = row.campaign_names == null ? null : row.campaign_names.join(" ").trim();
          const campaignEvidence = normalizeNumberWords(membership ?? label).replace(/[^a-z0-9]+/g, " ");
          return /\bsuper\s*fresh\s*(?:5|five)\b/.test(campaignEvidence);
        }
        if (wanted.namedPhrase === "points") {
          const wantedPoints = normalizeNumberWords(query).match(/\b(\d+)\s+(?:(?:extra|bonus)\s+)?points?\b/);
          if (wantedPoints && !new RegExp(`\\b${wantedPoints[1]}\\s+(?:(?:extra|bonus)\\s+)?points?\\b`).test(evidence)) return false;
        }
        return wanted.namedPhrase != null && evidence.includes(wanted.namedPhrase);
      }
      default:
        return true;
    }
  });
}

function parseLabelMultibuy(
  label: string,
): { quantity: number; totalEur: number } | null {
  const normalized = normalizeNumberWords(label);
  const match = normalized.match(
    /(?:buy\s+)?(\d+)\s+for\s+(?:€\s*)?(\d+(?:[.,]\d{1,2})?)(?:\s*euro)?\b/i,
  );
  if (!match) return null;
  const totalEur = parseMoney(match[2]);
  if (totalEur == null) return null;
  return { quantity: Number(match[1]), totalEur };
}

function formatPromotionQuote(input: {
  productName: string;
  label: string | null;
  promotionType: string;
  loyaltyRequired: boolean;
  offerPriceEur: number | null;
  regularPriceEur: number | null;
  displayPriceEur: number | null;
  pricePerUnit: string | null;
}): string {
  const spokenLabel = formatSpokenDiscountLabel(input.label);
  const parts: string[] = [input.productName];

  if (spokenLabel) {
    const alreadyRewards = /rewards?/i.test(spokenLabel);
    parts.push(
      input.loyaltyRequired && !alreadyRewards
        ? `With Real Rewards, ${spokenLabel}`
        : spokenLabel,
    );
  } else if (input.loyaltyRequired && input.offerPriceEur != null) {
    parts.push(
      `With Real Rewards, ${formatSpokenEurAmount(input.offerPriceEur)}`,
    );
  } else if (input.offerPriceEur != null) {
    parts.push(formatSpokenEurAmount(input.offerPriceEur));
  }

  const multibuy =
    input.promotionType === "multibuy" ||
    Boolean(input.label && parseLabelMultibuy(input.label));
  if (multibuy) {
    // The bundle total is the verified mechanic. Individual shelf prices can
    // vary by storefront, so do not turn them into part of the quoted deal.
  } else {
    if (
      input.offerPriceEur != null &&
      input.regularPriceEur != null &&
      input.regularPriceEur > input.offerPriceEur
    ) {
      parts.push(`usually ${formatSpokenEurAmount(input.regularPriceEur)}`);
    }
    if (input.pricePerUnit?.trim()) {
      parts.push(input.pricePerUnit.trim());
    }
  }

  return parts.join(". ") + ".";
}

export async function searchStructuredNationalPromotions(
  supabase: SupabaseClient,
  input: {
    retailBanner: string;
    query: string;
    limit?: number;
    fulfilment?: SupervaluFulfilment | null;
    serviceArea?: SupervaluServiceArea | null;
    reference?: Date;
    signal?: AbortSignal;
  },
): Promise<SupervaluCatalogMatch[]> {
  const parsed = parseRetailPromotionQuery(input.query);
  if (parsed.mechanic === "unstructured") return [];
  const reference = input.reference ?? new Date();
  const today = formatInTimeZone(reference, DUBLIN, "yyyy-MM-dd");

  const request = supabase.rpc(
    "search_retail_promotions_consensus",
    {
      p_retail_banner: input.retailBanner,
      p_mechanic: parsed.mechanic,
      p_loyalty_required: parsed.loyaltyRequired,
      p_quantity: parsed.quantity,
      p_total_eur: parsed.totalEur,
      p_percent: parsed.percent,
      p_amount_eur: parsed.amountEur,
      // SQL must select the actual campaign before applying its result limit.
      // Caller aliases have already resolved to the canonical membership name.
      p_named_phrase: parsed.namedPhrase,
      p_service_area: input.serviceArea ?? parsed.serviceArea,
      p_fulfilment: input.fulfilment ?? parsed.fulfilment,
      p_subject_tokens: parsed.subjectTokens,
      p_reference_date: today,
      p_limit: Math.max(
        1,
        Math.min(
          input.limit ?? RETAIL_PROMOTION_LIST_MAX_RESULTS,
          RETAIL_PROMOTION_LIST_MAX_RESULTS,
        ),
      ),
    },
  );
  const { data, error } = await (input.signal ? request.abortSignal(input.signal) : request);

  if (error) {
    throw new Error(error.message);
  }

  type ConsensusRow = {
    product_name: string;
    department: string;
    sku: string | null;
    service_area: string;
    fulfilment: string;
    is_alcohol: boolean;
    promotion_type: string;
    loyalty_required: boolean;
    label: string | null;
    description: string | null;
    offer_price_eur: number | string | null;
    regular_price_eur: number | string | null;
    display_price_eur: number | string | null;
    price_per_unit: string | null;
    source_store_count: number | string;
    valid_from: string;
    valid_to: string;
    source_observed_at?: string | null;
    source_metadata?: {
      source_observed_at?: string | null;
      campaigns?: Array<string | { name?: string; source_url?: string; campaign_key?: string }>;
    } | null;
  };

  const currentRows = ((data ?? []) as ConsensusRow[]).filter((row) =>
    isRetailOfferObservationFresh(row.source_observed_at ?? row.source_metadata?.source_observed_at, reference) &&
    row.valid_from <= today && row.valid_to >= today &&
    filterWeeklyOffersByPromotionQuery([{
    product_name: row.product_name, department: row.department,
    discount_label: [row.loyalty_required ? "Real Rewards" : null, row.label, row.description].filter(Boolean).join(" "),
    campaign_names: (row.source_metadata?.campaigns ?? []).map((campaign) => typeof campaign === "string" ? campaign : `${campaign.name ?? ""} ${campaign.campaign_key ?? ""}`),
    current_price_eur: numberValue(row.offer_price_eur) ?? numberValue(row.display_price_eur),
  }], input.query).length > 0);
  return currentRows.map((row) => {
    const offerTerms = [...new Set([row.label, row.description].map((value) => value?.trim()).filter(Boolean))].join(". ") || null;
    const offerPriceEur = numberValue(row.offer_price_eur);
    const regularPriceEur = numberValue(row.regular_price_eur);
    const displayPriceEur = numberValue(row.display_price_eur);
    const stores = numberValue(row.source_store_count) ?? 3;

    return {
      productName: row.product_name,
      department: row.department,
      sku: row.sku,
      currentPriceEur:
        row.promotion_type === "multibuy"
          ? displayPriceEur ?? regularPriceEur
          : offerPriceEur ?? displayPriceEur ?? regularPriceEur,
      wasPriceEur:
        offerPriceEur != null &&
        regularPriceEur != null &&
        regularPriceEur > offerPriceEur
          ? regularPriceEur
          : null,
      discountLabel: offerTerms,
      isOnOffer: true,
      score: Math.min(1, 0.7 + stores / 100),
      quoteText: formatPromotionQuote({
        productName: row.product_name,
        label: offerTerms,
        promotionType: row.promotion_type,
        loyaltyRequired: row.loyalty_required === true,
        offerPriceEur,
        regularPriceEur,
        displayPriceEur,
        pricePerUnit: row.price_per_unit,
      }),
      serviceArea: row.service_area,
      fulfilment: row.fulfilment,
      isAlcohol: row.is_alcohol === true,
      campaignNames: (row.source_metadata?.campaigns ?? []).map((campaign) => typeof campaign === "string" ? campaign : campaign.name ?? campaign.campaign_key ?? "").filter(Boolean),
      source: "synced" as const,
    };
  });
}

export function formatStructuredPromotionNoMatchQuote(query: string): string {
  return [
    `I couldn't confirm a current national SuperValu promotion matching "${query.trim()}" from the promotion data I checked.`,
    "Do not say the promotion does not exist in this store. If the caller needs it confirmed locally, offer a team callback.",
  ].join(" ");
}
