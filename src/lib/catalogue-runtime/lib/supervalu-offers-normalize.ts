// @ts-nocheck -- generated source is checked by the app build and catalogue tests.
// Generated from cara-platform by scripts/sync-catalogue-runtime.py. Do not edit.
import { formatInTimeZone, toZonedTime } from "date-fns-tz";

import {
  mapServiceAreaToOfferChannel,
  SUPERVALU_MEAT_CATEGORY_SEEDS,
  type SupervaluGatewayProduct,
  type SupervaluFulfilment,
  type SupervaluOfferChannel,
  type SupervaluServiceArea,
} from "./supervalu-offers-types.js";

const DUBLIN = "Europe/Dublin";

export type NormalizedWeeklyOffer = {
  productName: string;
  department: string;
  offerChannel: SupervaluOfferChannel;
  serviceArea: SupervaluServiceArea;
  fulfilment: SupervaluFulfilment;
  currentPriceEur: number;
  wasPriceEur: number | null;
  discountLabel: string | null;
  pricePerUnit: string | null;
  categoryBreadcrumb: string | null;
  sellBy: string | null;
  priceUnitType: string | null;
  isAlcohol: boolean;
  brand: string | null;
  sku: string | null;
  sourceUrl: string | null;
  searchText: string;
};

const WEIGHT_IN_PARENS_PATTERN = /\(\s*\d+(\.\d+)?\s*(g|kg|ml|l)\s*\)/i;

const PREPACK_NAME_PATTERNS = [
  WEIGHT_IN_PARENS_PATTERN,
  /quick fry/i,
  /burger box/i,
  /goujon/i,
  /nugget/i,
  /breaded/i,
  /\d+\s*pack/i,
  /sliced corned/i,
  /meatballs promo/i,
  /squeezy/i,
  /wafer thin/i,
  /family pack/i,
];

const PREPACK_DEPARTMENT_HINTS = [
  "pre-pack",
  "rashers",
  "pudding",
  "sausages",
  "crisps",
  "snacks",
  "luncheon",
  "sliced cooked meats",
  "chilled food",
];

function primaryBreadcrumb(product: SupervaluGatewayProduct): string {
  const def = product.defaultCategory?.[0]?.categoryBreadcrumb;
  if (def) return String(def).trim();
  const cats = product.categories ?? [];
  const deepest = cats
    .map((c) => String(c.categoryBreadcrumb ?? "").trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)[0];
  return deepest ?? "";
}

function isAlcoholProduct(product: SupervaluGatewayProduct): boolean {
  if (product.attributes?.["Alcohol Restricted"] === true) return true;
  const crumb = primaryBreadcrumb(product).toLowerCase();
  return /\/drinks\/(wine|beer|spirits|cider)|off[- ]licence|off licence/i.test(
    crumb,
  );
}

function isLooseFresh(product: SupervaluGatewayProduct): boolean {
  return (
    product.attributes?.["loose fresh"] === true ||
    product.attributes?.["fresh commodity"] === true
  );
}

function isWeightSold(product: SupervaluGatewayProduct): boolean {
  const sellBy = String(product.sellBy ?? "").trim().toLowerCase();
  const unitType = String(product.unitOfPrice?.type ?? "").trim().toLowerCase();
  return (
    unitType === "kilogram" ||
    sellBy === "unit" ||
    sellBy === "weight" ||
    Boolean(product.weightIncrement)
  );
}

function matchesButcherPrepackName(name: string, product: SupervaluGatewayProduct): boolean {
  return PREPACK_NAME_PATTERNS.some((pattern) => {
    // Counter butcher steaks often show "(1 kg)" while still sold by weight at the counter.
    if (pattern.source === WEIGHT_IN_PARENS_PATTERN.source && isWeightSold(product)) {
      return false;
    }
    return pattern.test(name);
  });
}
function hasStrongFreshMeatName(name: string): boolean {
  return /\b(?:beef\s+)?(?:striploin|sirloin|rib[ -]?eye|rump|fillet)\s+steaks?\b|\b(?:striploin|sirloin|rib[ -]?eye)\s+roast\b|\b(?:beef|steak)\s+mince\b|\bbeef\s+(?:roasting\s+)?joint\b|\blamb\s+(?:loin\s+)?chops?\b|\bpork\s+(?:loin\s+)?chops?\b|\bchicken\s+(?:breast\s+)?fillets?\b|\bwhole\s+chicken\b|\bturkey\s+breast\b|\brashers\b|\bsausages?\b/i.test(
    name,
  );
}

