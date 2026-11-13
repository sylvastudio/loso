// Estimated prices, USD per million tokens, for showing roughly what Loso has
// spent. ESTIMATES ONLY: the provider's own billing page is the source of
// truth (see BILLING_PAGES). Copied from each provider's published price page
// on 2026-11-13; standard tier, global routing, no batch discounts. A model
// that isn't listed here has no price: Loso shows its tokens only, never a
// guess. OpenRouter publishes per-model prices in its model list, so those
// come from there at the time of use (lib/local/ai.ts).

import type { TokenUsage } from "./types";

export const PRICES_CHECKED = "2026-11-13";

export interface Price {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  /** Over this many prompt tokens, every token in the request costs `long`'s rates. */
  longAbove?: number;
  long?: Omit<Price, "longAbove" | "long">;
}

const p = (input: number, output: number, cacheRead: number, cacheWrite = 0, long?: { above: number; rates: [number, number, number, number?] }): Price => ({
  input,
  output,
  cacheRead,
  cacheWrite,
  ...(long
    ? { longAbove: long.above, long: { input: long.rates[0], output: long.rates[1], cacheRead: long.rates[2], cacheWrite: long.rates[3] ?? 0 } }
    : {}),
});

// Anthropic: keyed "<family> <version>" (ids like claude-opus-5-5, claude-sonnet-4-5-20250929).
// Cache writes use the 5-minute rate.
const ANTHROPIC: Record<string, Price> = {
  "fable 5.2": p(8, 40, 0.2, 10),
  "mythos 5.2": p(8, 40, 0.2, 10),
  "fable 5.1": p(10, 50, 0.25, 12.5),
  "mythos 5.1": p(10, 50, 0.25, 12.5),
  "fable 5": p(10, 50, 1, 12.5),
  "mythos 5": p(10, 50, 1, 12.5),
  "opus 5.5": p(4, 20, 0.2, 5),
  "opus 5": p(5, 25, 0.5, 6.25),
  "opus 4.8": p(5, 25, 0.5, 6.25),
  "opus 4.7": p(5, 25, 0.5, 6.25),
  "opus 4.6": p(5, 25, 0.5, 6.25),
  "opus 4.5": p(5, 25, 0.5, 6.25),
  "opus 4.1": p(15, 75, 1.5, 18.75),
  "opus 4": p(15, 75, 1.5, 18.75),
  "sonnet 5.5": p(2, 10, 0.1, 2.5),
  "sonnet 5": p(2, 10, 0.2, 2.5),
  "sonnet 4.6": p(3, 15, 0.3, 3.75),
  "sonnet 4.5": p(3, 15, 0.3, 3.75),
  "sonnet 4": p(3, 15, 0.3, 3.75),
  "haiku 5.5": p(0.1, 0.5, 0.01, 0.125, { above: 100_000, rates: [0.5, 2.5, 0.05, 0.625] }),
  "haiku 4.5": p(1, 5, 0.1, 1.25),
};

const OPENAI: Record<string, Price> = {
  "gpt-6-astra": p(10, 50, 1),
  "gpt-6.1-sol": p(2, 10, 0.1),
  "gpt-6.1-terra": p(1, 5, 0.05),
  "gpt-6-luna": p(0.1, 0.5, 0.01),
  "gpt-6-sol": p(2, 10, 0.2),
  "gpt-5.6-sol": p(4, 20, 0.4),
  "gpt-5.6-terra": p(2, 12, 0.2),
  "gpt-5.6-luna": p(0.2, 1.2, 0.02),
  "gpt-5.5": p(5, 30, 0.5),
  "gpt-5.4": p(2.5, 15, 0.25),
  "gpt-5.4-mini": p(0.75, 4.5, 0.075),
  "gpt-5.4-nano": p(0.2, 1.25, 0.02),
  "gpt-5.2": p(1.75, 14, 0.175),
  "gpt-5.1": p(1.25, 10, 0.125),
  "gpt-5": p(1.25, 10, 0.125),
  "gpt-5-mini": p(0.25, 2, 0.025),
  "gpt-5-nano": p(0.05, 0.4, 0.005),
  "gpt-4.1": p(2, 8, 0.5),
  "gpt-4.1-mini": p(0.4, 1.6, 0.1),
  "gpt-4o": p(2.5, 10, 1.25),
  "gpt-4o-mini": p(0.15, 0.6, 0.075),
  o3: p(2, 8, 0.5),
};

