// Bring-your-own-model entry point: config persistence + provider dispatch.
// Server-only (touches the local database).
import "server-only";

import { getAiConfigRaw, getAiKey, setAiConfigRaw, setAiKey } from "@/lib/repo";
import { maskKey } from "@/lib/providers";
import type { AiConfig, ChatAdapter, ChatRequest, ChatResponse, ProviderKind, ProviderPresetId } from "./types";
import { PRESETS, getPreset, type ProviderPreset } from "./presets";
import { openaiAdapter } from "./openai";
import { anthropicAdapter } from "./anthropic";
import { geminiAdapter } from "./gemini";

export type * from "./types";
export { PRESETS, getPreset, type ProviderPreset };

const ADAPTERS: Record<ProviderKind, ChatAdapter> = {
  openai: openaiAdapter,
  anthropic: anthropicAdapter,
  gemini: geminiAdapter,
};

export const NO_MODEL_MESSAGE = "No AI model configured — add one in Settings → AI model";

type StoredConfig = Omit<AiConfig, "apiKey">;

function readStored(): StoredConfig | null {
  const raw = getAiConfigRaw();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<StoredConfig>;
    const preset = getPreset(parsed.preset);
    if (!preset) return null;
    return {
      preset: preset.id,
      kind: preset.kind,
      baseUrl: parsed.baseUrl ?? preset.baseUrl,
      model: parsed.model ?? "",
      vision: parsed.vision ?? false,
      tools: parsed.tools ?? true,
      transcription: parsed.transcription ?? "provider",
    };
  } catch {
    return null;
  }
}

/** Full config incl. raw key (server-side only). Null when no preset is chosen. */
export function getAiConfig(): AiConfig | null {
  const stored = readStored();
  if (!stored) return null;
  return { ...stored, apiKey: getAiKey() };
}

/** A config usable for chat: preset chosen, model set, key present if needed. */
function requireConfig(): AiConfig {
  const cfg = getAiConfig();
  if (!cfg || !cfg.model) throw new Error(NO_MODEL_MESSAGE);
  const preset = getPreset(cfg.preset)!;
  if (preset.needsKey && !cfg.apiKey) {
    throw new Error(`No API key saved for ${preset.label} — add one in Settings → AI model`);
  }
  if (!cfg.baseUrl) throw new Error(`No base URL set for ${preset.label} — add one in Settings → AI model`);
  return cfg;
}

export type AiConfigPatch = Partial<Omit<AiConfig, "kind" | "apiKey">> & {
  /** string = replace, "" or null = clear, undefined = keep. */
  apiKey?: string | null;
  /** true wipes the whole AI config and key. */
  reset?: boolean;
};

export function saveAiConfig(patch: AiConfigPatch): AiConfig | null {
  if (patch.reset) {
    setAiConfigRaw(null);
    setAiKey(null);
    return null;
  }
  const current = readStored();
  const presetId = (patch.preset ?? current?.preset) as ProviderPresetId | undefined;
  const preset = getPreset(presetId);
  if (!preset) {
    if (patch.preset !== undefined) throw new Error(`Unknown provider preset "${patch.preset}"`);
    if (patch.apiKey !== undefined) setAiKey(patch.apiKey);
    return null;
  }
  const switching = !!current && current.preset !== preset.id;
  const base: StoredConfig =
    current && !switching
      ? current
      : {
          preset: preset.id,
          kind: preset.kind,
          baseUrl: preset.baseUrl,
          model: "",
          vision: false,
          tools: true,
          transcription: current?.transcription ?? "provider",
        };
  const next: StoredConfig = {
    ...base,
    preset: preset.id,
    kind: preset.kind,
    baseUrl: preset.editableBaseUrl
      ? (patch.baseUrl ?? base.baseUrl).trim()
      : preset.baseUrl,
    model: (patch.model ?? base.model).trim(),
    vision: patch.vision ?? base.vision,
    tools: patch.tools ?? base.tools,
    transcription: patch.transcription ?? base.transcription,
  };
  if (!["provider", "local", "groq"].includes(next.transcription)) next.transcription = "provider";
  setAiConfigRaw(JSON.stringify(next));
  // Keys are provider-specific: switching presets drops the old key unless a new one came along.
  if (patch.apiKey !== undefined) setAiKey(patch.apiKey);
  else if (switching) setAiKey(null);
  return getAiConfig();
}

export interface PublicAiConfig extends Omit<AiConfig, "apiKey"> {
  hasKey: boolean;
  maskedKey: string | null;
}

export function publicAiConfig(): PublicAiConfig | null {
  const cfg = getAiConfig();
  if (!cfg) return null;
  const { apiKey, ...rest } = cfg;
  return { ...rest, hasKey: !!apiKey, maskedKey: apiKey ? maskKey(apiKey) : null };
}

export async function chat(req: ChatRequest): Promise<ChatResponse> {
  const cfg = requireConfig();
  return ADAPTERS[cfg.kind].chat(cfg, req);
}

/** Models for the saved config, or for a draft (so Settings can list before saving). */
export async function listModels(draft?: Partial<AiConfig>): Promise<string[]> {
  const cfg = mergeDraft(draft);
  const preset = getPreset(cfg.preset)!;
  if (preset.needsKey && !cfg.apiKey) throw new Error(`Add your ${preset.label} API key first`);
  if (!cfg.baseUrl) throw new Error("Set a base URL first");
  return ADAPTERS[cfg.kind].listModels(cfg);
}

