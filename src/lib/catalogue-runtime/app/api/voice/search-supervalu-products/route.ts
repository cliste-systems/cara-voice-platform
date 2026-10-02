// @ts-nocheck -- generated source is checked by the app build and catalogue tests.
// Generated from cara-platform by scripts/sync-catalogue-runtime.py. Do not edit.
const NextResponse = Response;

import { normalizeCustomerPhoneE164 } from "../../../../lib/booking-reference.js";
import {
  assessSyncedOffersFreshness,
  inferWeeklyOfferFulfilmentFromQuery,
  inferWeeklyOfferServiceAreaFromQuery,
  loadLatestRetailOfferWeekEnd,
} from "../../../../lib/retail-weekly-offers-search.js";
import type { SupervaluFulfilment, SupervaluServiceArea } from "../../../../lib/supervalu-offers-types.js";
import { resolveProductSearchResponse } from "../../../../lib/retail-product-clarification.js";
import { isPreparedBurgerProduct } from "../../../../lib/retail-product-context.js";
import {
  formatCatalogStockNoMatchQuote,
  inferCatalogSearchIntent,
  searchSupervaluCatalogLiveWithFallback,
  SUPERVALU_CATALOG_SEARCH_MAX_QUERY_CHARS,
  type CatalogQuoteIntent,
} from "../../../../lib/supervalu-catalog-search.js";
import {
  authorizeVoiceWebhook,
  voiceWebhookNoSecretResponse,
  voiceWebhookUnauthorizedResponse,
} from "../../../../lib/voice-webhook-auth.js";
import { createAdminClient } from "../../../../utils/supabase/admin.js";
import {
  formatStoreAssortmentQuote,
  parseRetailStoreAssortmentStatus,
} from "../../../../lib/retail-store-assortment.js";

export const dynamic = "force-dynamic";

type SearchSupervaluProductsBody = {
  called_number?: string;
  query?: string;
  intent?: CatalogQuoteIntent;
  fulfilment?: "counter" | "prepack";
  service_area?: SupervaluServiceArea;
};

/**
 * Voice worker: SuperValu product lookup — stock, price, and synced weekly offers.
 */
