"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchJson, jsonInit } from "@/lib/fetch-json";
import { pickDefaultModel, rankModels } from "@/lib/ai/models";
import type { ConfigPayload, Preset } from "@/components/agent/connect-card";

// The one "connect a model" flow, shared by the inline connect card in the
// chat dock and the settings sheet: choose a provider, paste a key (checked
// by loading the model list, which is free), pick a model, then save + test.
// Nothing is saved until connect() runs.

export const AI_CONFIG_CHANGED = "loso:ai-config-changed";

/** Tell every open chat that the saved AI setup changed (reload it). */
export function announceAiConfigChanged() {
  window.dispatchEvent(new Event(AI_CONFIG_CHANGED));
}

interface TestResult {
  ok: boolean;
  tools: boolean;
  vision: boolean;
  latencyMs: number;
  model: string;
  error?: string;
}

/** Turn a provider error into the next step to take. */
export function explainFailure(err: string, providerLabel: string, baseUrl: string): { text: string; kind: "auth" | "connection" | "missing" | "other" } {
  if (/\b(401|403)\b|api key|x-api-key|unauthori[sz]ed|permission/i.test(err)) {
    return { kind: "auth", text: `${providerLabel} rejected this key — it may be revoked or mistyped.` };
  }
  if (/couldn't connect|ECONNREFUSED/i.test(err)) {
    if (/11434/.test(baseUrl)) return { kind: "connection", text: "Ollama isn't running at localhost:11434. Start it (`ollama serve`, or open the app), then retry." };
    if (/1234/.test(baseUrl)) return { kind: "connection", text: "LM Studio's server isn't running. In LM Studio, load a model and start the server (Developer tab), then retry." };
    return { kind: "connection", text: `Couldn't reach ${baseUrl}.` };
  }
  if (/couldn't resolve|network error|no response/i.test(err)) return { kind: "connection", text: `Couldn't reach ${providerLabel}: ${err}` };
  if (/\b404\b|model_not_found|does not exist|not found/i.test(err)) {
    return { kind: "missing", text: `That model isn't available on ${providerLabel} any more — pick another.` };
  }
  return { kind: "other", text: err };
}

export function useConnectFlow(payload: ConfigPayload, opts: { initialPreset?: string | null; notice?: string | null; onConnected: () => void }) {
  const { config, presets, sharedKeys } = payload;
  const initialPreset =
    opts.initialPreset ??
    config?.preset ??
    (sharedKeys.find((k) => k.preset === "groq") ?? sharedKeys[0])?.preset ??
    null;
  const [presetId, setPresetId] = useState<string | null>(initialPreset);
  const preset: Preset | null = presets.find((p) => p.id === presetId) ?? null;
  const [baseUrl, setBaseUrl] = useState(config?.preset === presetId ? config.baseUrl : (preset?.baseUrl ?? ""));
  const [keyDraft, setKeyDraft] = useState("");
  const [replacingKey, setReplacingKey] = useState(false);
  const [models, setModels] = useState<string[] | null>(null);
  const [modelsBusy, setModelsBusy] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [model, setModel] = useState(config?.preset === presetId ? config.model : "");
  const [busy, setBusy] = useState<null | "saving" | "testing">(null);
  const [failure, setFailure] = useState<string | null>(opts.notice ?? null);
  const loadSeq = useRef(0);

  // A key we can use without the user pasting one: saved for this preset, or kept from an earlier switch.
  const existingKey =
    preset && config?.preset === preset.id && config.hasKey
      ? { masked: config.maskedKey, shared: config.keySource === "shared" }
      : (() => {
          const s = sharedKeys.find((k) => k.preset === presetId);
          return s ? { masked: s.maskedKey, shared: true } : null;
        })();
  const keyAvailable = !!keyDraft.trim() || (!!existingKey && !replacingKey) || (!!preset && !preset.needsKey);
  const ranked = useMemo(() => (models ? rankModels(models) : null), [models]);

  function choosePreset(id: string) {
    if (id === presetId) return;
    const p = presets.find((x) => x.id === id)!;
    setPresetId(id);
    setBaseUrl(config?.preset === id ? config.baseUrl : p.baseUrl);
    setModel(config?.preset === id ? config.model : "");
    setModels(null);
    setModelsError(null);
    setKeyDraft("");
    setReplacingKey(false);
    setFailure(null);
  }

  const loadModels = useCallback(async () => {
    if (!preset || !keyAvailable) return;
    const seq = ++loadSeq.current;
    setModelsBusy(true);
    setModelsError(null);
    try {
      const d = await fetchJson<{ models: string[] }>(
        "/api/ai/models",
        jsonInit("POST", { preset: preset.id, baseUrl, ...(keyDraft.trim() ? { apiKey: keyDraft.trim() } : {}) })
      );
      if (seq !== loadSeq.current) return;
      setModels(d.models);
      setModel((cur) => pickDefaultModel(d.models, cur));
      if (!d.models.length) {
        setModelsError(
          preset.id === "ollama"
            ? "No models installed. Pull one that supports tools (ollama.com/search?c=tools), then retry."
            : "This provider returned no models."
        );
      }
    } catch (e) {
      if (seq !== loadSeq.current) return;
      setModels(null);
      setModelsError(explainFailure((e as Error).message, preset.label, baseUrl).text);
    } finally {
      if (seq === loadSeq.current) setModelsBusy(false);
    }
  }, [preset, keyAvailable, baseUrl, keyDraft]);

  // Auto-load the model list as soon as we can (it's free, and it is the key
  // check); debounce pasted or typed keys.
  useEffect(() => {
    if (!preset || !keyAvailable) return;
    const t = setTimeout(loadModels, keyDraft ? 400 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presetId, keyDraft, keyAvailable, preset?.editableBaseUrl ? baseUrl : ""]);

  async function connect() {
    if (!preset || !model.trim()) return;
    setFailure(null);
    setBusy("saving");
    try {
      await fetchJson(
        "/api/ai/config",
        jsonInit("PUT", {
          preset: preset.id,
          model: model.trim(),
          ...(preset.editableBaseUrl ? { baseUrl } : {}),
          ...(keyDraft.trim() ? { apiKey: keyDraft.trim() } : {}),
        })
      );
      setBusy("testing");
      const r = await fetchJson<TestResult>("/api/ai/test", jsonInit("POST", {}));
      announceAiConfigChanged();
      if (r.ok && r.tools) {
        setKeyDraft("");
        opts.onConnected();
        return;
      }
      if (r.ok && !r.tools) {
        const next = ranked?.chat.find((m) => m.id !== model)?.id;
        setFailure(
          `${model} answered but didn't call tools — the agent needs tool calling.` +
            (next ? ` Try ${next} (selected).` : "")
        );
        if (next) setModel(next);
        return;
      }
      const f = explainFailure(r.error ?? "The model didn't answer", preset.label, baseUrl);
      setFailure(f.text);
      if (f.kind === "auth") setReplacingKey(true);
      if (f.kind === "missing") loadModels();
    } catch (e) {
      setFailure((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return {
    config,
    presets,
    sharedKeys,
    presetId,
    preset,
    choosePreset,
    baseUrl,
    setBaseUrl,
    keyDraft,
    setKeyDraft,
    replacingKey,
    setReplacingKey,
    existingKey,
    keyAvailable,
    models,
    ranked,
    modelsBusy,
    modelsError,
    loadModels,
    model,
    setModel,
    busy,
    failure,
    connect,
  };
}