const XAI_LONG = (i: number, o: number, c: number) => p(i, o, c, 0, { above: 200_000, rates: [i * 2, o * 2, c * 2] });
const XAI: Record<string, Price> = {
  "grok-4.7": XAI_LONG(2, 6, 0.5),
  "grok-4.6": XAI_LONG(2, 6, 0.5),
  "grok-4.5": XAI_LONG(2, 6, 0.3),
  "grok-4.3": XAI_LONG(1.25, 2.5, 0.2),
  "grok-4.20-0309-reasoning": XAI_LONG(1.25, 2.5, 0.2),
  "grok-4.20-0309-non-reasoning": XAI_LONG(1.25, 2.5, 0.2),
  "grok-build-0.1": XAI_LONG(1, 2, 0.2),
};

// Groq lists cache prices for none of these; Llama models are "contact sales" (no price).
const GROQ: Record<string, Price> = {
  "openai/gpt-oss-120b": p(0.15, 0.6, 0.15),
  "openai/gpt-oss-20b": p(0.075, 0.3, 0.075),
  "qwen/qwen3.8-27b": p(0.8, 4, 0.8),
};

// Gemini: thinking is billed as output. Rates in force on the date above
// (some Gemini 4 / 3.8 rates rise on Dec 1, 2026 and Jan 1, 2027).
const GEMINI: Record<string, Price> = {
  "gemini-4-carbon": p(2, 10, 0.1),
  "gemini-4-argon": p(2, 10, 0.1),
  "gemini-4-hydrogen": p(1.5, 7.5, 0.075),
  "gemini-3.8-flash": p(0.75, 3.75, 0.075),
  "gemini-3.6-flash": p(0.75, 3.75, 0.075),
  "gemini-3.5-flash-lite": p(0.3, 2.5, 0.03),
  "gemini-3.1-flash-lite": p(0.25, 1.5, 0.025),
  "gemini-3.1-pro-preview": p(2, 12, 0.2, 0, { above: 200_000, rates: [4, 18, 0.4] }),
  "gemini-3.1-pro-preview-customtools": p(2, 12, 0.2, 0, { above: 200_000, rates: [4, 18, 0.4] }),
  "gemini-3-flash-preview": p(0.5, 3, 0.05),
  "gemini-2.5-pro": p(1.25, 10, 0.125, 0, { above: 200_000, rates: [2.5, 15, 0.25] }),
  "gemini-2.5-flash": p(0.3, 2.5, 0.03),
  "gemini-2.5-flash-lite": p(0.1, 0.4, 0.01),
};

function anthropicKey(model: string): string | null {
  const m = model.toLowerCase().match(/claude-([a-z]+)-(\d+)(?:-(\d))?(?:-\d{8})?$/);
  return m ? `${m[1]} ${m[2]}${m[3] ? `.${m[3]}` : ""}` : null;
}

/** Strip dated / pinned suffixes: gpt-4o-2024-08-06, gemini-2.5-flash-001, grok-4.7-latest. */
function baseId(model: string): string {
  return model.toLowerCase().replace(/-(\d{4}-\d{2}-\d{2}|\d{8}|\d{3}|latest)$/, "");
}

/** The published price for a model, or null when Loso doesn't know it. */
export function priceFor(provider: string, model: string): Price | null {
  const id = baseId(model);
  switch (provider) {
    case "anthropic": {
      const k = anthropicKey(model);
      return (k && ANTHROPIC[k]) || null;
    }
    case "openai":
      return OPENAI[id] ?? null;
    case "xai":
      return XAI[id] ?? null;
    case "groq":
      return GROQ[id] ?? null;
    case "gemini":
      return GEMINI[id] ?? null;
    default:
      return null;
  }
}

/** Estimated USD for one call. */
export function costOf(price: Price, u: TokenUsage): number {
  const prompt = u.input + u.cacheRead + u.cacheWrite;
  const r = price.long && price.longAbove !== undefined && prompt > price.longAbove ? price.long : price;
  return (u.input * r.input + u.output * r.output + u.cacheRead * r.cacheRead + u.cacheWrite * r.cacheWrite) / 1e6;
}

/** Where each provider shows what you were really billed. */
export const BILLING_PAGES: Record<string, { label: string; url: string }> = {
  anthropic: { label: "Claude Console usage", url: "https://console.anthropic.com/usage" },
  openai: { label: "OpenAI usage", url: "https://platform.openai.com/usage" },
  xai: { label: "xAI console", url: "https://console.x.ai" },
  groq: { label: "Groq usage", url: "https://console.groq.com/dashboard/usage" },
  gemini: { label: "Google AI Studio usage", url: "https://aistudio.google.com/usage" },
  openrouter: { label: "OpenRouter activity", url: "https://openrouter.ai/activity" },
};