function isClearlyNonButcherContext(department: string, breadcrumb: string): boolean {
  const context = `${department} ${breadcrumb}`;
  return /dog[ -]?(?:food|treat|chew|biscuit|puppy)|cat[ -]?(?:food|treat|kitten)|\/dog-puppy\/|\/cat-kitten\/|pet food|soup|gravy|(?:^|[ /-])stock(?:[ /-]|$)|sauce|seasoning|herbs?|spices?|ready[ -]?meals?|pot[ -]?noodle|frozen|(?:^|[ /-])pie(?:[ /-]|$)|pizza|sandwich|crisps?|snacks?|baby food/i.test(
    context,
  );
}


/** Classify service area + counter vs prepack from gateway breadcrumbs and attributes. */
export function classifySupervaluOfferServiceArea(input: {
  product: SupervaluGatewayProduct;
  productName: string;
  department: string;
  discountLabel?: string | null;
}): { serviceArea: SupervaluServiceArea; fulfilment: SupervaluFulfilment } {
  const { product, productName, department, discountLabel } = input;
  const crumb = primaryBreadcrumb(product).toLowerCase();
  const dept = department.trim().toLowerCase();
  const name = productName.trim();
  const label = String(discountLabel ?? "").trim();

  if (isAlcoholProduct(product)) {
    return { serviceArea: "off_licence", fulfilment: "prepack" };
  }

  if (
    crumb.includes("fish & seafood") ||
    crumb.includes("fish counter") ||
    crumb.includes("prepack fresh fish") ||
    crumb.includes("frozen fish & seafood") ||
    crumb.includes("prepared by our fishmonger")
  ) {
    if (
      crumb.includes("fish counter") ||
      crumb.includes("prepared by our fishmonger") ||
      /^loose /i.test(name)
    ) {
      return { serviceArea: "fish", fulfilment: "counter" };
    }
    return { serviceArea: "fish", fulfilment: "prepack" };
  }

  // SuperValu's /categories/prepack/* tree is the packaged fresh-meat
  // range (mince, roasts, steaks/chops, stewing/diced, organic meat, etc.).
  // Treat it as butcher/prepacked even when altCategory is generic like "Organic".
  if (crumb.includes("/categories/prepack/")) {
    return { serviceArea: "butcher", fulfilment: "prepack" };
  }

  if (crumb.includes("deli counter")) {
    if (
      PREPACK_NAME_PATTERNS.some((pattern) => pattern.test(name)) &&
      !isWeightSold(product)
    ) {
      return { serviceArea: "deli", fulfilment: "prepack" };
    }
    return { serviceArea: "deli", fulfilment: "counter" };
  }

  const clearlyNonMeatPudding =
    /rice pudding|dessert|custard/i.test(dept) ||
    /food cupboard\/desserts|rice pudding/i.test(crumb);

  // Some genuine fresh/prepacked meat lines sit under generic source categories
  // such as "Organic". Strong cut names can safely recover those rows, while
  // prepared foods, soups, sauces, pet food, frozen food, etc. remain grocery.
  if (
    hasStrongFreshMeatName(name) &&
    !isClearlyNonButcherContext(dept, crumb)
  ) {
    if (isWeightSold(product) && !matchesButcherPrepackName(name, product)) {
      return { serviceArea: "butcher", fulfilment: "counter" };
    }
    return { serviceArea: "butcher", fulfilment: "prepack" };
  }

  if (
    !clearlyNonMeatPudding &&
    (
      crumb.includes("meat & poultry") ||
      crumb.includes("/butcher") ||
      dept.includes("butcher") ||
      /beef|lamb|pork|poultry|steak|rashers|sausage|black pudding|white pudding|meat/i.test(dept)
    )
  ) {
    if (/^\d+\s+for\s+/i.test(label)) {
      return { serviceArea: "butcher", fulfilment: "counter" };
    }
    if (
      PREPACK_DEPARTMENT_HINTS.some((hint) => dept.includes(hint)) ||
      matchesButcherPrepackName(name, product)
    ) {
      return { serviceArea: "butcher", fulfilment: "prepack" };
    }
    if (isWeightSold(product) && !matchesButcherPrepackName(name, product)) {
      return { serviceArea: "butcher", fulfilment: "counter" };
    }
    return { serviceArea: "butcher", fulfilment: "prepack" };
  }

  if (
    crumb.includes("sliced cooked meats") ||
    (dept.includes("ham") && PREPACK_NAME_PATTERNS.some((p) => p.test(name)))
  ) {
    return { serviceArea: "deli", fulfilment: "prepack" };
  }

  if (
    crumb.includes("fresh in store bakery") ||
    crumb.includes("/bakery/fresh in store bakery")
  ) {
    return { serviceArea: "bakery", fulfilment: "counter" };
  }

  const produceBreadcrumb =
    crumb.includes("fresh fruit & veg") ||
    /(?:^|\/)fruit(?:\/|$)/i.test(crumb) ||
    /(?:^|\/)vegetables(?:\/|$)/i.test(crumb) ||
    /(?:^|\/)fruit-vegetables(?:\/|$)/i.test(crumb);
  const produceDepartmentWithoutBreadcrumb =
    !crumb &&
    /\b(?:berries|grapes?|citrus|bananas?|apples?|pears?|rhubarb|kiwis?|peaches?|plums?|nectarines?|prepared fruit|exotic fruit|vegetables?|potatoes?|carrots?|broccoli|cauliflower|cabbage|onions?|garlic|mushrooms?|leeks?|celery|peppers?)\b/i.test(
      dept,
    );

  if (produceBreadcrumb || produceDepartmentWithoutBreadcrumb) {
    if (isLooseFresh(product) || isWeightSold(product)) {
      return { serviceArea: "produce", fulfilment: "counter" };
    }
    return { serviceArea: "produce", fulfilment: "prepack" };
  }

  if (/deli|ham|cooked meat|salami|charcuterie/i.test(dept)) {
    if (isWeightSold(product) && !PREPACK_NAME_PATTERNS.some((p) => p.test(name))) {
      return { serviceArea: "deli", fulfilment: "counter" };
    }
    return { serviceArea: "deli", fulfilment: "prepack" };
  }

  if (
    crumb.includes("milk, yogurt, butter & eggs") ||
    crumb.includes("/fresh-milk/") ||
    crumb.includes("/yogurts/") ||
    crumb.includes("/everyday-yogurts/") ||
    crumb.includes("/cheese/") ||
    crumb.includes("/butter-spreads/") ||
    /milk|yogurt|yoghurt|cheese|butter|cream|dairy/i.test(dept)
  ) {
    return { serviceArea: "dairy", fulfilment: "prepack" };
  }

  return { serviceArea: "grocery", fulfilment: "prepack" };
}

