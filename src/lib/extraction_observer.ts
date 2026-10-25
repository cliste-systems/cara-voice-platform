export type ExtractionCategory = 'prompt_request' | 'instruction_override' | 'credential_request' | 'tool_schema_request';
const patterns: Array<[ExtractionCategory, RegExp]> = [
  ['prompt_request', /\b(?:repeat|reveal|print|show|read|recite|dump|give)\b.{0,70}\b(?:system prompt|hidden (?:prompt|instructions)|developer (?:prompt|instructions)|internal (?:prompt|instructions|configuration))\b/i],
  ['instruction_override', /\b(?:ignore|disregard|override|forget)\b.{0,35}\b(?:previous|prior|system|developer|all)\s+(?:instructions|prompts|rules)\b/i],
  ['credential_request', /\b(?:reveal|show|print|read|give|tell|dump)\b.{0,60}\b(?:api keys?|service[- ]role keys?|secret keys?|database passwords?|connection strings?)\b/i],
  ['tool_schema_request', /\b(?:list|show|dump|reveal|print|read)\b.{0,45}\b(?:tool schemas?|function schemas?|internal tool (?:definitions|schemas))\b/i],
];

/** Observation only. Store categories/counts, never retain or emit the caller's words. */
export function createExtractionObserver() {
  const counts = new Map<ExtractionCategory, number>();
  const emittedEight = new Set<ExtractionCategory>();
  return (text: string): Array<{ category: ExtractionCategory; attempts: number; repeated: boolean }> => {
    const bounded = text.normalize('NFKC').slice(0, 6000);
    const observations = [];
    for (const [category, pattern] of patterns) {
      if (!pattern.test(bounded)) continue;
      const attempts = Math.min((counts.get(category) ?? 0) + 1, 8);
      counts.set(category, attempts);
      // Bound telemetry: first observation, repeated behaviour, and sustained attempts.
      if (attempts === 1 || attempts === 3 || (attempts === 8 && !emittedEight.has(category))) {
        if (attempts === 8) emittedEight.add(category);
        observations.push({ category, attempts, repeated: attempts >= 3 });
      }
    }
    return observations;
  };
}
