// @ts-nocheck -- generated source is checked by the app build and catalogue tests.
// Generated from cara-platform by scripts/sync-catalogue-runtime.py. Do not edit.
import type { CatalogQuoteIntent } from "./supervalu-catalog-search.js";

export type RetailStoreAssortmentStatus =
  | "stocked"
  | "not_stocked"
  | "not_confirmed";

export type RetailStoreAssortmentOverrideStatus = Exclude<
  RetailStoreAssortmentStatus,
  "not_confirmed"
>;

export function parseRetailStoreAssortmentStatus(
  value: unknown,
): RetailStoreAssortmentStatus {
  return value === "stocked" || value === "not_stocked"
    ? value
    : "not_confirmed";
}

export function formatStoreAssortmentQuote(input: {
  productName: string;
  status: RetailStoreAssortmentStatus;
  intent: CatalogQuoteIntent;
  originalQuote: string;
}): string {
  const productName = input.productName.trim() || "That product";

  if (input.status === "not_stocked") {
    return [
      `${productName} is listed in the wider SuperValu range, but this store has confirmed that it does not normally stock it.`,
      "Do not tell the caller that this store carries it, even if a national price or offer exists.",
      "If helpful, offer to have a team member call back about an alternative or special request.",
    ].join(" ");
  }

  if (input.status === "stocked") {
    if (input.intent === "stock") {
      return [
        `Yes — this store has confirmed that it normally stocks ${productName}.`,
        "That is normal assortment, not live shelf inventory, so do not promise it is available right now.",
        "Offer a team callback if the caller needs current availability confirmed.",
      ].join(" ");
    }

    return [
      input.originalQuote,
      "This store has confirmed that it normally stocks this product.",
      "Do not promise live shelf availability unless a live stock source explicitly confirms it.",
    ].join(" ");
  }

  if (input.intent === "stock") {
    return [
      `${productName} is listed in the wider SuperValu range, but this store has not confirmed whether it normally stocks it.`,
      "Do not say that this store carries it.",
      "Offer to have a team member call back to confirm if the caller needs to know.",
    ].join(" ");
  }

  return [
    input.originalQuote,
    "Important: the price or offer above is from the wider range and does not prove that this store carries the product.",
    "This store has not confirmed its normal assortment for this product, so say that clearly and offer a team callback if needed.",
  ].join(" ");
}