/** Legacy channel for backward compatibility. */
export function classifySupervaluOfferChannel(input: {
  productName: string;
  department: string;
  discountLabel?: string | null;
  product?: SupervaluGatewayProduct;
}): SupervaluOfferChannel {
  if (input.product) {
    const classified = classifySupervaluOfferServiceArea({
      product: input.product,
      productName: input.productName,
      department: input.department,
      discountLabel: input.discountLabel,
    });
    return mapServiceAreaToOfferChannel(classified);
  }

  const dept = input.department.trim().toLowerCase();
  const name = input.productName.trim();
  const label = String(input.discountLabel ?? "").trim();
  const isMeatDept =
    /butcher|beef|lamb|pork|poultry|chicken|steak|meat|deli|rashers|sausage|pudding|ham/i.test(
      dept,
    );

  if (!isMeatDept) return "grocery";
  if (/^\d+\s+for\s+/i.test(label)) return "butcher_counter";
  if (dept === "butcher" && !PREPACK_NAME_PATTERNS.some((pattern) => pattern.test(name))) {
    return "butcher_counter";
  }
  return "prepack";
}

export function normalizeSearchText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function currentSupervaluOfferWeek(reference = new Date()): {
  start: string;
  end: string;
} {
  const dublin = toZonedTime(reference, DUBLIN);
  const day = dublin.getDay();
  const daysSinceThursday = (day + 3) % 7;
  const start = new Date(dublin);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - daysSinceThursday);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  return {
    start: formatInTimeZone(start, DUBLIN, "yyyy-MM-dd"),
    end: formatInTimeZone(end, DUBLIN, "yyyy-MM-dd"),
  };
}

