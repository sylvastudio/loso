// Plain-words formatting for AI usage (tokens, estimated cost), in the
// reader's locale. Client-safe.

export interface CostSum {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  unpriced: number;
}

/** 48,213 → "48K" (locale-aware compact form). */
export function fmtTokens(n: number): string {
  return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

export function fmtTokensFull(n: number): string {
  return new Intl.NumberFormat().format(n);
}

/** USD, with more digits for tiny amounts so a few cents don't read as $0.00. */
export function fmtUsd(n: number): string {
  const digits = n > 0 && n < 0.01 ? 3 : 2;
  return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n);
}

/** All tokens read by the model (fresh + from cache). */
export const tokensIn = (s: CostSum) => s.input + s.cacheRead + s.cacheWrite;

/** "~$0.21", "~$0.21 + some with unknown price", or "price unknown". */
export function costText(s: CostSum): string {
  if (s.unpriced > 0 && s.cost === 0) return "price unknown";
  return `~${fmtUsd(s.cost)}${s.unpriced ? " + some with unknown price" : ""}`;
}

/** "48K tokens in · 3K out · ~$0.21" */
export function usageLine(s: CostSum): string {
  return `${fmtTokens(tokensIn(s))} tokens in · ${fmtTokens(s.output)} out · ${costText(s)}`;
}
