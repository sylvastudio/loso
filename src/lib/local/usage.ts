// What the AI has used, kept in this browser only (IndexedDB "usage", one
// record per model call). Never sent anywhere. Costs are estimates from
// lib/ai/prices.ts, worked out when the call happens; the provider's own
// billing page is the source of truth.

import { costOf, priceFor } from "../ai/prices";
import type { TokenUsage } from "../ai/types";
import { idbAll, idbClear, idbGet, idbPut } from "./db";
import { openRouterPrice } from "./ai";

export const USAGE_CHANGED = "loso:usage-changed";

export interface UsageRecord extends TokenUsage {
  provider: string;
  model: string;
  at: number;
  projectId: string;
  turn: string;
  /** Estimated USD, or null when the model's price isn't known. */
  cost: number | null;
}

export interface UsageTotals {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  calls: number;
  /** Sum of the calls with a known price. */
  cost: number;
  /** Calls whose price isn't known (their tokens are counted, their cost isn't). */
  unpriced: number;
}

export interface UsageBudget {
  /** A soft monthly limit in USD; null = none. */
  monthlyUsd: number | null;
  /** Stop starting new requests once this month's estimate passes the limit. Off unless the user turns it on. */
  stopAtLimit: boolean;
}

const BUDGET_KEY = "usage-budget";

function announce() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(USAGE_CHANGED));
}

export async function recordUsage(r: Omit<UsageRecord, "cost">): Promise<UsageRecord> {
  const price = r.provider === "openrouter" ? openRouterPrice(r.model) : priceFor(r.provider, r.model);
  const rec: UsageRecord = { ...r, cost: price ? costOf(price, r) : null };
  try {
    await idbPut("usage", `${r.at.toString(36)}-${Math.random().toString(36).slice(2, 8)}`, rec);
    announce();
  } catch {
    /* counting is best-effort: never break a turn over it */
  }
  return rec;
}

export async function allUsage(): Promise<UsageRecord[]> {
  try {
    return await idbAll<UsageRecord>("usage");
  } catch {
    return [];
  }
}

export async function clearUsage() {
  await idbClear("usage");
  announce();
}

export function total(records: UsageRecord[]): UsageTotals {
  const t: UsageTotals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, calls: 0, cost: 0, unpriced: 0 };
  for (const r of records) {
    t.input += r.input;
    t.output += r.output;
    t.cacheRead += r.cacheRead;
    t.cacheWrite += r.cacheWrite;
    t.calls++;
    if (r.cost === null) t.unpriced++;
    else t.cost += r.cost;
  }
  return t;
}

export function startOfToday(now = new Date()) {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}
/** Weeks start on Monday. */
export function startOfWeek(now = new Date()) {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
}
export function startOfMonth(now = new Date()) {
  return new Date(now.getFullYear(), now.getMonth(), 1).getTime();
}

export async function monthSpend(): Promise<UsageTotals> {
  const from = startOfMonth();
  return total((await allUsage()).filter((r) => r.at >= from));
}

export async function getBudget(): Promise<UsageBudget> {
  try {
    return (await idbGet<UsageBudget>("settings", BUDGET_KEY)) ?? { monthlyUsd: null, stopAtLimit: false };
  } catch {
    return { monthlyUsd: null, stopAtLimit: false };
  }
}

export async function saveBudget(b: UsageBudget) {
  await idbPut("settings", BUDGET_KEY, b);
  announce();
}