export function isPromotionalSupervaluProduct(
  product: SupervaluGatewayProduct,
): boolean {
  if (product.priceSource === "promotion" || product.priceSource === "tpr") {
    return true;
  }
  if ((product.tprPrice?.length ?? 0) > 0) return true;
  if ((product.promotions?.length ?? 0) > 0) {
    const current = Number(product.priceNumeric ?? product.wholePrice ?? 0);
    const was = Number(product.wasPriceNumeric ?? 0);
    if (was > 0 && was > current) return true;
    if (product.priceSource === "promotion") return true;
  }
  const current = Number(product.priceNumeric ?? product.wholePrice ?? 0);
  const was = Number(product.wasPriceNumeric ?? 0);
  if (was > 0 && was > current) return true;
  if (String(product.priceLabel ?? "").trim()) return true;
  return false;
}

function resolvePromotionalPricing(product: SupervaluGatewayProduct): {
  currentPriceEur: number;
  wasPriceEur: number | null;
  discountLabel: string | null;
} | null {
  const tpr = product.tprPrice?.[0];
  if (tpr && Number(tpr.markdown ?? 0) > 0) {
    const currentPriceEur = Number(tpr.markdown);
    const wasRaw = Number(product.wasPriceNumeric ?? 0);
    return {
      currentPriceEur,
      wasPriceEur:
        Number.isFinite(wasRaw) && wasRaw > currentPriceEur ? wasRaw : null,
      discountLabel:
        String(tpr.label ?? product.priceLabel ?? "").trim() ||
        String(product.promotions?.[0]?.name ?? "").trim() ||
        null,
    };
  }

  const currentPriceEur = Number(product.priceNumeric ?? product.wholePrice ?? 0);
  if (!Number.isFinite(currentPriceEur) || currentPriceEur <= 0) return null;

  const wasRaw = Number(product.wasPriceNumeric ?? 0);
  const wasPriceEur =
    Number.isFinite(wasRaw) && wasRaw > currentPriceEur ? wasRaw : null;
  const promoLabel =
    String(product.priceLabel ?? "").trim() ||
    String(product.promotions?.[0]?.name ?? product.promotions?.[0]?.description ?? "").trim() ||
    null;

  if (
    product.priceSource === "promotion" ||
    product.priceSource === "tpr" ||
    wasPriceEur != null ||
    promoLabel
  ) {
    return { currentPriceEur, wasPriceEur, discountLabel: promoLabel };
  }

  return null;
}

export function normalizeSupervaluGatewayProduct(
  product: SupervaluGatewayProduct,
  department: string,
): NormalizedWeeklyOffer | null {
  const productName = String(product.name ?? "").trim();
  if (!productName) return null;
  if (!isPromotionalSupervaluProduct(product)) return null;

  const pricing = resolvePromotionalPricing(product);
  if (!pricing) return null;

  const { currentPriceEur, wasPriceEur, discountLabel } = pricing;
  const sku = String(product.sku ?? product.productId ?? "").trim() || null;
  const altCategory = String(product.attributes?.altCategory ?? "").trim();
  const resolvedDepartment = altCategory || department;
  const brand = String(product.brand ?? "").trim() || null;
  const categoryBreadcrumb = primaryBreadcrumb(product) || null;
  const sellBy = String(product.sellBy ?? "").trim() || null;
  const priceUnitType = String(product.unitOfPrice?.type ?? "").trim() || null;
  const isAlcohol = isAlcoholProduct(product);

  const { serviceArea, fulfilment } = classifySupervaluOfferServiceArea({
    product,
    productName,
    department: resolvedDepartment,
    discountLabel,
  });
  const offerChannel = mapServiceAreaToOfferChannel({ serviceArea, fulfilment });

  return {
    productName,
    department: resolvedDepartment,
    offerChannel,
    serviceArea,
    fulfilment,
    currentPriceEur,
    wasPriceEur,
    discountLabel,
    pricePerUnit: String(product.pricePerUnit ?? "").trim() || null,
    categoryBreadcrumb,
    sellBy,
    priceUnitType,
    isAlcohol,
    brand,
    sku,
    sourceUrl: String(product.url ?? "").trim() || null,
    searchText: normalizeSearchText(
      [productName, brand, resolvedDepartment, categoryBreadcrumb, sku ?? ""]
        .filter(Boolean)
        .join(" "),
    ),
  };
}

export { SUPERVALU_MEAT_CATEGORY_SEEDS };
