"use client";

// The chat panel's agent for projects in the user's folder: runs in this tab
// with the user's own key for the chosen provider. Same ChatApi as the dev server's.

import type { ChatApi, ChatUsage, Stored } from "@/components/agent/chat-api";
import type { ConfigPayload } from "@/components/agent/connect-card";
import {
  getLocalAiSettings,
  keyRemembered,
  listProviderModels,
  localKey,
  maskKey,
  rankFor,
  saveLocalAiSettings,
  switchLocalModel,
} from "../ai";
import { BROWSER_PROVIDERS, DEFAULT_PROVIDER, browserProvider } from "../providers";
import { allUsage, getBudget, startOfMonth, total } from "../usage";
import { clearChat, loadChat } from "./history";
import { runLocalAgent, type LocalAgentEnv } from "./run";

export async function localConfigPayload(): Promise<ConfigPayload> {
  const settings = await getLocalAiSettings();
  const provider = browserProvider(settings?.provider ?? DEFAULT_PROVIDER);
  const [key, remembered] = await Promise.all([localKey(provider.id), keyRemembered(provider.id)]);
  return {
    config:
      key || settings?.model
        ? {
            preset: provider.id,
            baseUrl: provider.baseUrl,
            model: settings?.model ?? "",
            vision: settings?.vision ?? true,
            tools: true,
            hasKey: !!key,
            maskedKey: key ? maskKey(key) : null,
            keySource: remembered ? "agent" : null,
            needsKey: true,
            lastTest: settings?.lastTest ?? null,
          }
        : null,
    presets: BROWSER_PROVIDERS.map((p) => ({
      id: p.id,
      label: p.name,
      needsKey: true,
      keyHint: p.keyHint,
      docsUrl: p.keysUrl,
      baseUrl: p.baseUrl,
      editableBaseUrl: false,
    })),
    sharedKeys: [],
  };
}

async function chatUsage(projectId: string): Promise<ChatUsage> {
  const [all, budget] = await Promise.all([allUsage(), getBudget()]);
  const mine = all.filter((r) => r.projectId === projectId);
  const byTurn = new Map<string, typeof mine>();
  for (const r of mine) byTurn.set(r.turn, [...(byTurn.get(r.turn) ?? []), r]);
  const month = startOfMonth();
  return {
    chat: total(mine),
    turns: Object.fromEntries([...byTurn].map(([t, rs]) => [t, total(rs)])),
    monthCost: total(all.filter((r) => r.at >= month)).cost,
    budget: budget.monthlyUsd,
  };
}

export function localChatApi(env: LocalAgentEnv): ChatApi {
  return {
    local: true,
    config: localConfigPayload,
    history: async () => (await loadChat(env.projectId)) as Stored[],
    clear: () => clearChat(env.projectId),
    async run(body, onEvent, signal) {
      await runLocalAgent(env, body, { emit: onEvent, signal });
    },
    models: () => listProviderModels(),
    rank: rankFor,
    usage: () => chatUsage(env.projectId),
    async test() {
      const t0 = performance.now();
      const s = await getLocalAiSettings();
      try {
        const ids = await listProviderModels();
        const ok = !!s?.model && ids.includes(s.model);
        await saveLocalAiSettings({
          lastTest: { model: s?.model ?? "", ok, tools: true, vision: s?.vision ?? true, latencyMs: Math.round(performance.now() - t0), at: Date.now(), ...(ok ? {} : { error: "404 model not found" }) },
        });
      } catch (e) {
        await saveLocalAiSettings({
          lastTest: { model: s?.model ?? "", ok: false, tools: false, vision: false, latencyMs: 0, at: Date.now(), error: (e as Error).message },
        });
      }
    },
    switchModel: (m) => switchLocalModel(m.id, m.vision),
    imageUrl: (img) => (img.data ? `data:${img.mime};base64,${img.data}` : ""),
    clipFrameUrl: () => null,
  };
}
