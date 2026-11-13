// The browser-only app's AI setup: the user's own Claude key, called straight
// from this tab (no Loso server). The key lives in memory by default and is
// written to IndexedDB only if the user ticks "Remember on this computer".
// It is never put in a .loso file, a URL, an export or a log.

import { anthropicAdapter } from "../ai/anthropic";
import { pickDefaultModel, rankModels } from "../ai/models";
import type { AiConfig } from "../ai/types";
import { idbDelete, idbGet, idbPut } from "./db";

export const LOCAL_AI_CHANGED = "loso:ai-config-changed";

export interface LocalAiSettings {
  model: string;
  vision: boolean;
  lastTest: { model: string; ok: boolean; tools: boolean; vision: boolean; error?: string; latencyMs: number; at: number } | null;
}

const SETTINGS_KEY = "ai";
const SECRET_KEY = "anthropic";

let memoryKey: string | null = null;

function announce() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(LOCAL_AI_CHANGED));
}

/** The key for this tab: in memory, or remembered on this computer. */
export async function localKey(): Promise<string | null> {
  if (memoryKey) return memoryKey;
  try {
    memoryKey = (await idbGet<string>("secrets", SECRET_KEY)) ?? null;
  } catch {
    memoryKey = null;
  }
  return memoryKey;
}

export async function keyRemembered(): Promise<boolean> {
  try {
    return !!(await idbGet<string>("secrets", SECRET_KEY));
  } catch {
    return false;
  }
}

export function maskKey(key: string): string {
  return `…${key.slice(-4)}`;
}

export async function getLocalAiSettings(): Promise<LocalAiSettings | null> {
  try {
    return (await idbGet<LocalAiSettings>("settings", SETTINGS_KEY)) ?? null;
  } catch {
    return null;
  }
}

export async function saveLocalAiSettings(patch: Partial<LocalAiSettings>): Promise<LocalAiSettings> {
  const cur = (await getLocalAiSettings()) ?? { model: "", vision: true, lastTest: null };
  const next = { ...cur, ...patch };
  await idbPut("settings", SETTINGS_KEY, next);
  announce();
  return next;
}

/** Use this key from now on; `remember` also keeps it on this computer. */
export async function setLocalKey(key: string, remember: boolean) {
  memoryKey = key.trim();
  if (remember) await idbPut("secrets", SECRET_KEY, memoryKey);
  else await idbDelete("secrets", SECRET_KEY).catch(() => {});
  announce();
}

/** Forget the key everywhere (memory and this computer). */
export async function forgetLocalKey() {
  memoryKey = null;
  await idbDelete("secrets", SECRET_KEY).catch(() => {});
  await saveLocalAiSettings({ lastTest: null });
}

function config(key: string, settings: Pick<LocalAiSettings, "model" | "vision">): AiConfig {
  return {
    preset: "anthropic",
    kind: "anthropic",
    baseUrl: "https://api.anthropic.com",
    model: settings.model,
    apiKey: key,
    vision: settings.vision,
    tools: true,
    transcription: "local",
  };
}

/** Everything the agent needs to call Claude, or null when there's no key or model yet. */
export async function localAiConfig(): Promise<AiConfig | null> {
  const [key, settings] = await Promise.all([localKey(), getLocalAiSettings()]);
  if (!key || !settings?.model) return null;
  return config(key, settings);
}

/** The model ids this key can use. Free, so it doubles as the key check. */
export async function listClaudeModels(key?: string): Promise<string[]> {
  const k = key ?? (await localKey());
  if (!k) throw new Error("No Claude key yet.");
  return anthropicAdapter.listModels(config(k, { model: "", vision: true }));
}

/** Check a key, pick the best model if none is chosen, and remember the result. */
export async function connectLocalKey(key: string, remember: boolean, model?: string): Promise<LocalAiSettings> {
  const t0 = performance.now();
  const ids = await listClaudeModels(key);
  const cur = await getLocalAiSettings();
  const chosen = model || pickDefaultModel(ids, cur?.model);
  if (!chosen) throw new Error("This key can't use any Claude models.");
  const vision = rankModels([chosen]).chat[0]?.vision ?? true;
  await setLocalKey(key, remember);
  return saveLocalAiSettings({
    model: chosen,
    vision,
    lastTest: { model: chosen, ok: true, tools: true, vision, latencyMs: Math.round(performance.now() - t0), at: Date.now() },
  });
}

export async function switchLocalModel(model: string, vision: boolean) {
  await saveLocalAiSettings({ model, vision, lastTest: null });
}
