"use client";

import { LocalConnect } from "@/components/agent/local-connect";
import { UsagePanel } from "@/components/settings/usage-panel";
import { useEffect, useId, useState } from "react";
import { ArrowUpRight, Check, ChevronRight, Loader2 } from "lucide-react";
import { Button, cx } from "@/components/ui";
import { useConnectFlow } from "@/components/agent/use-connect";
import { friendlyModel, goodFor, isFast } from "@/components/agent/model-chip";
import type { ConfigPayload } from "@/components/agent/connect-card";
import { topPicks } from "@/lib/ai/models";

// "AI" in the settings sheet: paste a key, it is checked by itself (loading
// the model list is free and proves the key works), pick a brain with a
// one-line "good for", then "Use this" saves and runs the small test.
// Claude comes first; every other provider sits behind "Use another AI".

const FIRST = "anthropic";

function GetAKey({ docsUrl }: { docsUrl?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex min-h-10 items-center gap-1.5 self-start text-[13px] text-ink-dim transition-colors hover:text-ink"
      >
        <ChevronRight size={13} className={cx("motion-safe:transition-transform", open && "rotate-90")} aria-hidden />
        Where do I get one?
      </button>
      {open && (
        <ol className="ml-1 flex flex-col gap-2 border-l border-line pl-4 text-[13.5px] leading-snug text-ink-dim">
          <li>
            <span className="mr-2 font-mono text-[12px] text-lime">1</span>
            {docsUrl ? (
              <a href={docsUrl} target="_blank" rel="noreferrer" className="text-ink underline-offset-2 hover:underline">
                Open the key page <ArrowUpRight size={11} className="inline" aria-hidden />
              </a>
            ) : (
              "Go to console.anthropic.com"
            )}{" "}
            and sign in (a grown-up can help).
          </li>
          <li>
            <span className="mr-2 font-mono text-[12px] text-lime">2</span>Press <span className="text-ink">Create key</span>.
          </li>
          <li>
            <span className="mr-2 font-mono text-[12px] text-lime">3</span>Copy it and paste it here.
          </li>
        </ol>
      )}
    </div>
  );
}

/** The local (folder) projects and the static site: same shape, honestly not working yet. */
/** The browser-only app: the user's own Claude key, kept in this browser. */
export function LocalKeyForm() {
  return (
    <>
      <LocalConnect className="" />
      <UsagePanel />
    </>
  );
}

