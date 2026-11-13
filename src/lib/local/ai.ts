// The browser-only app's AI setup: the user's own key for one of the
// providers in ./providers, called straight from this tab (no Loso server).
// Keys are per provider. By default a key lasts as long as the tab
// (sessionStorage, so a reload keeps it: iPhones reload tabs that run low on
// memory) and is gone when the tab closes. It is written to IndexedDB only if
// the user ticks "Remember on this computer". A key is never put in a .loso
// file, a URL, an export or a log.

import { anthropicAdapter } from "../ai/anthropic";
import { geminiAdapter } from "../ai/gemini";
import { providerFetch } from "../ai/http";
import { canCallTools, pickDefaultModel, rankModels, type RankedModel } from "../ai/models";
import { openaiAdapter } from "../ai/openai";
import type { Price } from "../ai/prices";
import type { AiConfig, ChatAdapter } from "../ai/types";
import { idbDelete, idbGet, idbPut } from "./db";
import { BROWSER_PROVIDERS, DEFAULT_PROVIDER, browserProvider, type BrowserProviderId } from "./providers";

export const LOCAL_AI_CHANGED = "loso:ai-config-changed";

export interface LocalAiSettings {
  provider: BrowserProviderId;
  model: string;
  vision: boolean;
  lastTest: { model: string; ok: boolean; tools: boolean; vision: boolean; error?: string; latencyMs: number; at: number } | null;
}

const SETTINGS_KEY = "ai";

// Secrets are keyed by provider id ("anthropic" is the key saved before other providers existed).
const memoryKeys = new Map<BrowserProviderId, string>();

const tabKeyName = (p: BrowserProviderId) => `loso-key:${p}`;
function tabKey(p: BrowserProviderId): string | null {
  try {
    return sessionStorage.getItem(tabKeyName(p));
  } catch {
    return null;
  }
}
function setTabKey(p: BrowserProviderId, key: string | null) {
  try {
    if (key) sessionStorage.setItem(tabKeyName(p), key);
    else sessionStorage.removeItem(tabKeyName(p));
  } catch {
    /* storage blocked: the key lives in memory only */
  }
}

function announce() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(LOCAL_AI_CHANGED));
}

export function adapterFor(kind: AiConfig["kind"]): ChatAdapter {
  return kind === "anthropic" ? anthropicAdapter : kind === "gemini" ? geminiAdapter : openaiAdapter;
}

export async function getLocalAiSettings(): Promise<LocalAiSettings | null> {
  try {
    const s = await idbGet<Partial<LocalAiSettings>>("settings", SETTINGS_KEY);
    return s ? { model: "", vision: true, lastTest: null, ...s, provider: browserProvider(s.provider).id } : null;
  } catch {
    return null;
  }
}

async function currentProvider(): Promise<BrowserProviderId> {
  return (await getLocalAiSettings())?.provider ?? DEFAULT_PROVIDER;
}

export async function saveLocalAiSettings(patch: Partial<LocalAiSettings>): Promise<LocalAiSettings> {
  const cur = (await getLocalAiSettings()) ?? { provider: DEFAULT_PROVIDER, model: "", vision: true, lastTest: null };
  const next = { ...cur, ...patch };
  await idbPut("settings", SETTINGS_KEY, next);
  announce();
  return next;
}

/** A provider's key for this tab (default: the provider in use): for this tab, or remembered on this computer. */
export async function localKey(provider?: BrowserProviderId): Promise<string | null> {
  const p = provider ?? (await currentProvider());
  const mem = memoryKeys.get(p) ?? tabKey(p);
  if (mem) {
    memoryKeys.set(p, mem);
    return mem;
  }
  try {
    const saved = await idbGet<string>("secrets", p);
    if (saved) memoryKeys.set(p, saved);
    return saved ?? null;
  } catch {
    return null;
  }
}

export async function keyRemembered(provider?: BrowserProviderId): Promise<boolean> {
  try {
    return !!(await idbGet<string>("secrets", provider ?? (await currentProvider())));
  } catch {
    return false;
  }
}

/** Which providers have a key right now (to mark them in the picker). */
export async function providersWithKeys(): Promise<Set<BrowserProviderId>> {
  const have = await Promise.all(BROWSER_PROVIDERS.map(async (p) => ((await localKey(p.id)) ? p.id : null)));
  return new Set(have.filter((x): x is BrowserProviderId => !!x));
}

export function maskKey(key: string): string {
  return `…${key.slice(-4)}`;
}

/** Use this key for a provider from now on; `remember` also keeps it on this computer. */
export async function setLocalKey(provider: BrowserProviderId, key: string, remember: boolean) {
  memoryKeys.set(provider, key.trim());
  setTabKey(provider, key.trim());
  if (remember) await idbPut("secrets", provider, key.trim());
  else await idbDelete("secrets", provider).catch(() => {});
  announce();
}

