"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { fetchJson, jsonInit } from "@/lib/fetch-json";
import { pickDefaultModel, rankModels } from "@/lib/ai/models";
import type { ProviderPreset } from "@/lib/ai/presets";
import type { ProviderPresetId } from "@/lib/ai/types";
import { Button, ErrorState, InlineError, Input, Section, Select, StatusWord, cx } from "@/components/ui";

type Transcription = "provider" | "local" | "groq";

interface PublicConfig {
  preset: ProviderPresetId;
  kind: string;
  baseUrl: string;
  model: string;
  vision: boolean;
  tools: boolean;
  transcription: Transcription;
  hasKey: boolean;
  maskedKey: string | null;
}

interface ConfigPayload {
  config: PublicConfig | null;
  presets: ProviderPreset[];
  transcription: { engine: string; detail: string; localWhisper: string | null; groqKey: boolean };
  sharedKeys?: Array<{ preset: string; maskedKey: string }>;
}

interface TestResult {
  ok: boolean;
  tools: boolean;
  vision: boolean;
  latencyMs: number;
  model: string;
  error?: string;
  notes: string[];
  persisted: boolean;
}

interface Draft {
  preset: ProviderPresetId | null;
  baseUrl: string;
  model: string;
  vision: boolean;
  tools: boolean;
  transcription: Transcription;
}

const EMPTY: Draft = { preset: null, baseUrl: "", model: "", vision: false, tools: true, transcription: "provider" };

function draftOf(c: PublicConfig | null): Draft {
  if (!c) return EMPTY;
  return {
    preset: c.preset,
    baseUrl: c.baseUrl,
    model: c.model,
    vision: c.vision,
    tools: c.tools,
    transcription: c.transcription,
  };
}

const TRANSCRIPTION: Array<{ id: Transcription; label: string }> = [
  { id: "provider", label: "Use my provider" },
  { id: "local", label: "Local Whisper" },
  { id: "groq", label: "Groq key" },
];

