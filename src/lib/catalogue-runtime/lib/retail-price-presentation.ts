// @ts-nocheck -- generated source is checked by the app build and catalogue tests.
// Generated from cara-platform by scripts/sync-catalogue-runtime.py. Do not edit.
import { isRetailOfferObservationFresh } from "./retail-offer-freshness.js";
import { formatInTimeZone } from "date-fns-tz";

const DUBLIN = "Europe/Dublin";

export type RetailPromotionRow = {
  promotion_type: string | null;
  loyalty_required: boolean | null;
  loyalty_program: string | null;
  offer_price_eur: number | null;
  regular_price_eur: number | null;
  label: string | null;
  valid_from: string;
  valid_to: string;
  synced_at?: string | null;
};

export type RetailStorePriceListing = {
  regular_price_eur: number | null;
  display_price_eur: number | null;
  price_per_unit: string | null;
  source_price_label: string | null;
  retail_promotions: RetailPromotionRow[];
};

export type RetailWeeklyPriceRow = {
  current_price_eur: number | null;
  was_price_eur: number | null;
  discount_label: string | null;
  price_per_unit: string | null;
};

export type RetailPricePresentation = {
  currentPriceEur: number | null;
  regularPriceEur: number | null;
  pricePerUnit: string | null;
  offerLabel: string | null;
  isOnOffer: boolean;
  promotionType: string | null;
  loyaltyRequired: boolean;
  loyaltyProgram: string | null;
  isMultibuy: boolean;
  multibuyQuantity: number | null;
  multibuyTotalEur: number | null;
  multibuySavingEur: number | null;
  savingsEur: number | null;
  savingsPercent: number | null;
};

function positiveNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Retailer bundle terms are independent of an individual selling price. */
export function parseRetailMultibuyLabel(label: string | null | undefined): {
  kind: "quantity_total" | "buy_get" | "mix_match" | "generic";
  quantity: number | null;
  totalEur: number | null;
  buyQuantity: number | null;
  getQuantity: number | null;
  benefit: string | null;
  mixMatch: boolean;
} | null {
  const numbers: Record<string, string> = { one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9", ten: "10" };
  const text = String(label ?? "").toLowerCase().replace(/[-–]/g, " ")
    .replace(/\b(?:bogo|bogof)\b/g, "buy 1 get 1 free")
    .replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten)\b/g, (word) => numbers[word]!);
  const mixMatch = /\bmix\s*(?:&|and)\s*match\b/.test(text);
  const base = { quantity: null, totalEur: null, buyQuantity: null, getQuantity: null, benefit: null, mixMatch };
  const total = text.match(/\b(\d+)\s+for\s+[€£]?\s*(\d+(?:[.,]\d{1,2})?)/);
  if (total) {
    const quantity = Number(total[1]);
    const totalEur = Number(total[2]!.replace(",", "."));
    return quantity >= 2 && totalEur > 0 ? { ...base, kind: "quantity_total", quantity, totalEur } : null;
  }
  const crossBundle = text.match(/\bbundle\s+offer\b.*?\bonly\s*€\s*(\d+(?:[.,]\d{1,2})?)/);
  if (crossBundle) return {...base,kind:"generic",totalEur:Number(crossBundle[1]!.replace(",","."))};
  const buyGet = text.match(/\bbuy\s+(\d+)\s+(?:and\s+)?get\s+(\d+)\s+(free|half\s+price|\d+\s*%\s*off)/);
  if (buyGet && Number(buyGet[1]) > 0 && Number(buyGet[2]) > 0) {
    return { ...base, kind: "buy_get", buyQuantity: Number(buyGet[1]), getQuantity: Number(buyGet[2]), benefit: buyGet[3]!.replace(/\s+/g, " ") };
  }
  if (mixMatch) return { ...base, kind: "mix_match" };
  return /\bmulti\s*buys?\b/.test(text) ? { ...base, kind: "generic" } : null;
}

export function inferPromotionTypeFromLabel(
  label: string | null | undefined,
): string | null {
  const value = String(label ?? "").trim();
  if (!value) return null;
  if (parseRetailMultibuyLabel(value)) return "multibuy";
  if (/real\s+rewards|rewards?\s+price/i.test(value)) return "loyalty";
  if (/half[ -]?price|50\s*%\s*off/i.test(value)) return "half_price";
  if (/save\s*\d+(?:[.,]\d+)?\s*%/i.test(value)) return "percentage";
  if (/save\s*[€£]\s*\d/i.test(value)) return "money_off";
  return "standard_offer";
}

function parseMultibuy(
  label: string | null | undefined,
): { quantity: number; totalEur: number } | null {
  const match = String(label ?? "").match(
    /\b(\d+)\s*for\s*[€£]?\s*(\d+(?:[.,]\d{1,2})?)/i,
  );
  if (!match) return null;
  const quantity = Number(match[1]);
  const totalEur = Number(match[2]?.replace(",", "."));
  if (!Number.isFinite(quantity) || quantity < 2) return null;
  if (!Number.isFinite(totalEur) || totalEur <= 0) return null;
  return { quantity, totalEur };
}

