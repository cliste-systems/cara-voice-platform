// @ts-nocheck -- generated source is checked by the app build and catalogue tests.
// Generated from cara-platform by scripts/sync-catalogue-runtime.py. Do not edit.
const COMPARISON_WORDS = /\b(?:least[ -]expensive|lowest(?:[ -]priced?)?|best\s+(?:price|value)|cheap(?:est)?|budget)\b/gi;

export function queryRequestsLowestPrice(query: string): boolean {
  return new RegExp(COMPARISON_WORDS.source, "i").test(query);
}

/** Comparison instructions are not part of the product name or promotion mechanic. */
export function stripPriceComparisonWords(query: string): string {
  return query.replace(COMPARISON_WORDS, " ").replace(/\s{2,}/g, " ").trim();
}

export type RetailPriceBasis = "pack" | "per_kilo" | "counter_unknown";