export function AiPanel({ onDirtyChange }: { onDirtyChange?: (dirty: boolean) => void }) {
  const [data, setData] = useState<ConfigPayload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [keyDraft, setKeyDraft] = useState("");
  const [models, setModels] = useState<string[] | null>(null);
  const [modelsBusy, setModelsBusy] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [typeModel, setTypeModel] = useState(false);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<TestResult | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);

  const load = useCallback(() => {
    setLoadError(null);
    fetchJson<ConfigPayload>("/api/ai/config")
      .then((d) => {
        setData(d);
        setDraft(draftOf(d.config));
      })
      .catch((e: Error) => setLoadError(e.message));
  }, []);
  useEffect(load, [load]);

  const saved = data?.config ?? null;
  const preset = data?.presets.find((p) => p.id === draft.preset) ?? null;
  const samePreset = saved?.preset === draft.preset;
  // A key from Settings → Pipeline keys counts too (Groq, Anthropic share it).
  const sharedKey = data?.sharedKeys?.find((k) => k.preset === draft.preset) ?? null;
  const hasSavedKey = (samePreset && !!saved?.hasKey) || !!sharedKey;
  const showKey = !!preset && (preset.needsKey || preset.id === "custom");

  const dirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(draftOf(saved)) || keyDraft.trim() !== "",
    [draft, saved, keyDraft]
  );
  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);

  // Load the model list as soon as a provider is usable (listing is free),
  // so nobody is left with a saved key and no model.
  useEffect(() => {
    if (!data || !preset || models || modelsBusy) return;
    const keyOk = !preset.needsKey || hasSavedKey;
    if (keyOk && (!preset.editableBaseUrl || draft.baseUrl.trim())) loadModels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, draft.preset, hasSavedKey]);

  function patch(p: Partial<Draft>) {
    setDraft((d) => ({ ...d, ...p }));
  }

  function pickPreset(p: ProviderPreset) {
    if (p.id === draft.preset) return;
    const back = saved?.preset === p.id ? draftOf(saved) : null;
    setDraft((d) => ({
      preset: p.id,
      baseUrl: back?.baseUrl ?? p.baseUrl,
      model: back?.model ?? "",
      vision: back?.vision ?? false,
      tools: back?.tools ?? true,
      transcription: d.transcription,
    }));
    setKeyDraft("");
    setModels(null);
    setModelsError(null);
    setTypeModel(false);
    setTest(null);
  }

  // Unsaved draft fields sent along so Load / Test work before saving.
  function draftBody() {
    return {
      preset: draft.preset ?? undefined,
      baseUrl: preset?.editableBaseUrl ? draft.baseUrl : undefined,
      apiKey: keyDraft.trim() || undefined,
      model: draft.model || undefined,
    };
  }

  async function loadModels() {
    setModelsBusy(true);
    setModelsError(null);
    try {
      const d = await fetchJson<{ models: string[] }>("/api/ai/models", jsonInit("POST", draftBody()));
      setModels(d.models);
      if (!d.models.length) setModelsError("The provider returned no models — type an id instead.");
      // Never default to models[0] (often a tiny or non-chat model): rank and keep a valid choice.
      else setDraft((cur) => ({ ...cur, model: pickDefaultModel(d.models, cur.model) }));
      setTypeModel(!d.models.length);
    } catch (e) {
      setModelsError((e as Error).message);
    } finally {
      setModelsBusy(false);
    }
  }

  async function runTest() {
    setTesting(true);
    setTest(null);
    try {
      const r = await fetchJson<TestResult>("/api/ai/test", jsonInit("POST", draftBody()));
      setTest(r);
      if (r.ok) {
        patch({ vision: r.vision, tools: r.tools });
        if (r.persisted && data?.config) {
          setData({ ...data, config: { ...data.config, vision: r.vision, tools: r.tools } });
        }
      }
    } catch (e) {
      setTest({ ok: false, tools: false, vision: false, latencyMs: 0, model: draft.model, error: (e as Error).message, notes: [], persisted: false });
    } finally {
      setTesting(false);
    }
  }

  async function save() {
    if (!draft.preset) return;
    setSaving(true);
    setSaveError(null);
    try {
      const body: Record<string, unknown> = {
        preset: draft.preset,
        model: draft.model,
        vision: draft.vision,
        tools: draft.tools,
        transcription: draft.transcription,
      };
      if (preset?.editableBaseUrl) body.baseUrl = draft.baseUrl;
      if (keyDraft.trim()) body.apiKey = keyDraft.trim();
      const d = await fetchJson<ConfigPayload>("/api/ai/config", jsonInit("PUT", body));
      setData(d);
      setDraft(draftOf(d.config));
      setKeyDraft("");
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1800);
    } catch (e) {
      setSaveError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function removeKey() {
    try {
      const d = await fetchJson<ConfigPayload>("/api/ai/config", jsonInit("PUT", { apiKey: "" }));
      setData(d);
    } catch (e) {
      setSaveError((e as Error).message);
    }
  }

  async function disconnect() {
    try {
      const d = await fetchJson<ConfigPayload>("/api/ai/config", jsonInit("PUT", { reset: true }));
      setData(d);
      setDraft(EMPTY);
      setKeyDraft("");
      setModels(null);
      setTest(null);
    } catch (e) {
      setSaveError((e as Error).message);
    }
  }

  if (loadError) {
    return <ErrorState detail={`AI model settings couldn't load (${loadError}).`} onRetry={load} />;
  }
  if (!data) {
    return <p className="py-16 text-center text-sm text-ink-faint">Loading AI model…</p>;
  }

  const ranked = models ? rankModels(models) : null;
  const modelOptions = ranked ? ranked.chat.map((m) => m.id) : [];
  const modelInList = !!draft.model && modelOptions.includes(draft.model);
  const needsKeyNow = !!preset?.needsKey && !hasSavedKey && !keyDraft.trim();
  const canQuery = !!preset && !needsKeyNow && (!preset.editableBaseUrl || !!draft.baseUrl.trim());
  const tx = data.transcription;

  return (
    <>
      <div className="grid grid-cols-1 gap-6 pt-6 md:grid-cols-[1fr_auto] md:items-end">
        <p className="max-w-lg text-[13px] leading-relaxed text-ink-dim">
          Loso&apos;s studio agent runs on your model — OpenAI, Grok, Claude, Gemini, Groq, OpenRouter, or a
          local model via Ollama / LM Studio. Pick one, point it at a model, and test it. The key stays in the
          local database; the browser only ever sees a masked copy.
        </p>
        <div className="flex items-center gap-4">
          {saved ? (
            <>
              <span className="text-[12px] text-ink-faint">
                Now: <span className="text-ink">{data.presets.find((p) => p.id === saved.preset)?.label}</span>
                {saved.model ? <span className="font-mono text-[11.5px]"> · {saved.model}</span> : null}
              </span>
              <Button size="sm" variant="danger" onClick={disconnect}>
                Disconnect
              </Button>
            </>
          ) : (
            <StatusWord ok={false} labels={["", "No model"]} />
          )}
        </div>
      </div>

      <div className="mt-6">
        {/* 01 — Provider */}
        <Section n="01" title="Provider" description="Who runs the model. Local servers need no key.">
          <div className="flex flex-wrap gap-x-6 gap-y-3" role="radiogroup" aria-label="AI provider">
            {data.presets.map((p) => {
              const on = draft.preset === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => pickPreset(p)}
                  className={cx(
                    "relative pb-1.5 font-serif text-[17px] tracking-tight transition-colors",
                    on ? "text-ink" : "text-ink-faint hover:text-ink-dim"
                  )}
                >
                  {p.label}
                  <span
                    className={cx(
                      "absolute inset-x-0 -bottom-px h-px transition-colors",
                      on ? "bg-lime" : "bg-transparent"
                    )}
                  />
                </button>
              );
            })}
          </div>

          {preset && (
            <div className="mt-8 grid max-w-xl gap-7">
              <label className="block">
                <span className="mb-1 flex items-baseline justify-between">
                  <span className="micro">Base URL</span>
                  <span className="text-[11px] text-ink-faint">
                    {preset.editableBaseUrl ? "OpenAI-compatible endpoint" : "fixed for this provider"}
                  </span>
                </span>
                <Input
                  value={preset.editableBaseUrl ? draft.baseUrl : preset.baseUrl}
                  readOnly={!preset.editableBaseUrl}
                  placeholder="https://your-server/v1"
                  onChange={(e) => patch({ baseUrl: e.target.value })}
                  className={cx("font-mono text-[13px]", !preset.editableBaseUrl && "cursor-default text-ink-faint")}
                  spellCheck={false}
                />
              </label>

              {showKey && (
                <div>
                  <span className="mb-1 flex items-baseline justify-between">
                    <span className="micro">API key</span>
                    <a
                      href={preset.docsUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-0.5 text-[11.5px] text-ink-faint transition-colors hover:text-lime"
                    >
                      Get key <ArrowUpRight size={11} />
                    </a>
                  </span>
                  <div className="flex items-end gap-3">
                    <Input
                      type="password"
                      autoComplete="off"
                      aria-label={`${preset.label} API key`}
                      placeholder={
                        hasSavedKey && (sharedKey?.maskedKey ?? saved?.maskedKey)
                          ? `Saved · ${sharedKey?.maskedKey ?? saved?.maskedKey} — paste to replace`
                          : preset.keyHint
                      }
                      value={keyDraft}
                      onChange={(e) => setKeyDraft(e.target.value)}
                      className="font-mono text-[13px]"
                    />
                    {hasSavedKey && !keyDraft && !sharedKey && (
                      <Button size="sm" variant="danger" onClick={removeKey}>
                        Remove
                      </Button>
                    )}
                  </div>
                  {(preset.id === "groq" || preset.id === "anthropic") && (
                    <p className="mt-2 text-[12px] leading-relaxed text-ink-faint">
                      Shared with Settings → Pipeline keys — one {preset.label} key for captions and the agent.
                    </p>
                  )}
                </div>
              )}
              {!showKey && (
                <p className="text-[12px] leading-relaxed text-ink-faint">
                  No key needed — make sure {preset.label.replace(/ \(.*\)$/, "")} is running on this Mac.{" "}
                  <a href={preset.docsUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 hover:text-lime">
                    Download <ArrowUpRight size={11} />
                  </a>
                </p>
              )}
            </div>
          )}
        </Section>

        {/* 02 — Model */}
        <Section
          n="02"
          title="Model"
          description="Load the list your key can use, or type any model id."
        >
          {!preset ? (
            <p className="text-[12.5px] text-ink-faint">Choose a provider first.</p>
          ) : (
            <div className="max-w-xl">
              <div className="flex items-end gap-3">
                {modelOptions.length > 0 && !typeModel ? (
                  <Select
                    aria-label="Model"
                    value={modelInList ? draft.model : ""}
                    onChange={(e) => patch({ model: e.target.value })}
                    className="font-mono text-[13px]"
                  >
                    {!modelInList && <option value="">{draft.model ? `${draft.model} (typed)` : "Pick a model…"}</option>}
                    {ranked?.chat.map((m, i) => (
                      <option key={m.id} value={m.id}>
                        {m.id}
                        {i === 0 ? "  · recommended" : ""}
                        {m.vision ? "  · vision" : ""}
                      </option>
                    ))}
                    {ranked && ranked.other.length > 0 && (
                      <optgroup label={`Not chat models (${ranked.other.length})`}>
                        {ranked.other.map((m) => (
                          <option key={m} value={m} disabled>
                            {m}
                          </option>
                        ))}
                      </optgroup>
                    )}
                  </Select>
                ) : (
                  <Input
                    aria-label="Model id"
                    placeholder="model id — e.g. from the provider's docs"
                    value={draft.model}
                    onChange={(e) => patch({ model: e.target.value })}
                    className="font-mono text-[13px]"
                    spellCheck={false}
                  />
                )}
                <Button size="sm" variant="outline" onClick={loadModels} disabled={!canQuery || modelsBusy}>
                  {modelsBusy ? "Loading…" : models ? "Reload" : "Load models"}
                </Button>
              </div>
              <div className="mt-2.5 flex min-h-[18px] items-center justify-between gap-4">
                {modelsError ? (
                  <InlineError onDismiss={() => setModelsError(null)}>{modelsError}</InlineError>
                ) : (
                  <span className="text-[12px] text-ink-faint">
                    {needsKeyNow
                      ? "Paste a key to load models."
                      : models
                        ? `${models.length} model${models.length === 1 ? "" : "s"} available.`
                        : ""}
                  </span>
                )}
                {modelOptions.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setTypeModel((v) => !v)}
                    className="shrink-0 text-[11.5px] text-ink-faint transition-colors hover:text-lime"
                  >
                    {typeModel ? "Pick from list" : "Type an id instead"}
                  </button>
                )}
              </div>

              <div className="mt-6 flex items-center gap-6">
                <span className="micro">Capabilities</span>
                <CapToggle ok={draft.vision} label="Vision" onToggle={() => patch({ vision: !draft.vision })} />
                <CapToggle ok={draft.tools} label="Tools" onToggle={() => patch({ tools: !draft.tools })} />
              </div>
              <p className="mt-2 text-[12px] leading-relaxed text-ink-faint">
                Detected by the test below; click to override. Without vision the agent works from text
                descriptions of frames.
              </p>
            </div>
          )}
        </Section>

        {/* 03 — Test */}
        <Section n="03" title="Test" description="A tool-call probe and a tiny image question. Costs a fraction of a cent.">
          {!preset ? (
            <p className="text-[12.5px] text-ink-faint">Choose a provider first.</p>
          ) : (
            <div className="max-w-xl">
              <Button size="sm" variant="outline" onClick={runTest} disabled={!canQuery || !draft.model || testing}>
                {testing ? (
                  <>
                    Testing<span className="blink">…</span>
                  </>
                ) : (
                  "Test model"
                )}
              </Button>
              {test && (
                <div className="rise mt-5 border-l border-line-strong pl-4">
                  <div className="flex flex-wrap items-baseline gap-x-5 gap-y-2">
                    <StatusWord ok={test.ok} labels={["Answered", "Failed"]} />
                    {test.ok && (
                      <>
                        <StatusWord ok={test.tools} labels={["Tools", "No tools"]} />
                        <StatusWord ok={test.vision} labels={["Vision", "No vision"]} />
                      </>
                    )}
                    {test.latencyMs > 0 && (
                      <span className="font-mono text-[11.5px] text-ink-faint">{test.latencyMs} ms</span>
                    )}
                  </div>
                  {test.error && !test.ok && (
                    <p className="mt-2.5 text-[12.5px] leading-relaxed text-danger" role="alert">
                      {test.error}
                    </p>
                  )}
                  {test.notes.length > 0 && (
                    <ul className="mt-2.5 space-y-1">
                      {test.notes.map((n, i) => (
                        <li key={i} className="text-[12px] leading-relaxed text-ink-faint">
                          {n}
                        </li>
                      ))}
                    </ul>
                  )}
                  {test.ok && !test.persisted && (
                    <p className="mt-2.5 text-[12px] text-ink-dim">Save to keep these capabilities.</p>
                  )}
                </div>
              )}
            </div>
          )}
        </Section>

        {/* 04 — Transcription */}
        <Section
          n="04"
          title="Transcription"
          description="Word-timed transcripts drive captions and cut points."
        >
          <div className="max-w-xl">
            <div className="inline-flex border border-line-strong" role="radiogroup" aria-label="Transcription engine">
              {TRANSCRIPTION.map((t, i) => {
                const on = draft.transcription === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => patch({ transcription: t.id })}
                    className={cx(
                      "h-8 px-4 text-[12.5px] transition-colors",
                      i > 0 && "border-l border-line-strong",
                      on ? "bg-lime font-medium text-black" : "text-ink-dim hover:text-ink"
                    )}
                  >
                    {t.label}
                  </button>
                );
              })}
            </div>
            <p className="mt-3 text-[12px] leading-relaxed text-ink-faint">
              {transcriptionNote(draft.transcription, preset, tx.localWhisper, tx.groqKey)}
            </p>
            {!dirty && (
              <p className="mt-1.5 text-[12px] text-ink-dim">
                <span className="micro mr-2">In use</span>
                {tx.engine === "none" ? "nothing yet" : tx.detail}
              </p>
            )}
          </div>
        </Section>
      </div>

      {/* Save bar */}
      <div
        className={`pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center pb-6 transition-all duration-300 ${
          dirty || savedFlash ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0"
        }`}
      >
        <div className="pointer-events-auto flex items-center gap-4 border border-line-strong bg-black/90 py-2.5 pl-5 pr-2.5 backdrop-blur-md">
          {savedFlash && !dirty ? (
            <span className="pr-3 text-[13px] text-lime">AI model saved</span>
          ) : (
            <>
              {saveError ? (
                <InlineError className="max-w-xs">{`Save failed — ${saveError}`}</InlineError>
              ) : (
                <span className="text-[13px] text-ink-dim">
                  {needsKeyNow ? "Add an API key to finish" : !draft.model.trim() ? "Pick a model to finish" : "Unsaved changes"}
                </span>
              )}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setDraft(draftOf(saved));
                  setKeyDraft("");
                  setSaveError(null);
                }}
              >
                Discard
              </Button>
              <Button size="sm" onClick={save} disabled={saving || !draft.preset || !draft.model.trim() || needsKeyNow}>
                {saving ? "Saving…" : saveError ? "Retry save" : "Save model"}
              </Button>
            </>
          )}
        </div>
      </div>
    </>
  );
}