export function compactRetailOfferLabel(
  label: string | null | undefined,
): string | null {
  const value = String(label ?? "").trim();
  if (!value) return null;
  const multibuy = parseMultibuy(value);
  if (multibuy) {
    return `${multibuy.quantity} for €${multibuy.totalEur.toFixed(2)}`;
  }
  return value;
}

function buildPresentation(input: {
  currentPriceEur: number | null;
  regularPriceEur: number | null;
  pricePerUnit: string | null;
  offerLabel: string | null;
  promotionType: string | null;
  loyaltyRequired: boolean;
  loyaltyProgram: string | null;
  isOnOffer: boolean;
}): RetailPricePresentation {
  const current = positiveNumber(input.currentPriceEur);
  const regular = positiveNumber(input.regularPriceEur);
  const savings =
    current != null && regular != null && regular > current
      ? Number((regular - current).toFixed(2))
      : null;
  const percent =
    savings != null && regular != null
      ? Number(((savings / regular) * 100).toFixed(1))
      : null;
  const inferred = input.promotionType ?? inferPromotionTypeFromLabel(input.offerLabel);
  const multibuy = parseMultibuy(input.offerLabel);
  const multibuySaving =
    multibuy && regular != null && regular * multibuy.quantity > multibuy.totalEur
      ? Number((regular * multibuy.quantity - multibuy.totalEur).toFixed(2))
      : null;

  return {
    currentPriceEur: current,
    regularPriceEur: regular,
    pricePerUnit: input.pricePerUnit?.trim() || null,
    offerLabel: input.offerLabel?.trim() || null,
    isOnOffer: input.isOnOffer,
    promotionType: inferred,
    loyaltyRequired:
      input.loyaltyRequired ||
      /real\s+rewards|rewards?\s+price/i.test(input.offerLabel ?? ""),
    loyaltyProgram:
      input.loyaltyProgram?.trim() ||
      (/real\s+rewards|rewards?\s+price/i.test(input.offerLabel ?? "")
        ? "Real Rewards"
        : null),
    isMultibuy:
      inferred === "multibuy" ||
      parseRetailMultibuyLabel(input.offerLabel) != null,
    multibuyQuantity: multibuy?.quantity ?? null,
    multibuyTotalEur: multibuy?.totalEur ?? null,
    multibuySavingEur: multibuySaving,
    savingsEur: savings,
    savingsPercent: percent,
  };
}

export function resolveStoredRetailPrice(
  listing: RetailStorePriceListing,
  reference = new Date(),
): RetailPricePresentation {
  const today = formatInTimeZone(reference, DUBLIN, "yyyy-MM-dd");
  const activePromotions = (listing.retail_promotions ?? []).filter(
    (promo) => promo.valid_from <= today && promo.valid_to >= today && isRetailOfferObservationFresh(promo.synced_at, reference),
  );
  const promo =
    activePromotions.find((row) => row.loyalty_required === true) ??
    activePromotions[0] ??
    null;

  const current =
    positiveNumber(promo?.offer_price_eur) ??
    (promo
      ? positiveNumber(listing.display_price_eur) ?? positiveNumber(listing.regular_price_eur)
      : positiveNumber(listing.regular_price_eur) ?? positiveNumber(listing.display_price_eur));
  const regular =
    positiveNumber(promo?.regular_price_eur) ??
    positiveNumber(listing.regular_price_eur);

  return buildPresentation({
    currentPriceEur: current,
    regularPriceEur: regular,
    pricePerUnit: listing.price_per_unit,
    offerLabel: promo?.label ?? null,
    promotionType: promo?.promotion_type ?? null,
    loyaltyRequired: promo?.loyalty_required === true,
    loyaltyProgram: promo?.loyalty_program ?? null,
    isOnOffer: promo != null,
  });
}

export function resolveNationalRetailPrice(input: {
  regularPriceEur: number | null;
  weeklyOffer?: RetailWeeklyPriceRow | null;
}): RetailPricePresentation {
  const offer = input.weeklyOffer ?? null;
  if (offer) {
    return buildPresentation({
      currentPriceEur: positiveNumber(offer.current_price_eur),
      regularPriceEur:
        positiveNumber(offer.was_price_eur) ??
        positiveNumber(input.regularPriceEur),
      pricePerUnit: offer.price_per_unit,
      offerLabel: offer.discount_label,
      promotionType: inferPromotionTypeFromLabel(offer.discount_label),
      loyaltyRequired: false,
      loyaltyProgram: null,
      isOnOffer: true,
    });
  }

  return buildPresentation({
    currentPriceEur: positiveNumber(input.regularPriceEur),
    regularPriceEur: positiveNumber(input.regularPriceEur),
    pricePerUnit: null,
    offerLabel: null,
    promotionType: null,
    loyaltyRequired: false,
    loyaltyProgram: null,
    isOnOffer: false,
  });
}

export function formatRetailPriceEur(value: number | null): string | null {
  if (value == null) return null;
  return new Intl.NumberFormat("en-IE", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}
