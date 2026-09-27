"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Check, Loader2 } from "lucide-react";
import { Button, cx } from "@/components/ui";
import { fetchJson, jsonInit } from "@/lib/fetch-json";
import { rankModels, pickDefaultModel } from "@/lib/ai/models";

// Inline "connect a model" flow for the Agent tab: provider → key → model →
// Connect & test. Settings → AI model stays the full editor; this is the
// shortest path from "I have a key" to chatting.

export interface Preset {
  id: string;
  label: string;
  needsKey: boolean;
  keyHint: string;
  docsUrl: string;
  baseUrl: string;
  editableBaseUrl: boolean;
}

export interface LastTest {
  model: string;
  ok: boolean;
  tools: boolean;
  vision: boolean;
  error?: string;
  latencyMs: number;
  at: number;
}

export interface PublicConfig {
  preset: string;
  baseUrl: string;
  model: string;
  vision: boolean;
  tools: boolean;
  hasKey: boolean;
  maskedKey: string | null;
  keySource: "shared" | "agent" | null;
  needsKey: boolean;
  lastTest: LastTest | null;
}

export interface ConfigPayload {
  config: PublicConfig | null;
  presets: Preset[];
  sharedKeys: Array<{ preset: string; maskedKey: string }>;
  transcription?: { engine: string; detail: string };
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

export function ConnectCard({
  payload,
  onConnected,
  onCancel,
  notice,
}: {
  payload: ConfigPayload;
  onConnected: () => void;
  onCancel?: () => void;
  /** Why we're showing the card (e.g. a failed test), shown on top. */
  notice?: string | null;
}) {
  const { config, presets, sharedKeys } = payload;
  const initialPreset =
    config?.preset ??
    (sharedKeys.find((k) => k.preset === "groq") ?? sharedKeys[0])?.preset ??
    null;
  const [presetId, setPresetId] = useState<string | null>(initialPreset);
  const preset = presets.find((p) => p.id === presetId) ?? null;
  const [baseUrl, setBaseUrl] = useState(config?.preset === presetId ? config.baseUrl : (preset?.baseUrl ?? ""));
  const [keyDraft, setKeyDraft] = useState("");
  const [replacingKey, setReplacingKey] = useState(false);
  const [models, setModels] = useState<string[] | null>(null);
  const [modelsBusy, setModelsBusy] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [model, setModel] = useState(config?.preset === presetId ? config.model : "");
  const [typing, setTyping] = useState(false);
  const [busy, setBusy] = useState<null | "saving" | "testing">(null);
  const [failure, setFailure] = useState<string | null>(notice ?? null);
  const loadSeq = useRef(0);

  // A key we can use without the user pasting one: saved for this preset, or shared from API Keys.
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

  // Auto-load the model list as soon as we can (it's free); debounce pasted keys.
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
      if (r.ok && r.tools) {
        setKeyDraft("");
        onConnected();
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

  const step = (n: string, label: string) => (
    <span className="micro mb-2 block">
      <span className="text-lime">{n}</span> {label}
    </span>
  );

  return (
    <div className="flex flex-col gap-5 p-4">
      <div>
        <p className="font-serif text-[19px] italic leading-snug text-ink">
          {config?.hasKey && !config.model ? `${presets.find((p) => p.id === config.preset)?.label} key saved — pick a model to finish` : "Connect a model"}
        </p>
        <p className="mt-1 text-[12px] leading-relaxed text-ink-faint">
          The agent runs on your own key or a local model. Your key stays in Loso&rsquo;s local database.
        </p>
      </div>

      {failure && (
        <p role="alert" className="rounded-md border border-danger/40 bg-danger/5 px-3 py-2 text-[12.5px] leading-relaxed text-danger">
          {failure}
        </p>
      )}

      {/* 01 provider */}
      <div>
        {step("01", "Provider")}
        <div className="flex flex-wrap gap-x-3.5 gap-y-1.5">
          {presets.map((p) => (
            <button
              key={p.id}
              type="button"
              aria-pressed={presetId === p.id}
              onClick={() => choosePreset(p.id)}
              className={cx(
                "border-b pb-0.5 font-serif text-[15px] transition-colors",
                presetId === p.id ? "border-lime text-ink" : "border-transparent text-ink-faint hover:text-ink-dim"
              )}
            >
              {p.label.replace(" (OpenAI-compatible)", "")}
              {sharedKeys.some((k) => k.preset === p.id) && presetId !== p.id && (
                <span className="ml-1 align-super font-mono text-[9px] text-lime">key</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {preset && (
        <>
          {/* base URL for local / custom servers */}
          {preset.editableBaseUrl && (
            <div>
              {step("··", "Server")}
              <input
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                aria-label="Base URL"
                className="uline font-mono text-[12.5px]"
              />
            </div>
          )}

          {/* 02 key */}
          {(preset.needsKey || preset.id === "custom") && (
            <div>
              {step("02", "Key")}
              {existingKey && !replacingKey ? (
                <p className="flex flex-wrap items-center gap-x-2 text-[12.5px] text-ink-dim">
                  <Check size={12} className="text-lime" />
                  {existingKey.shared ? `Using your ${preset.label} key from Pipeline keys` : "Saved key"}
                  <span className="font-mono text-[11px] text-ink-faint">{existingKey.masked}</span>
                  <button type="button" onClick={() => setReplacingKey(true)} className="text-[12px] text-ink-faint underline-offset-2 hover:text-ink hover:underline">
                    Use a different key
                  </button>
                </p>
              ) : (
                <div className="flex items-end gap-3">
                  <input
                    type="password"
                    autoComplete="off"
                    autoFocus={!!notice}
                    value={keyDraft}
                    onChange={(e) => setKeyDraft(e.target.value)}
                    placeholder={preset.needsKey ? preset.keyHint : "optional — whatever your server expects"}
                    aria-label={`${preset.label} API key`}
                    className="uline font-mono text-[12.5px]"
                  />
                  <a href={preset.docsUrl} target="_blank" rel="noreferrer" className="flex shrink-0 items-center gap-0.5 pb-1.5 text-[11.5px] text-ink-faint hover:text-lime">
                    Get key <ArrowUpRight size={11} />
                  </a>
                </div>
              )}
              {(preset.id === "groq" || preset.id === "anthropic") && (
                <p className="mt-1.5 text-[11px] text-ink-faint">Shared with Settings → Pipeline keys.</p>
              )}
            </div>
          )}

          {/* 03 model */}
          <div>
            {step("03", "Model")}
            {!keyAvailable ? (
              <p className="text-[12px] text-ink-faint">Paste a key and the models load automatically.</p>
            ) : modelsBusy ? (
              <p className="flex items-center gap-2 text-[12px] text-ink-faint">
                <Loader2 size={12} className="animate-spin text-lime" /> Loading models…
              </p>
            ) : modelsError ? (
              <div className="flex flex-col gap-2">
                <p className="text-[12px] leading-relaxed text-danger">{modelsError}</p>
                <button type="button" onClick={loadModels} className="self-start text-[12px] text-lime hover:underline">
                  Retry
                </button>
              </div>
            ) : typing || (ranked && !ranked.chat.length) ? (
              <input
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="model id"
                aria-label="Model id"
                className="uline font-mono text-[12.5px]"
              />
            ) : ranked ? (
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                aria-label="Model"
                className="uline cursor-pointer font-mono text-[12.5px]"
              >
                {ranked.chat.map((m, i) => (
                  <option key={m.id} value={m.id}>
                    {m.id}
                    {i === 0 ? "  · recommended" : ""}
                    {m.vision ? "  · vision" : ""}
                  </option>
                ))}
                {ranked.other.length > 0 && (
                  <optgroup label={`Not chat models (${ranked.other.length})`}>
                    {ranked.other.map((id) => (
                      <option key={id} value={id} disabled>
                        {id}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            ) : null}
            {keyAvailable && !modelsBusy && (
              <button
                type="button"
                onClick={() => setTyping((t) => !t)}
                className="mt-1.5 text-[11px] text-ink-faint underline-offset-2 hover:text-ink-dim hover:underline"
              >
                {typing ? "Pick from the list" : "Type a model id instead"}
              </button>
            )}
          </div>

          <div className="flex items-center gap-3 border-t border-line pt-4">
            <Button onClick={connect} disabled={!!busy || !model.trim() || !keyAvailable}>
              {busy ? <Loader2 size={14} className="animate-spin" /> : null}
              {busy === "saving" ? "Saving…" : busy === "testing" ? "Testing…" : model.trim() ? "Connect & test" : "Pick a model to finish"}
            </Button>
            {onCancel && (
              <Button variant="ghost" onClick={onCancel} disabled={!!busy}>
                Cancel
              </Button>
            )}
          </div>
          <p className="-mt-3 text-[11px] leading-relaxed text-ink-faint">
            Testing sends two tiny requests (fractions of a cent) to check the model can call tools and see images.{" "}
            <Link href="/settings?tab=ai" className="underline-offset-2 hover:text-ink-dim hover:underline">
              More options in Settings
            </Link>
          </p>
        </>
      )}
    </div>
  );
}
