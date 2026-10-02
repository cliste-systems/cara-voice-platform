// @ts-nocheck -- generated source is checked by the app build and catalogue tests.
// Generated from cara-platform by scripts/sync-catalogue-runtime.py. Do not edit.
import { positiveRetailQuery, matchesRetailQueryConstraints } from "./retail-query-constraints.js";
import type { SupabaseClient } from "@supabase/supabase-js";

import { offerSearchProductIdentityTokens, scoreSupervaluSearchText } from "./retail-weekly-offers-search.js";
import { retailSearchTokenMatchesText } from "./retail-search-fuzzy.js";
import { normalizeSearchText } from "./supervalu-offers-normalize.js";
import { resolveStoredRetailPrice } from "./retail-price-presentation.js";
import type { SupervaluFulfilment, SupervaluServiceArea } from "./supervalu-offers-types.js";
import {
  formatCatalogStockQuote,
  type CatalogQuoteIntent,
  type SupervaluCatalogMatch,
} from "./supervalu-catalog-search.js";

const OWN_LABEL_QUERY_TOKENS = new Set(["supervalu", "own", "brand"]);
const INGREDIENT_FORM_DEPARTMENTS = new Set([
  "spreadable butter",
  "tuna",
  "sardines, mackerel & other fish",
  "crackers & savoury biscuits",
  "cheese accompaniments",
  "cooking cheese",
  "premium italian",
]);

type CatalogRow = {
  id: string;
  sku: string;
  product_name: string;
  brand: string | null;
  department: string;
  service_area: string;
  fulfilment: string;
  is_alcohol: boolean;
  search_text: string;
  retail_store_products: Array<{
    id: string;
    regular_price_eur: number | null;
    display_price_eur: number | null;
    price_per_unit: string | null;
    source_price_label: string | null;
    is_listed: boolean;
    retail_promotions: Array<{
      promotion_type: string;
      loyalty_required: boolean;
      loyalty_program: string | null;
      offer_price_eur: number | null;
      regular_price_eur: number | null;
      label: string | null;
      valid_from: string;
      valid_to: string;
      synced_at: string | null;
    }>;
  }>;
};

function queryRequestsSupervaluBrand(query: string): boolean {
  return /\bsupervalu\b|\bsuper\s+value\b|\bown[\s-]?brand\b/i.test(query);
}

function productSearchTokens(query: string): string[] {
  return offerSearchProductIdentityTokens(positiveRetailQuery(query)).filter(
    (token) => !OWN_LABEL_QUERY_TOKENS.has(token),
  );
}

