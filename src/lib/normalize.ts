// Speech normalization: expand money, numbers, and percentages into words so the
// TTS reads them naturally. Applied to a COPY of the script for synthesis only —
// the stored script is never mutated.

const ONES = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
  "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen",
  "seventeen", "eighteen", "nineteen",
];
const TENS = [
  "", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety",
];
const SCALES: Array<[number, string]> = [
  [1_000_000_000_000, "trillion"],
  [1_000_000_000, "billion"],
  [1_000_000, "million"],
  [1_000, "thousand"],
];

export function integerToWords(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  if (n < 0) return `minus ${integerToWords(-n)}`;
  if (n < 20) return ONES[n];
  if (n < 100) {
    const t = Math.floor(n / 10);
    const r = n % 10;
    return r ? `${TENS[t]}-${ONES[r]}` : TENS[t];
  }
  if (n < 1000) {
    const h = Math.floor(n / 100);
    const r = n % 100;
    return r ? `${ONES[h]} hundred and ${integerToWords(r)}` : `${ONES[h]} hundred`;
  }
  for (const [scale, name] of SCALES) {
    if (n >= scale) {
      const major = Math.floor(n / scale);
      const r = n % scale;
      const rest = r
        ? r < 100
          ? ` and ${integerToWords(r)}`
          : ` ${integerToWords(r)}`
        : "";
      return `${integerToWords(major)} ${name}${rest}`;
    }
  }
  return String(n);
}

function digitsToWords(digits: string): string {
  return [...digits].map((d) => ONES[Number(d)]).join(" ");
}

/** 1998 → "nineteen ninety-eight", 2024 → "twenty twenty-four", 2000 → "two thousand" */
function yearToWords(n: number): string {
  const high = Math.floor(n / 100);
  const low = n % 100;
  if (low === 0) {
    if (high % 10 === 0) return integerToWords(n);
    return `${integerToWords(high)} hundred`;
  }
  if (low < 10) return `${integerToWords(high)} oh ${ONES[low]}`;
  return `${integerToWords(high)} ${integerToWords(low)}`;
}

function decimalToWords(intPart: string, fracPart: string): string {
  return `${integerToWords(Number(intPart))} point ${digitsToWords(fracPart)}`;
}

function moneyToWords(intPart: string, cents: string | undefined, scaleWord?: string): string {
  const amount = Number(intPart.replace(/,/g, ""));
  if (scaleWord) {
    // "$1.2 million" → "one point two million dollars"
    return `${cents ? decimalToWords(intPart.replace(/,/g, ""), cents) : integerToWords(amount)} ${scaleWord} dollars`;
  }
  const dollars = `${integerToWords(amount)} ${amount === 1 ? "dollar" : "dollars"}`;
  if (cents && Number(cents) > 0) {
    const c = Number(cents.length === 1 ? cents + "0" : cents);
    return `${dollars} and ${integerToWords(c)} ${c === 1 ? "cent" : "cents"}`;
  }
  return dollars;
}

export interface PronunciationEntry {
  match: string;
  replacement: string;
}

export function applyPronunciations(text: string, entries: PronunciationEntry[]): string {
  let out = text;
  for (const { match, replacement } of entries) {
    if (!match.trim()) continue;
    const escaped = match.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(`(?<![\\w])${escaped}(?![\\w])`, "g"), replacement);
  }
  return out;
}

const SCALE_WORDS = "(million|billion|trillion|thousand)";
// Strict number: either comma-separated thousands (1,200) or a plain digit run —
// never consumes a trailing comma that is just punctuation.
const NUM = "(\\d{1,3}(?:,\\d{3})+|\\d+)";

export function normalizeForSpeech(script: string, dict: PronunciationEntry[] = []): string {
  let t = applyPronunciations(script, dict);

  // $1.2 million / $5 billion
  t = t.replace(
    new RegExp(`\\$\\s?${NUM}(?:\\.(\\d+))?\\s?${SCALE_WORDS}`, "gi"),
    (_m, i: string, f: string | undefined, scale: string) =>
      moneyToWords(i.replace(/,/g, ""), f, scale.toLowerCase())
  );
  // $5.08 / $1,000
  t = t.replace(
    new RegExp(`\\$\\s?${NUM}(?:\\.(\\d{1,2}))?`, "g"),
    (_m, i: string, c: string | undefined) => moneyToWords(i.replace(/,/g, ""), c)
  );
  // 75% / 3.5%
  t = t.replace(
    new RegExp(`${NUM}(?:\\.(\\d+))?\\s?%`, "g"),
    (_m, i: string, f: string | undefined) => {
      const int = i.replace(/,/g, "");
      return `${f ? decimalToWords(int, f) : integerToWords(Number(int))} percent`;
    }
  );
  // Years: standalone 1100–2099 (allowed to be followed by plain punctuation)
  t = t.replace(/(?<![\d.,])((?:1[1-9]|20)\d{2})(?!\d|,\d|\.\d|%)/g, (_m, y: string) =>
    yearToWords(Number(y))
  );
  // Decimals: 3.5
  t = t.replace(/(?<![\d.,])(\d+)\.(\d+)(?!\d|%)/g, (_m, i: string, f: string) =>
    decimalToWords(i, f)
  );
  // Plain integers (with optional thousands separators)
  t = t.replace(
    new RegExp(`(?<![\\d.,\\w])${NUM}(?!\\d|,\\d|\\.\\d|%|\\w)`, "g"),
    (_m, i: string) => integerToWords(Number(i.replace(/,/g, "")))
  );
  // Collapse whitespace introduced by replacements
  return t.replace(/[ \t]+/g, " ").replace(/ \n/g, "\n").trim();
}

// Per-model billed-character caps (verified against ElevenLabs docs, Jul 2026).
export const MODEL_CHAR_LIMITS: Record<string, number> = {
  eleven_v3: 5000,
  eleven_multilingual_v2: 10000,
};

export const DEFAULT_TTS_MODEL = "eleven_v3";