/** Forget a provider's key everywhere (memory and this computer). */
export async function forgetLocalKey(provider: BrowserProviderId) {
  memoryKeys.delete(provider);
  setTabKey(provider, null);
  await idbDelete("secrets", provider).catch(() => {});
  if ((await currentProvider()) === provider) await saveLocalAiSettings({ lastTest: null });
  else announce();
}

function config(provider: BrowserProviderId, key: string, settings: Pick<LocalAiSettings, "model" | "vision">): AiConfig {
  const p = browserProvider(provider);
  return {
    preset: p.id,
    kind: p.kind,
    baseUrl: p.baseUrl,
    model: settings.model,
    apiKey: key,
    vision: settings.vision,
    tools: true,
    transcription: "local",
  };
}

/** Everything the agent needs to call the chosen model, or null when there's no key or model yet. */
export async function localAiConfig(): Promise<AiConfig | null> {
  const settings = await getLocalAiSettings();
  const provider = settings?.provider ?? DEFAULT_PROVIDER;
  const key = await localKey(provider);
  if (!key || !settings?.model) return null;
  return config(provider, key, settings);
}

// OpenRouter says per model whether it takes tools and pictures, and its price.
interface OpenRouterModel {
  id: string;
  supported_parameters?: string[];
  architecture?: { input_modalities?: string[] };
  pricing?: { prompt?: string; completion?: string; input_cache_read?: string; input_cache_write?: string };
}
const openRouterInfo = new Map<string, { vision: boolean; price: Price | null }>();

function perMillion(v: string | undefined): number | null {
  const n = Number(v);
  return v !== undefined && Number.isFinite(n) && n >= 0 ? n * 1e6 : null;
}

async function openRouterModels(key: string): Promise<string[]> {
  const base = browserProvider("openrouter").baseUrl;
  const headers = { Authorization: `Bearer ${key}` };
  // The model list is public, so check the key itself first.
  await providerFetch("OpenRouter", `${base}/key`, { method: "GET", headers }, 20_000);
  const data = (await providerFetch("OpenRouter", `${base}/models`, { method: "GET", headers }, 20_000)) as { data?: OpenRouterModel[] };
  const ids: string[] = [];
  for (const m of data.data ?? []) {
    if (!m.id || !(m.supported_parameters ?? []).includes("tools")) continue;
    const input = perMillion(m.pricing?.prompt);
    const output = perMillion(m.pricing?.completion);
    openRouterInfo.set(m.id, {
      vision: (m.architecture?.input_modalities ?? []).includes("image"),
      price:
        input !== null && output !== null
          ? { input, output, cacheRead: perMillion(m.pricing?.input_cache_read) ?? input, cacheWrite: perMillion(m.pricing?.input_cache_write) ?? input }
          : null,
    });
    ids.push(m.id);
  }
  return ids.sort();
}

/** OpenRouter's own published price for a model (from the last model list), if known. */
export function openRouterPrice(model: string): Price | null {
  return openRouterInfo.get(model)?.price ?? null;
}

/**
 * The models this key can use that can drive Loso's tools. Listing models is
 * free, so it doubles as the key check (a wrong key throws "… 401: …").
 */
export async function listProviderModels(provider?: BrowserProviderId, key?: string): Promise<string[]> {
  const p = provider ?? (await currentProvider());
  const k = key ?? (await localKey(p));
  if (!k) throw new Error(`No ${browserProvider(p).name} key yet.`);
  if (p === "openrouter") return openRouterModels(k);
  const ids = await adapterFor(browserProvider(p).kind).listModels(config(p, k, { model: "", vision: true }));
  return ids.filter(canCallTools);
}

/** Ranked for the picker, with what the provider itself says about pictures where it says it. */
export function rankFor(ids: string[]): RankedModel[] {
  return rankModels(ids).chat.map((m) => {
    const info = openRouterInfo.get(m.id);
    return info ? { ...m, vision: info.vision } : m;
  });
}

/** Check a key, pick the best model if none is chosen, and switch to this provider. */
export async function connectLocalKey(provider: BrowserProviderId, key: string, remember: boolean, model?: string): Promise<LocalAiSettings> {
  const t0 = performance.now();
  const ids = await listProviderModels(provider, key);
  const cur = await getLocalAiSettings();
  const chosen = model || pickDefaultModel(ids, cur?.provider === provider ? cur.model : undefined);
  if (!chosen) throw new Error(`This key can't use any ${browserProvider(provider).name} models that can edit videos.`);
  const vision = rankFor([chosen])[0]?.vision ?? false;
  await setLocalKey(provider, key, remember);
  return saveLocalAiSettings({
    provider,
    model: chosen,
    vision,
    lastTest: { model: chosen, ok: true, tools: true, vision, latencyMs: Math.round(performance.now() - t0), at: Date.now() },
  });
}

export async function switchLocalModel(model: string, vision: boolean, provider?: BrowserProviderId) {
  await saveLocalAiSettings({ model, vision, lastTest: null, ...(provider ? { provider } : {}) });
}