function catalogRankingBoost(input: {
  query: string;
  productName: string;
  brand?: string | null;
  department?: string | null;
}): number {
  const tokens = productSearchTokens(input.query);
  const normalizedName = normalizeSearchText(input.productName);
  const normalizedDepartment = normalizeSearchText(input.department ?? "");
  const phrase = tokens.join(" ");
  let boost = 0;
  const requestedName = normalizeSearchText(input.query.replace(/^(?:have (?:ye|you) got|how much is|(?:i['’]?m|i am) looking for)\s+/i, "")).replace(/[^a-z0-9]/g, "");
  const compactName = normalizedName.replace(/[^a-z0-9]/g, "");
  if (requestedName === compactName) boost += 1000;

  if (phrase && normalizedName.includes(phrase)) boost += 3;
  if (phrase && normalizedDepartment.includes(phrase)) boost += 4;
  if (tokens.length > 0 && tokens.every((token) => normalizedDepartment.includes(token))) {
    boost += 3;
  }
  if (tokens.length > 0 && tokens.every((token) => normalizedName.includes(token))) {
    boost += 2;
  }
  if (queryRequestsSupervaluBrand(input.query)) {
    if (
      /^supervalu$/i.test(String(input.brand ?? "")) ||
      /^\s*supervalu\b/i.test(input.productName)
    ) {
      boost += 5;
    } else {
      boost -= 4;
    }
  }
  if (INGREDIENT_FORM_DEPARTMENTS.has(normalizedDepartment) && normalizedDepartment !== phrase) {
    boost -= 3;
  }

  return boost;
}

export async function searchStoredRetailCatalog(
  supabase: SupabaseClient,
  input: {
    retailBanner: string;
    sourceStoreId: string;
    query: string;
    intent: CatalogQuoteIntent;
    fulfilment?: SupervaluFulfilment | null;
    serviceArea?: SupervaluServiceArea | null;
    limit?: number;
    reference?: Date;
  },
): Promise<SupervaluCatalogMatch[]> {
  const tokens = productSearchTokens(input.query);
  if (tokens.length === 0) return [];
  const candidates = [...tokens].sort((a, b) => b.length - a.length);
  let candidateRows: CatalogRow[] = [];
  for (const candidate of candidates) {
    const rows: CatalogRow[] = [];
    const pageSize = 500;
    for (let from = 0; ; from += pageSize) {
      let query = supabase
        .from("retail_catalog_products")
        .select(
          "id,sku,product_name,brand,department,service_area,fulfilment,is_alcohol,search_text,retail_store_products!inner(id,regular_price_eur,display_price_eur,price_per_unit,source_price_label,is_listed,retail_promotions(promotion_type,loyalty_required,loyalty_program,offer_price_eur,regular_price_eur,label,valid_from,valid_to,synced_at))",
        )
        .eq("retail_banner", input.retailBanner)
        .eq("retail_store_products.source_store_id", input.sourceStoreId)
        .eq("retail_store_products.is_listed", true)
        .ilike("search_text", `%${candidate.replace(/s$/, "")}%`)
        .order("id", { ascending: true });
      if (input.fulfilment) query = query.eq("fulfilment", input.fulfilment);
      if (input.serviceArea) query = query.eq("service_area", input.serviceArea);
      const { data, error } = await query.range(from, from + pageSize - 1);
      if (error) throw new Error(error.message);
      rows.push(...((data ?? []) as unknown as CatalogRow[]));
      if ((data ?? []).length < pageSize) break;
    }
    candidateRows = rows.filter((row) => tokens.every((token) =>
      retailSearchTokenMatchesText(`${row.product_name} ${row.department}`, token),
    ));
    if (candidateRows.length > 0) break;
  }

  return candidateRows
    .map((row) => {
      const listing = row.retail_store_products?.[0];
      if (!listing) return null;
      const price = resolveStoredRetailPrice(listing, input.reference);
      const isOnOffer = price.isOnOffer;
      const currentPrice = price.currentPriceEur;
      const regularPrice = price.regularPriceEur;
      const score = scoreSupervaluSearchText(
        normalizeSearchText(row.search_text),
        tokens,
        row.department,
      );
      const loyaltySuffix = price.loyaltyRequired
        ? ` ${price.loyaltyProgram ?? "Loyalty"} required.`
        : "";
      const quoteText =
        formatCatalogStockQuote({
          productName: row.product_name,
          department: row.department,
          currentPriceEur: currentPrice,
          wasPriceEur: isOnOffer ? regularPrice : null,
          discountLabel: price.offerLabel,
          pricePerUnit: listing.price_per_unit,
          isOnOffer,
          intent: input.intent,
        }) + loyaltySuffix;
      return {
        productName: row.product_name,
        department: row.department,
        sku: row.sku,
        currentPriceEur: currentPrice,
        wasPriceEur: isOnOffer ? regularPrice : null,
        discountLabel: price.offerLabel,
        isOnOffer,
        score,
        quoteText,
        serviceArea: row.service_area,
        fulfilment: row.fulfilment,
        priceBasis: row.fulfilment === "counter" ? "counter_unknown" as const : "pack" as const,
        isAlcohol: row.is_alcohol,
        source: "catalog" as const,
      };
    })
    .filter((v): v is NonNullable<typeof v> => v != null && v.score >= 0.5)
    .filter((v) => input.intent !== "offer" || v.isOnOffer)
    .sort((a, b) => b.score - a.score || a.productName.localeCompare(b.productName))
    .slice(0, input.limit ?? 8);
}


type NationalCatalogRow = {
  id: string;
  sku: string;
  product_name: string;
  brand: string | null;
  department: string;
  service_area: string;
  fulfilment: string;
  is_alcohol: boolean;
  search_text: string;
  national_store_count: number;
  national_regular_price_eur: number | null;
};

// Public national candidate data only; tenant/store decisions are never cached here.
const nationalCandidates = new Map<string, {at:number; rows?:NationalCatalogRow[]; refresh?:Promise<NationalCatalogRow[]>}>();
async function loadNationalCandidateRows(key:string|null,load:()=>Promise<NationalCatalogRow[]>):Promise<NationalCatalogRow[]> {
  if (!key) return load();
  let entry=nationalCandidates.get(key);
  if (!entry) {
    entry={at:0};
    if(nationalCandidates.size>=256)nationalCandidates.delete(nationalCandidates.keys().next().value!);
    nationalCandidates.set(key,entry);
  }
  const cache=entry;
  if(cache.rows && Date.now()-cache.at<60_000)return cache.rows;
  if(!cache.refresh)cache.refresh=load().then(rows=>{cache.rows=rows;cache.at=Date.now();return rows;}).finally(()=>{cache.refresh=undefined;});
  if(cache.rows && Date.now()-cache.at<300_000){void cache.refresh.catch(()=>{});return cache.rows;}
  return cache.refresh;
}

export async function searchNationalRetailCatalog(
  supabase: SupabaseClient,
  input: {
    retailBanner: string;
    query: string;
    intent: CatalogQuoteIntent;
    fulfilment?: SupervaluFulfilment | null;
    serviceArea?: SupervaluServiceArea | null;
    limit?: number;
  },
): Promise<SupervaluCatalogMatch[]> {
  if (input.intent === "offer") return [];
  const tokens = productSearchTokens(input.query);
  if (tokens.length === 0) return [];

  const productTokens = productSearchTokens(input.query);
  const nameTokens = productTokens.filter(token => !/^(?:\d+(?:[.,]\d+)?|ml|cl|l|litres?|liters?|g|kg|grams?|kilograms?)$/i.test(token));
  // Bare measurements are constraints, not names: scanning every "ml" product
  // adds thousands of irrelevant rows after a named product already failed.
  const candidateSource = nameTokens.length > 0 ? nameTokens : tokens;
  const candidateTokens = [...candidateSource]
    .map((token) => token.replace(/s$/, ""))
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);

  let candidateRows: NationalCatalogRow[] = [];
  // Fetch small waves together: absent multiword products must not serialize every token.
  // Still check every candidate before concluding no match, preserving fuzzy name recovery.
  for (let start = 0; start < candidateTokens.length; start += 3) {
    const wave = await Promise.all(candidateTokens.slice(start, start + 3).map(async (candidate) => {
    const project = (supabase as unknown as {supabaseUrl?: string}).supabaseUrl;
    const key = project ? `${project}:${input.retailBanner}:${input.serviceArea ?? "all"}:${input.fulfilment ?? "all"}:${candidate}` : null;
    const rows = await loadNationalCandidateRows(key, async () => {
      const rows: NationalCatalogRow[] = [];
    const pageSize = 500;
      for (let from = 0; ; from += pageSize) {
      let query = supabase
        .from("retail_catalog_products")
        .select(
          "id,sku,product_name,brand,department,service_area,fulfilment,is_alcohol,search_text,national_store_count,national_regular_price_eur",
        )
        .eq("retail_banner", input.retailBanner)
        .eq("is_national", true)
        .gte("national_store_count", 3)
        .ilike("search_text", `%${candidate}%`)
        .order("id", { ascending: true });
      if (input.fulfilment) query = query.eq("fulfilment", input.fulfilment);
      if (input.serviceArea) query = query.eq("service_area", input.serviceArea);
      const { data, error } = await query.range(from, from + pageSize - 1);
      if (error) throw new Error(error.message);
      rows.push(...((data ?? []) as NationalCatalogRow[]));
      if ((data ?? []).length < pageSize) break;
    }
      return rows;
    });
    const relevantRows = rows.filter((row) => {
      if (!matchesRetailQueryConstraints(input.query,row.product_name,row.department)) return false;
      const compactQuery = normalizeSearchText(input.query).replace(/[^a-z0-9]/g, "");
      const compactName = normalizeSearchText(row.product_name).replace(/[^a-z0-9]/g, "");
      if (compactName.length >= 4 && compactQuery.includes(compactName)) return true;
      if (
        queryRequestsSupervaluBrand(input.query) &&
        !(
          /^supervalu$/i.test(String(row.brand ?? "")) ||
          /^\s*supervalu\b/i.test(row.product_name)
        )
      ) {
        return false;
      }
      const text = normalizeSearchText(`${row.product_name} ${row.department}`);
      return productTokens.length === 0 || productTokens.every((token) => retailSearchTokenMatchesText(text, token));
    });
    return relevantRows;
    }));
    const firstMatch = wave.find((rows) => rows.length > 0);
    if (firstMatch) {
      candidateRows = firstMatch;
      break;
    }
  }

  const identityKey = (name: string) => normalizeSearchText(name).replace(/[^a-z0-9]/g, "");
  const identityPrices = new Map<string, Set<number | null>>();
  for (const row of candidateRows) {
    const key = identityKey(row.product_name);
    const prices = identityPrices.get(key) ?? new Set<number | null>();
    prices.add(row.national_regular_price_eur); identityPrices.set(key, prices);
  }

  return candidateRows
    .map((row) => {
      const score = scoreSupervaluSearchText(
        normalizeSearchText(row.search_text),
        tokens,
        row.department,
      ) + (normalizeSearchText(input.query).replace(/[^a-z0-9]/g, "").includes(normalizeSearchText(row.product_name).replace(/[^a-z0-9]/g, "")) ? 100 : 0) + catalogRankingBoost({
        query: input.query,
        productName: row.product_name,
        brand: row.brand,
        department: row.department,
      });
      const priceConflict = (identityPrices.get(identityKey(row.product_name))?.size ?? 0) > 1;
      const safePrice = priceConflict ? null : row.national_regular_price_eur;
      return {
        priceConflict,
        productName: row.product_name,
        department: row.department,
        sku: row.sku,
        currentPriceEur: safePrice,
        wasPriceEur: null,
        discountLabel: null,
        isOnOffer: false,
        score,
        quoteText: (priceConflict ? "The catalogue has conflicting prices for this named product, so its price needs confirmation. " : "") + formatCatalogStockQuote({
          productName: row.product_name,
          department: row.department,
          currentPriceEur: safePrice,
          wasPriceEur: null,
          discountLabel: null,
          isOnOffer: false,
          intent: input.intent,
        }),
        serviceArea: row.service_area,
        fulfilment: row.fulfilment,
        priceBasis: row.fulfilment === "counter" ? "counter_unknown" as const : "pack" as const,
        isAlcohol: row.is_alcohol,
        source: "catalog" as const,
      };
    })
    .filter((row) => row.score >= 0.5)
    .sort((a, b) => b.score - a.score || a.productName.localeCompare(b.productName))
    .slice(0, input.limit ?? 8);
}