export async function POST(request: Request) {
  const auth = await authorizeVoiceWebhook(request);
  if (auth === "no_secret") return voiceWebhookNoSecretResponse();
  if (auth === "bad") return voiceWebhookUnauthorizedResponse();

  let body: SearchSupervaluProductsBody;
  try {
    body = (await request.json()) as SearchSupervaluProductsBody;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const calledNumberRaw = String(body.called_number ?? "").trim();
  if (!calledNumberRaw) {
    return NextResponse.json(
      { ok: false, error: "called_number is required" },
      { status: 400 },
    );
  }

  const query = String(body.query ?? "").trim();
  if (!query) {
    return NextResponse.json(
      { ok: false, error: "query is required" },
      { status: 400 },
    );
  }
  if (query.length > SUPERVALU_CATALOG_SEARCH_MAX_QUERY_CHARS) {
    return NextResponse.json(
      {
        ok: false,
        error: `query must be at most ${SUPERVALU_CATALOG_SEARCH_MAX_QUERY_CHARS} characters`,
      },
      { status: 400 },
    );
  }

  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        error: e instanceof Error ? e.message : "Server configuration error",
      },
      { status: 503 },
    );
  }

  const calledE164 =
    normalizeCustomerPhoneE164(calledNumberRaw) || calledNumberRaw;
  const { data: phoneRow, error: phoneErr } = await admin
    .from("phone_numbers")
    .select("organization_id")
    .eq("e164", calledE164)
    .maybeSingle();

  if (phoneErr) {
    console.error("[voice/search-supervalu-products] phone lookup", phoneErr);
    return NextResponse.json(
      { ok: false, error: "Database error" },
      { status: 500 },
    );
  }
  if (!phoneRow?.organization_id) {
    return NextResponse.json(
      {
        ok: false,
        error: `called_number ${calledE164} is not assigned to any organization`,
      },
      { status: 404 },
    );
  }

  const orgId = phoneRow.organization_id as string;

  const { data: orgRow, error: orgErr } = await admin
    .from("organizations")
    .select("is_active, niche, retail_banner, offers_synced_at, retail_source_store_id, catalog_synced_at")
    .eq("id", orgId)
    .maybeSingle();
  if (orgErr) {
    console.error("[voice/search-supervalu-products] org lookup", orgErr);
    return NextResponse.json(
      { ok: false, error: "Database error" },
      { status: 500 },
    );
  }
  if (!orgRow?.is_active) {
    return NextResponse.json(
      { ok: false, code: "org_suspended", error: "Organization is not active" },
      { status: 403 },
    );
  }
  if (String(orgRow.niche ?? "") !== "retail") {
    return NextResponse.json(
      { ok: false, error: "Catalog lookup is only available for retail orgs" },
      { status: 403 },
    );
  }
  const retailBanner = String(orgRow.retail_banner ?? "").trim();
  if (retailBanner !== "supervalu") {
    return NextResponse.json(
      { ok: false, error: "Catalog lookup is not enabled for this banner" },
      { status: 403 },
    );
  }

  const intent =
    body.intent === "offer" || body.intent === "price" || body.intent === "stock"
      ? body.intent
      : inferCatalogSearchIntent(query);

  const fulfilment: SupervaluFulfilment | null =
    body.fulfilment === "counter" || body.fulfilment === "prepack"
      ? body.fulfilment
      : inferWeeklyOfferFulfilmentFromQuery(query);

  const allowedServiceAreas = new Set<SupervaluServiceArea>([
    "butcher",
    "deli",
    "fish",
    "produce",
    "bakery",
    "dairy",
    "off_licence",
    "grocery",
  ]);
  const requestedServiceArea = String(body.service_area ?? "").trim() as SupervaluServiceArea;
  const serviceArea: SupervaluServiceArea | null =
    allowedServiceAreas.has(requestedServiceArea)
      ? requestedServiceArea
      : inferWeeklyOfferServiceAreaFromQuery(query);

  const reference = new Date();
  const sourceStoreId =
    String(orgRow.retail_source_store_id ?? "").trim() || null;
  const [latestOfferWeekEnd, { matches, ownBrandFallbackQuote }] = await Promise.all([
    loadLatestRetailOfferWeekEnd(admin, retailBanner, reference),
    searchSupervaluCatalogLiveWithFallback(query, {
      intent, supabase: admin, retailBanner, fulfilment, serviceArea,
      storeId: sourceStoreId ?? undefined, reference,
    }),
  ]);
  const offersFreshness = assessSyncedOffersFreshness({
    syncedAt:
      typeof orgRow.offers_synced_at === "string" ? orgRow.offers_synced_at : null,
    offerWeekEnd: latestOfferWeekEnd,
    reference,
  });

  const mappedMatches = matches.map((match) => ({
    offer_week_start: match.offerWeekStart ?? null,
    offer_week_end: match.offerWeekEnd ?? null,
    price_conflict: match.priceConflict === true,
    product_name: match.productName,
    department: match.department,
    sku: match.sku,
    current_price_eur: match.currentPriceEur,
    was_price_eur: match.wasPriceEur,
    discount_label: match.discountLabel,
    mix_match_verified: /\bmix\s*(?:and|&)\s*match\b/i.test(match.discountLabel ?? "") ? true : null,
    is_on_offer: match.isOnOffer,
    service_area: match.serviceArea ?? null,
    fulfilment: match.fulfilment ?? null,
    is_alcohol: match.isAlcohol === true,
    campaign_names: match.campaignNames ?? [],
    score: match.score,
    quote_text: match.quoteText,
    source: match.source ?? null,
    price_basis: match.priceBasis ?? (match.fulfilment === "counter" ? "counter_unknown" as const : "pack" as const),
  }));
  const { clarificationHint, comparisonNote, matches: responseMatches } = resolveProductSearchResponse(
    query,
    mappedMatches,
    { fulfilment, intent },
  );

  // A national catalogue match is not evidence that this specific store carries
  // the product. Resolve explicit store-level assortment decisions separately.
  // No override row means "not confirmed" and must remain conservative.
  const matchSkus = [
    ...new Set(
      responseMatches
        .map((match) => String(match.sku ?? "").trim())
        .filter(Boolean),
    ),
  ];

  type CatalogIdentityRow = {
    id: string;
    sku: string | null;
    product_name: string;
  };

  const catalogIdentityRows: CatalogIdentityRow[] = [];
  if (matchSkus.length > 0) {
    const { data, error } = await admin
      .from("retail_catalog_products")
      .select("id, sku, product_name")
      .eq("retail_banner", retailBanner)
      .in("sku", matchSkus)
      .abortSignal(AbortSignal.timeout(1_000));
    if (error) {
      console.error("[voice/search-supervalu-products] assortment sku lookup", error);
    } else {
      catalogIdentityRows.push(...((data ?? []) as CatalogIdentityRow[]));
    }
  }
  // Exact SKU identities already resolved above do not need a second,
  // potentially expensive product-name scan. Optional enrichment has a short
  // deadline; missing decisions remain conservatively "not_confirmed".
  const resolvedSkus = new Set(catalogIdentityRows.map((row) => row.sku).filter(Boolean));
  const matchNames = [...new Set(responseMatches
    .filter((match) => !match.sku || !resolvedSkus.has(match.sku))
    .map((match) => match.product_name.trim()).filter(Boolean))];
  if (matchNames.length > 0) {
    const { data, error } = await admin
      .from("retail_catalog_products")
      .select("id, sku, product_name")
      .eq("retail_banner", retailBanner)
      .in("product_name", matchNames)
      .abortSignal(AbortSignal.timeout(1_000));
    if (error) {
      console.error("[voice/search-supervalu-products] assortment name lookup", error);
    } else {
      catalogIdentityRows.push(...((data ?? []) as CatalogIdentityRow[]));
    }
  }

  const productIdBySku = new Map<string, string>();
  const productIdByName = new Map<string, string>();
  for (const row of catalogIdentityRows) {
    const sku = String(row.sku ?? "").trim();
    if (sku) productIdBySku.set(sku, row.id);
    const nameKey = String(row.product_name ?? "").trim().toLowerCase();
    if (nameKey) productIdByName.set(nameKey, row.id);
  }

  const productIds = [...new Set(catalogIdentityRows.map((row) => row.id))];
  const assortmentByProductId = new Map<string, "stocked" | "not_stocked">();
  if (productIds.length > 0) {
    const { data, error } = await admin
      .from("retail_store_product_assortment")
      .select("product_id, status")
      .eq("organization_id", orgId)
      .in("product_id", productIds)
      .abortSignal(AbortSignal.timeout(1_000));
    if (error) {
      console.error("[voice/search-supervalu-products] assortment override lookup", error);
    } else {
      for (const row of data ?? []) {
        if (row.status === "stocked" || row.status === "not_stocked") {
          assortmentByProductId.set(String(row.product_id), row.status);
        }
      }
    }
  }

  const storeAwareMatches = responseMatches.map((match) => {
    const comparisonLabel = !comparisonNote ? "" : !(Number(match.current_price_eur) > 0)
      ? "Unranked option: no verified single-item price. "
      : match.price_basis === "pack"
      ? "Lowest listed pack/item total among the matching results checked. "
      : match.price_basis === "per_kilo"
        ? "Lowest listed per-kilo rate among the matching results checked. "
        : "Unranked counter option: its selling unit needs confirmation. ";
    const sku = String(match.sku ?? "").trim();
    const nameKey = String(match.product_name ?? "").trim().toLowerCase();
    const productId =
      (sku ? productIdBySku.get(sku) : undefined) ??
      productIdByName.get(nameKey);
    const storeStatus = parseRetailStoreAssortmentStatus(
      productId ? assortmentByProductId.get(productId) : undefined,
    );

    return {
      ...match,
      store_assortment_status: storeStatus,
      quote_text: formatStoreAssortmentQuote({
        productName: match.product_name,
        status: storeStatus,
        intent,
        originalQuote: comparisonNote ? `${comparisonLabel}${isPreparedBurgerProduct(match.product_name, match.department) ? "This is a prepared single-serve or ready-meal product. " : ""}${match.quote_text} ${comparisonNote}` : match.quote_text,
      }),
    };
  });

  const noMatchQuote: string | null =
    mappedMatches.length === 0 || (responseMatches.length === 0 && !clarificationHint)
      ? ownBrandFallbackQuote ?? (intent === "offer"
        ? `I couldn't confirm a current national offer matching "${query}" from the latest verified offers. `
        : formatCatalogStockNoMatchQuote(query))
      : null;

  return NextResponse.json({
    ok: true,
    intent,
    service_area: serviceArea,
    fulfilment,
    clarification_hint: clarificationHint,
    ...(comparisonNote ? { comparison_note: comparisonNote } : {}),
    offers_freshness: offersFreshness.stale ? offersFreshness.message : null,
    matches: storeAwareMatches,
    no_match_quote: noMatchQuote,
  });
}
