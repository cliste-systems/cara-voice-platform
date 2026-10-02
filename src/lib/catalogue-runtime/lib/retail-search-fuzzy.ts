// @ts-nocheck -- generated source is checked by the app build and catalogue tests.
// Generated from cara-platform by scripts/sync-catalogue-runtime.py. Do not edit.
import { normalizeSearchText } from "./supervalu-offers-normalize.js";

export function normalizedRetailSearchToken(value: string): string {
  const token = normalizeSearchText(value).replace(/[^a-z0-9]/g, "");
  if (token.length > 4 && token.endsWith("s")) return token.slice(0, -1);
  return token;
}

export function retailSearchQueryTokens(query: string): string[] {
  const normalized = normalizeSearchText(query);
  const tokens = normalized
    .split(/\s+/)
    .map(normalizedRetailSearchToken)
    .filter((token) => token.length >= 2);

  return [...new Set(tokens)];
}

/**
 * Broad, safe candidate fragments for database pre-filtering.
 * Final relevance is decided by retailSearchTextScore, so these can be
 * intentionally forgiving of punctuation and a small spelling mistake.
 */
export function retailSearchCandidateTerms(query: string): string[] {
  const tokens = retailSearchQueryTokens(query);
  const out = new Set<string>();

  for (const token of tokens) {
    if (/^\d+$/.test(token)) {
      out.add(token);
      continue;
    }

    out.add(token);
    if (token.length >= 5) out.add(token.slice(0, 3));
  }

  return [...out].slice(0, 8);
}

function boundedEditDistance(a: string, b: string, maxDistance: number): number {
  if (Math.abs(a.length - b.length) > maxDistance) return maxDistance + 1;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);

  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    let rowMin = current[0]!;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const value = Math.min(
        previous[j]! + 1,
        current[j - 1]! + 1,
        previous[j - 1]! + cost,
      );
      current[j] = value;
      rowMin = Math.min(rowMin, value);
    }
    if (rowMin > maxDistance) return maxDistance + 1;
    previous = current;
  }

  return previous[b.length]!;
}

/**
 * Voice-friendly product-token similarity. Exact/stem matches score 1.
 * Minor STT spelling slips are accepted without hardcoded product aliases.
 */
export function retailSearchTokenSimilarity(text: string, token: string): number {
  const normalizedText = normalizeSearchText(text);
  const compactText = normalizedText.replace(/[^a-z0-9]/g, "");
  const query = normalizedRetailSearchToken(token);
  if (!query) return 0;
  if (normalizedText.includes(query) || compactText.includes(query)) return 1;
  if (query.length < 5) return 0;

  const maxDistance = query.length >= 5 ? 2 : 1;
  const words = normalizedText
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map(normalizedRetailSearchToken)
    .filter(Boolean);

  let best = 0;
  for (const word of words) {
    if (word.length < 5) continue;
    const distance = boundedEditDistance(query, word, maxDistance);
    if (distance > maxDistance) continue;
    best = Math.max(best, 1 - distance / Math.max(query.length, word.length));
  }
  return best >= 0.68 ? best : 0;
}

export function retailSearchTokenMatchesText(text: string, token: string): boolean {
  return retailSearchTokenSimilarity(text, token) > 0;
}

/**
 * Score a complete user query against searchable product text.
 * Every meaningful token must match, which keeps typo tolerance from turning
 * into unrelated catalogue results.
 */
export function retailSearchTextScore(text: string, query: string): number {
  const tokens = retailSearchQueryTokens(query);
  if (tokens.length === 0) return 0;

  const scores = tokens.map((token) => retailSearchTokenSimilarity(text, token));
  if (scores.some((score) => score <= 0)) return 0;

  const average = scores.reduce((sum, score) => sum + score, 0) / scores.length;
  const normalizedText = normalizeSearchText(text);
  const normalizedQuery = normalizeSearchText(query);
  const compactText = normalizedText.replace(/[^a-z0-9]/g, "");
  const compactQuery = normalizedQuery.replace(/[^a-z0-9]/g, "");

  const exactPhrase =
    (normalizedQuery && normalizedText.includes(normalizedQuery)) ||
    (compactQuery.length >= 3 && compactText.includes(compactQuery));

  return average + (exactPhrase ? 0.25 : 0);
}