export function AiKeyForm({ payload, onSaved }: { payload: ConfigPayload; onSaved: () => void }) {
  const cfg = payload.config;
  const startOn = cfg?.preset ?? (payload.presets.some((p) => p.id === FIRST) ? FIRST : null);
  const flow = useConnectFlow(payload, { initialPreset: startOn, onConnected: onSaved });
  const { preset, presets, choosePreset, keyDraft, setKeyDraft, existingKey, replacingKey, setReplacingKey, keyAvailable } = flow;
  const { ranked, modelsBusy, modelsError, loadModels, model, setModel, busy, failure, connect, baseUrl, setBaseUrl } = flow;
  const [another, setAnother] = useState(!!cfg && cfg.preset !== FIRST);
  const [more, setMore] = useState(false);
  const [saved, setSaved] = useState(false);
  const fieldId = useId();

  useEffect(() => setSaved(false), [model, keyDraft, preset?.id]);

  const label = preset ? preset.label.replace(" (OpenAI-compatible)", "") : "";
  const keyWord = preset?.id === FIRST ? "Claude" : label;
  const list = ranked ? (more ? ranked.chat : topPicks(ranked.chat, 4)) : [];
  if (ranked && !more && model && !list.some((m) => m.id === model)) {
    const cur = ranked.chat.find((m) => m.id === model);
    if (cur) list.push(cur);
  }
  const keyChecked = keyAvailable && !modelsBusy && !modelsError && !!ranked;
  const unchanged = !!cfg && cfg.preset === preset?.id && cfg.model === model && !keyDraft.trim();

  return (
    <div className="flex flex-col gap-6">
      {/* what's in use now */}
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 border-l-2 border-line-strong pl-3 text-[13.5px] leading-snug text-ink-dim">
        {cfg?.model ? (
          <>
            <span>
              Loso is using <span className="text-ink">{friendlyModel(cfg.model)}</span>
              {cfg.lastTest && !cfg.lastTest.ok ? " but its last check failed" : ""}.
            </span>
            {cfg.maskedKey && <span className="font-mono text-[12px] text-ink-faint">{cfg.maskedKey}</span>}
          </>
        ) : (
          <span>Loso isn&rsquo;t connected to an AI yet.</span>
        )}
      </p>

      {preset && (
        <section aria-labelledby={`${fieldId}-h`} className="flex flex-col gap-4">
          <h3 id={`${fieldId}-h`} className="font-serif text-[26px] font-light italic leading-tight text-ink">
            {preset.needsKey ? `Paste your ${keyWord} key` : `Use ${label}`}
          </h3>

          {preset.editableBaseUrl && (
            <label className="flex flex-col gap-1.5">
              <span className="text-[13px] text-ink-dim">Where it runs (server address)</span>
              <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} className="uline font-mono text-[12.5px]" />
            </label>
          )}

          {(preset.needsKey || preset.id === "custom") &&
            (existingKey && !replacingKey ? (
              <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[13.5px] text-ink">
                <Check size={14} className="text-lime" aria-hidden />
                {existingKey.shared ? `Using your saved ${keyWord} key` : "Your key is saved"}
                <span className="font-mono text-[12px] text-ink-faint">{existingKey.masked}</span>
                <button
                  type="button"
                  onClick={() => setReplacingKey(true)}
                  className="min-h-10 text-[13px] text-ink-dim underline-offset-2 hover:text-ink hover:underline"
                >
                  Use a different key
                </button>
              </p>
            ) : (
              <div className="flex flex-col gap-1.5">
                <label htmlFor={`${fieldId}-key`} className="sr-only">
                  {`${keyWord} key`}
                </label>
                <div className="flex items-end gap-3">
                  <input
                    id={`${fieldId}-key`}
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    value={keyDraft}
                    onChange={(e) => setKeyDraft(e.target.value)}
                    placeholder={preset.needsKey ? preset.keyHint : "Optional: whatever your server expects"}
                    aria-describedby={`${fieldId}-check`}
                    data-autofocus
                    className="uline font-mono text-[13px]"
                  />
                  {preset.docsUrl && (
                    <a
                      href={preset.docsUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="flex shrink-0 items-center gap-0.5 pb-1.5 text-[12.5px] text-ink-dim hover:text-lime"
                    >
                      Get a key <ArrowUpRight size={11} aria-hidden />
                    </a>
                  )}
                </div>
              </div>
            ))}

          {/* the automatic key check */}
          <div id={`${fieldId}-check`} role="status" className="min-h-[22px] text-[13.5px] leading-snug">
            {!keyAvailable ? (
              <span className="text-ink-dim">Paste it and Loso checks it straight away.</span>
            ) : modelsBusy ? (
              <span className="flex items-center gap-2 text-ink-dim">
                <Loader2 size={13} className="animate-spin text-lime motion-reduce:animate-none" aria-hidden /> Checking your key…
              </span>
            ) : modelsError ? (
              <span className="flex flex-wrap items-center gap-x-3 text-danger">
                {modelsError}
                <button type="button" onClick={loadModels} className="min-h-8 text-lime hover:underline">
                  Try again
                </button>
              </span>
            ) : keyChecked ? (
              <span className="flex items-center gap-2 text-ink">
                <Check size={14} className="text-lime" aria-hidden /> {keyDraft.trim() ? "Your key works." : "Ready."} Pick a brain for Loso.
              </span>
            ) : null}
          </div>

          {keyChecked && ranked && ranked.chat.length > 0 && (
            <fieldset className="flex flex-col">
              <legend className="mb-2 font-mono text-[11px] uppercase tracking-[0.12em] text-ink-dim">Which brain?</legend>
              <div className="flex flex-col border-t border-line">
                {list.map((m, i) => {
                  const on = m.id === model;
                  return (
                    <label
                      key={m.id}
                      title={m.id}
                      className={cx(
                        "group flex cursor-pointer items-start gap-3 border-b border-line py-3 pr-2 transition-colors",
                        on ? "text-ink" : "text-ink-dim hover:text-ink"
                      )}
                    >
                      <input
                        type="radio"
                        name={`${fieldId}-model`}
                        value={m.id}
                        checked={on}
                        onChange={() => setModel(m.id)}
                        className="peer sr-only"
                      />
                      <span
                        aria-hidden
                        className={cx(
                          "mt-[5px] flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-lime",
                          on ? "border-lime" : "border-edge"
                        )}
                      >
                        {on && <span className="h-1.5 w-1.5 rounded-full bg-lime" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline gap-2">
                          <span className="truncate font-serif text-[17px] italic">{friendlyModel(m.id)}</span>
                          {i === 0 && !more && <span className="shrink-0 text-[11.5px] text-lime">Recommended</span>}
                        </span>
                        <span className="block text-[13px] text-ink-dim">Good for: {goodFor(m.id).toLowerCase()}</span>
                        <span className="block text-[12px] text-ink-faint">
                          {[m.vision ? "Sees pictures" : "Words only", isFast(m.id) ? "fast" : null].filter(Boolean).join(" · ")}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
              {ranked.chat.length > 4 && (
                <button type="button" onClick={() => setMore((v) => !v)} className="mt-1 min-h-10 self-start text-[13px] text-ink-dim hover:text-ink">
                  {more ? "Show fewer" : `Show all ${ranked.chat.length}`}
                </button>
              )}
            </fieldset>
          )}

          {failure && (
            <p role="alert" className="border-l-2 border-danger pl-3 text-[13.5px] leading-snug text-danger">
              {failure}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-1">
            <Button
              onClick={async () => {
                await connect();
                setSaved(true);
              }}
              disabled={!!busy || !model.trim() || !keyAvailable || !keyChecked || unchanged}
            >
              {busy && <Loader2 size={14} className="animate-spin motion-reduce:animate-none" aria-hidden />}
              {busy === "saving" ? "Saving…" : busy === "testing" ? "Checking it works…" : "Use this"}
            </Button>
            <span className="text-[12.5px] leading-snug text-ink-faint">
              {unchanged ? "This is what Loso uses now." : "Saving checks it with one tiny message (less than a cent)."}
            </span>
          </div>
          {saved && !busy && !failure && (
            <p role="status" className="text-[13.5px] text-lime">
              Done. Loso will use {friendlyModel(model)}.
            </p>
          )}

          {preset.id === FIRST && <GetAKey docsUrl={preset.docsUrl} />}
        </section>
      )}

      {/* every other provider */}
      <section className="flex flex-col gap-2 border-t border-line pt-4">
        <button
          type="button"
          aria-expanded={another}
          aria-controls={`${fieldId}-others`}
          onClick={() => setAnother((a) => !a)}
          className="flex min-h-10 items-center gap-1.5 self-start text-[14px] text-ink transition-colors hover:text-lime"
        >
          <ChevronRight size={14} className={cx("motion-safe:transition-transform", another && "rotate-90")} aria-hidden />
          Use another AI
        </button>
        {another && (
          <div id={`${fieldId}-others`} role="group" aria-label="Other AIs" className="flex flex-wrap gap-x-4 gap-y-2 pl-5">
            {[...presets].sort((a, b) => Number(b.id === FIRST) - Number(a.id === FIRST)).map((p) => (
              <button
                key={p.id}
                type="button"
                aria-pressed={preset?.id === p.id}
                onClick={() => choosePreset(p.id)}
                className={cx(
                  "min-h-9 border-b font-serif text-[16px] transition-colors",
                  preset?.id === p.id ? "border-lime text-ink" : "border-transparent text-ink-dim hover:text-ink"
                )}
              >
                {p.id === FIRST ? "Claude" : p.label.replace(" (OpenAI-compatible)", "")}
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
