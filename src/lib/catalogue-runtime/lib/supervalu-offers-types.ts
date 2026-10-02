// @ts-nocheck -- generated source is checked by the app build and catalogue tests.
// Generated from cara-platform by scripts/sync-catalogue-runtime.py. Do not edit.
export type SupervaluOfferChannel = "butcher_counter" | "prepack" | "grocery";

export type SupervaluServiceArea =
  | "butcher"
  | "deli"
  | "fish"
  | "produce"
  | "bakery"
  | "dairy"
  | "off_licence"
  | "grocery";

export type SupervaluFulfilment = "counter" | "prepack";

export type RetailWeeklyOfferRow = {
  id: string;
  organization_id: string | null;
  retail_banner: string;
  sync_batch_id: string;
  product_name: string;
  department: string;
  offer_channel: SupervaluOfferChannel;
  service_area: SupervaluServiceArea;
  fulfilment: SupervaluFulfilment;
  current_price_eur: number | null;
  was_price_eur: number | null;
  discount_label: string | null;
  price_per_unit: string | null;
  category_breadcrumb: string | null;
  campaign_names?: string[] | null;
  sell_by: string | null;
  price_unit_type: string | null;
  is_alcohol: boolean;
  brand: string | null;
  sku: string | null;
  offer_week_start: string;
  offer_week_end: string;
  source_url: string | null;
  search_text: string;
  synced_at: string;
};

export type SupervaluGatewayCategoryRef = {
  categoryId?: string;
  retailerId?: string;
  category?: string;
  categoryBreadcrumb?: string;
};

export type SupervaluGatewayProduct = {
  productId?: string;
  sku?: string;
  name?: string;
  brand?: string;
  price?: string;
  priceNumeric?: number;
  wholePrice?: number;
  wasPrice?: string;
  wasPriceNumeric?: number;
  priceLabel?: string;
  pricePerUnit?: string;
  priceSource?: string;
  sellBy?: string;
  unitOfPrice?: { type?: string; label?: string };
  unitOfMeasure?: { type?: string };
  weightIncrement?: unknown;
  categories?: SupervaluGatewayCategoryRef[];
  defaultCategory?: SupervaluGatewayCategoryRef[];
  attributes?: Record<string, unknown> & {
    altCategory?: string;
    "Alcohol Restricted"?: boolean;
    "loose fresh"?: boolean;
    "fresh commodity"?: boolean;
    "SV packaged"?: boolean;
  };
  url?: string;
  tprPrice?: Array<{
    markdown?: number;
    label?: string;
    wholePrice?: number;
    active?: boolean;
  }>;
  promotions?: Array<{
    name?: string;
    description?: string;
    promotionType?: string;
  }>;
  promotionInfo?: unknown[];
};

export type SupervaluOffersSyncResult = {
  ok: true;
  /** Refresh was accepted; counts describe the last published snapshot. */
  queued?: boolean;
  syncBatchId: string;
  offerCount: number;
  organizationsUpdated: number;
  offerWeekStart: string;
  offerWeekEnd: string;
  syncedAt: string;
  serviceAreaCounts?: Record<string, number>;
} | {
  ok: false;
  message: string;
};

export const SUPERVALU_OFFERS_SYNC_SOURCE = "supervalu_national";

export const SUPERVALU_STOREFRONT_STORE_ID =
  process.env.SUPERVALU_STOREFRONT_STORE_ID?.trim() || "5550";

/** Meat / butcher categories for the pilot sync scope. */
export const SUPERVALU_MEAT_CATEGORY_SEEDS: {
  categoryId: string;
  department: string;
}[] = [
  { categoryId: "O411190", department: "Butcher" },
  { categoryId: "O411290", department: "Butcher" },
  { categoryId: "O411195", department: "Butcher" },
  { categoryId: "O411215", department: "Butcher" },
  { categoryId: "O303440", department: "Butcher" },
  { categoryId: "O300470", department: "Butcher" },
  { categoryId: "O303395", department: "Butcher" },
  { categoryId: "O200088", department: "Butcher" },
  { categoryId: "O411335", department: "Butcher" },
  { categoryId: "O300545", department: "Deli" },
];

/** @deprecated Use SUPERVALU_PROMO_CATEGORY_SEEDS from supervalu-promo-category-map.ts */
export const SUPERVALU_FULL_STORE_CATEGORY_SEEDS: {
  categoryId: string;
  department: string;
}[] = [
  { categoryId: "O100035", department: "Food Cupboard" },
  { categoryId: "O100045", department: "Frozen Foods" },
  { categoryId: "O100025", department: "Fresh Fruit & Veg" },
  { categoryId: "O100015", department: "Dairy & Chilled" },
  { categoryId: "O100010", department: "Bakery" },
  { categoryId: "O100050", department: "Household" },
  { categoryId: "O100055", department: "Health & Beauty" },
  { categoryId: "O200325", department: "Chocolate & Sweets" },
];

export const SUPERVALU_MIN_FULL_STORE_OFFER_COUNT = 350;

export function mapServiceAreaToOfferChannel(input: {
  serviceArea: SupervaluServiceArea;
  fulfilment: SupervaluFulfilment;
}): SupervaluOfferChannel {
  if (input.serviceArea === "butcher" && input.fulfilment === "counter") {
    return "butcher_counter";
  }
  if (input.serviceArea === "butcher" && input.fulfilment === "prepack") {
    return "prepack";
  }
  if (input.serviceArea === "deli" && input.fulfilment === "counter") {
    return "butcher_counter";
  }
  if (input.serviceArea === "deli" && input.fulfilment === "prepack") {
    return "prepack";
  }
  if (input.serviceArea === "fish" && input.fulfilment === "counter") {
    return "butcher_counter";
  }
  if (input.serviceArea === "fish" && input.fulfilment === "prepack") {
    return "prepack";
  }
  return "grocery";
}
