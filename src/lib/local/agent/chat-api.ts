"use client";

// The chat panel's agent for projects in the user's folder: runs in this tab
// with the user's own Claude key. Same ChatApi as the dev server's.

import type { ChatApi, Stored } from "@/components/agent/chat-api";
import type { ConfigPayload } from "@/components/agent/connect-card";
import { getPreset } from "@/lib/ai/presets";
import { getLocalAiSettings, keyRemembered, listClaudeModels, localKey, maskKey, saveLocalAiSettings, switchLocalModel } from "../ai";
import { clearChat, loadChat } from "./history";
import { runLocalAgent, type LocalAgentEnv } from "./run";

export async function localConfigPayload(): Promise<ConfigPayload> {
  const [key, settings, remembered] = await Promise.all([localKey(), getLocalAiSettings(), keyRemembered()]);
  const preset = getPreset("anthropic");
  return {
    config:
      key || settings?.model
        ? {
            preset: "anthropic",
            baseUrl: preset?.baseUrl ?? "https://api.anthropic.com",
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
    presets: preset
      ? [{ id: preset.id, label: preset.label, needsKey: true, keyHint: preset.keyHint, docsUrl: preset.docsUrl, baseUrl: preset.baseUrl, editableBaseUrl: false }]
      : [],
    sharedKeys: [],
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
    models: () => listClaudeModels(),
    async test() {
      const t0 = performance.now();
      const s = await getLocalAiSettings();
      try {
        const ids = await listClaudeModels();
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