function mergeDraft(draft?: Partial<AiConfig>): AiConfig {
  const saved = getAiConfig();
  if (!draft || !draft.preset) {
    if (!saved) throw new Error(NO_MODEL_MESSAGE);
    return { ...saved, ...(draft?.model ? { model: draft.model } : {}) };
  }
  const preset = getPreset(draft.preset);
  if (!preset) throw new Error(`Unknown provider preset "${draft.preset}"`);
  const samePreset = saved?.preset === preset.id;
  return {
    preset: preset.id,
    kind: preset.kind,
    baseUrl: preset.editableBaseUrl ? (draft.baseUrl ?? (samePreset ? saved!.baseUrl : preset.baseUrl)) : preset.baseUrl,
    model: draft.model ?? (samePreset ? saved!.model : ""),
    apiKey: draft.apiKey || (samePreset ? saved!.apiKey : null),
    vision: samePreset ? saved!.vision : false,
    tools: samePreset ? saved!.tools : true,
    transcription: samePreset ? saved!.transcription : "provider",
  };
}

// 32x32 solid red PNG — a tiny, unambiguous vision probe.
const RED_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAJ0lEQVR42u3NsQkAAAjAsP7/tF7hIASyp6lTCQQCgUAgEAgEgi/BAjLD/C5w/SM9AAAAAElFTkSuQmCC";

export interface TestResult {
  ok: boolean;
  tools: boolean;
  vision: boolean;
  latencyMs: number;
  model: string;
  error?: string;
  /** Per-probe notes for the UI ("Tool call worked", "Vision probe: …"). */
  notes: string[];
}

/**
 * Probe the configured (or draft) model: (a) a forced-ish tool call, (b) a
 * vision question about a red square. ok = the model answered at all.
 */
export async function testModel(draft?: Partial<AiConfig>): Promise<TestResult> {
  let cfg: AiConfig;
  try {
    cfg = mergeDraft(draft);
    if (!cfg.model) throw new Error("Pick or type a model id first");
    const preset = getPreset(cfg.preset)!;
    if (preset.needsKey && !cfg.apiKey) throw new Error(`Add your ${preset.label} API key first`);
    if (!cfg.baseUrl) throw new Error("Set a base URL first");
  } catch (e) {
    return { ok: false, tools: false, vision: false, latencyMs: 0, model: draft?.model ?? "", error: (e as Error).message, notes: [] };
  }
  const adapter = ADAPTERS[cfg.kind];
  const notes: string[] = [];
  let answered = false;
  let tools = false;
  let vision = false;
  let firstError: string | undefined;
  const t0 = Date.now();
  let latencyMs = 0;

  // (a) tool-call probe
  try {
    const res = await adapter.chat(
      { ...cfg, vision: false },
      {
        system: "You are a connectivity test. Always use the provided tool when asked.",
        messages: [{ role: "user", content: [{ type: "text", text: "Call the echo tool with value 'ok'." }] }],
        tools: [
          {
            name: "echo",
            description: "Echo a value back.",
            parameters: {
              type: "object",
              properties: { value: { type: "string", description: "The value to echo" } },
              required: ["value"],
            },
          },
        ],
        maxTokens: 1024,
      }
    );
    latencyMs = Date.now() - t0;
    answered = true;
    const call = res.toolCalls.find((c) => c.name === "echo");
    tools = !!call;
    notes.push(
      tools
        ? `Tool call worked (echo ${JSON.stringify(call!.args)})`
        : `Answered, but didn't call the tool${res.text ? ` — said “${res.text.slice(0, 80)}”` : ""}`
    );
  } catch (e) {
    latencyMs = Date.now() - t0;
    firstError = (e as Error).message;
    notes.push(`Tool probe failed — ${firstError}`);
  }

  // (b) vision probe — skip if the endpoint is unreachable / key is rejected.
  const fatal = firstError && /\b(401|403|404)\b|api key|x-api-key|unauthori[sz]ed|permission|couldn't connect|couldn't resolve|network error|no response/i.test(firstError);
  if (!fatal) {
    try {
      const res = await adapter.chat(
        { ...cfg, vision: true },
        {
          system: "Answer with a single lowercase color word.",
          messages: [
            {
              role: "user",
              content: [
                { type: "image", mime: "image/png", data: RED_PNG },
                { type: "text", text: "What color is this image? One word." },
              ],
            },
          ],
          tools: [],
          maxTokens: 256,
        }
      );
      answered = true;
      if (!latencyMs) latencyMs = Date.now() - t0;
      vision = /\bred\b|crimson|scarlet/i.test(res.text);
      notes.push(vision ? "Vision worked (saw red)" : `Vision unclear — answered “${res.text.trim().slice(0, 60) || "nothing"}”`);
    } catch (e) {
      notes.push(`Vision probe failed — ${(e as Error).message}`);
    }
  }

  return {
    ok: answered,
    tools,
    vision,
    latencyMs,
    model: cfg.model,
    ...(answered ? {} : { error: firstError ?? "The model didn't answer" }),
    notes,
  };
}
