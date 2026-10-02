// @ts-nocheck -- generated source is checked by the app build and catalogue tests.
// Generated from cara-platform by scripts/sync-catalogue-runtime.py. Do not edit.
import {
  SUPERVALU_STOREFRONT_STORE_ID,
  type SupervaluGatewayProduct,
} from "./supervalu-offers-types.js";

export const SUPERVALU_GATEWAY_BASE = "https://storefrontgateway.supervalu.ie/api";
export const SUPERVALU_GATEWAY_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
export const SUPERVALU_GATEWAY_PAGE_SIZE = 100;

/** Required for SuperValu to return weekly promotion prices (butcher counter % off, etc.). */
export const SUPERVALU_GATEWAY_STOREFRONT_HEADERS: Record<string, string> = {
  Accept: "application/json",
  "User-Agent": SUPERVALU_GATEWAY_USER_AGENT,
  Origin: "https://shop.supervalu.ie",
  Referer: "https://shop.supervalu.ie",
  "X-Site-Host": "https://shop.supervalu.ie",
  "X-Shopping-Mode": "22222222-2222-2222-2222-222222222222",
};

export type SupervaluGatewaySearchResponse = {
  total?: number;
  count?: number;
  categoryName?: string;
  items?: SupervaluGatewayProduct[];
};

export async function fetchSupervaluGatewayJson(
  url: string,
  signal?: AbortSignal,
): Promise<SupervaluGatewaySearchResponse> {
  const response = await fetch(url, {
    headers: SUPERVALU_GATEWAY_STOREFRONT_HEADERS,
    cache: "no-store",
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) {
    throw new Error(`SuperValu gateway HTTP ${response.status} for ${url}`);
  }
  return (await response.json()) as SupervaluGatewaySearchResponse;
}

export async function fetchSupervaluGatewaySearch(input: {
  query: string;
  storeId?: string;
  take?: number;
  skip?: number;
  promotionsOnly?: boolean;
  signal?: AbortSignal;
}): Promise<SupervaluGatewayProduct[]> {
  const storeId = input.storeId ?? SUPERVALU_STOREFRONT_STORE_ID;
  const take = input.take ?? SUPERVALU_GATEWAY_PAGE_SIZE;
  const skip = input.skip ?? 0;
  const promoPart = input.promotionsOnly ? "&sort=ppfreq&fpromotions=True" : "";
  const url =
    `${SUPERVALU_GATEWAY_BASE}/stores/${encodeURIComponent(storeId)}/search` +
    `?q=${encodeURIComponent(input.query)}&take=${take}&skip=${skip}${promoPart}`;
  const payload = await fetchSupervaluGatewayJson(url, input.signal);
  return payload.items ?? [];
}
