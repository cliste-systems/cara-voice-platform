// @ts-nocheck -- generated source is checked by the app build and catalogue tests.
// Generated from cara-platform by scripts/sync-catalogue-runtime.py. Do not edit.
const ONES = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
] as const;

const TENS = [
  "",
  "",
  "twenty",
  "thirty",
  "forty",
  "fifty",
  "sixty",
  "seventy",
  "eighty",
  "ninety",
] as const;

/** 0–999 for grocery prices — e.g. 79 → "seventy-nine", 4 → "four". */
export function formatSpokenInteger(value: number): string {
  const n = Math.round(value);
  if (!Number.isFinite(n) || n < 0) return String(value);
  if (n < 20) return ONES[n] ?? String(n);
  if (n < 100) {
    const tens = Math.floor(n / 10);
    const ones = n % 10;
    return ones === 0 ? TENS[tens]! : `${TENS[tens]!} ${ONES[ones]!}`;
  }
  if (n < 1000) {
    const hundreds = Math.floor(n / 100);
    const rest = n % 100;
    if (rest === 0) return `${ONES[hundreds]!} hundred`;
    return `${ONES[hundreds]!} hundred ${formatSpokenInteger(rest)}`;
  }
  return String(n);
}

/** Spoken Irish retail price — e.g. 4.79 → "four euro seventy nine". */
export function formatSpokenEurAmount(amountEur: number): string {
  const normalized = Math.round(amountEur * 100) / 100;
  const euros = Math.floor(normalized);
  const cents = Math.round((normalized - euros) * 100);

  if (cents === 0) {
    return `${formatSpokenInteger(euros)} euro`;
  }
  if (euros === 0) {
    return cents === 1 ? "one cent" : `${formatSpokenInteger(cents)} cents`;
  }
  return `${formatSpokenInteger(euros)} euro ${formatSpokenInteger(cents)}`;
}

/** Replace € amounts and per-unit labels with spoken words for phone quotes. */
export function speakEmbeddedEurAmounts(text: string): string {
  let out = text.replace(
    /€\s*(\d+(?:[.,]\d{1,2})?)\s*\/\s*(kg|g|l|ml|each|unit)/gi,
    (_, amount: string, unit: string) => {
      const parsed = Number(amount.replace(",", "."));
      if (!Number.isFinite(parsed)) return text;
      const unitWord =
        unit.toLowerCase() === "kg"
          ? "kilo"
          : unit.toLowerCase() === "g"
            ? "gram"
            : unit.toLowerCase() === "l"
              ? "litre"
              : unit.toLowerCase() === "ml"
                ? "millilitre"
                : unit.toLowerCase();
      return `${formatSpokenEurAmount(parsed)} per ${unitWord}`;
    },
  );

  out = out.replace(/€\s*(\d+(?:[.,]\d{1,2})?)/g, (_, amount: string) => {
    const parsed = Number(amount.replace(",", "."));
    return Number.isFinite(parsed) ? formatSpokenEurAmount(parsed) : amount;
  });

  out = out.replace(/\b(\d{1,2})\s*c\b/gi, (_, cents: string) => {
    const parsed = Number(cents);
    if (!Number.isFinite(parsed)) return `${cents}c`;
    return parsed === 1 ? "one cent" : `${formatSpokenInteger(parsed)} cents`;
  });

  return out;
}

/** Spoken offer label — e.g. "Only €4" → "only four euro", "3 for €10" → "three for ten euro". */
export function formatSpokenDiscountLabel(label: string | null | undefined): string | null {
  const trimmed = String(label ?? "").trim();
  if (!trimmed) return null;

  let out = trimmed.replace(/\b(?:bogof|bogo)\b/gi, "buy one get one free")
    .replace(/\bmix\s*(?:&|and)\s*match\b/gi, "mix and match")
    .replace(/\b(buy|get)[ -]+(\d+)\b/gi, (_, word: string, count: string) => `${word} ${formatSpokenInteger(Number(count))}`)
    .replace(
    /(\d+)\s+for\s+(?:€\s*)?(\d+(?:[.,]\d{1,2})?)/gi,
    (_, count: string, amount: string) => {
      const parsed = Number(amount.replace(",", "."));
      return Number.isFinite(parsed)
        ? `${formatSpokenInteger(Number(count))} for ${formatSpokenEurAmount(parsed)}`
        : `${count} for ${amount}`;
    },
  );

  out = speakEmbeddedEurAmounts(out);
  return out;
}
