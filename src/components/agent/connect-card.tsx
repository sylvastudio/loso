"use client";

import { useState } from "react";
import { ArrowUpRight, Check, Loader2 } from "lucide-react";
import { Button, cx } from "@/components/ui";
import { useConnectFlow } from "@/components/agent/use-connect";
import { useSettingsSheet } from "@/components/settings/settings-sheet";

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

export { explainFailure } from "@/components/agent/use-connect";

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
  const flow = useConnectFlow(payload, { notice, onConnected });
  const { config, presets, sharedKeys, presetId, preset, choosePreset, baseUrl, setBaseUrl, keyDraft, setKeyDraft } = flow;
  const { replacingKey, setReplacingKey, existingKey, keyAvailable, ranked, modelsBusy, modelsError, loadModels } = flow;
  const { model, setModel, busy, failure, connect } = flow;
  const [typing, setTyping] = useState(false);
  const settings = useSettingsSheet();

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
            <button
              type="button"
              onClick={(e) => settings.open({ opener: e.currentTarget })}
              className="underline-offset-2 hover:text-ink-dim hover:underline"
            >
              More options in Settings
            </button>
          </p>
        </>
      )}
    </div>
  );
}