function CapToggle({ ok, label, onToggle }: { ok: boolean; label: string; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={ok}
      title={`${label}: ${ok ? "on" : "off"} — click to override`}
      className="opacity-100 transition-opacity hover:opacity-80"
    >
      <StatusWord ok={ok} labels={[label, label]} />
    </button>
  );
}

function transcriptionNote(
  choice: Transcription,
  preset: ProviderPreset | null,
  localWhisper: string | null,
  groqKey: boolean
): string {
  const localLine = localWhisper
    ? `Falls back to ${localWhisper} on this Mac.`
    : "Local Whisper isn't installed (pip install mlx-whisper).";
  if (choice === "provider") {
    if (!preset) return "Uses your provider's speech-to-text when it returns word timings.";
    if (preset.sttWordTimings) {
      return `${preset.label} transcribes with ${preset.sttModel} — word timings included, billed to your key.`;
    }
    return `${preset.label} has no word-timed speech-to-text. ${localLine}`;
  }
  if (choice === "local") {
    return localWhisper
      ? `Runs ${localWhisper} on this Mac — free and private; slower on long footage.`
      : "Local Whisper isn't installed — `pip install mlx-whisper` (Apple Silicon) or `pip install openai-whisper`.";
  }
  return groqKey
    ? "Uses the Groq key from API Keys — whisper-large-v3-turbo, fast and cheap."
    : "No Groq key saved yet — add one under API Keys.";
}
