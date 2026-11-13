"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ArrowUpRight, Check, ChevronRight, Loader2 } from "lucide-react";
import { Button, cx } from "@/components/ui";
import { friendlyModel, goodFor, isFast } from "@/components/agent/model-chip";
import { rankModels, pickDefaultModel } from "@/lib/ai/models";
import {
  LOCAL_AI_CHANGED,
  connectLocalKey,
  forgetLocalKey,
  getLocalAiSettings,
  keyRemembered,
  listClaudeModels,
  localKey,
  maskKey,
  setLocalKey,
  switchLocalModel,
} from "@/lib/local/ai";

// Connecting the browser-only app to Claude: paste a key, it is checked by
// itself (listing models is free), pick a brain, "Use this". The key stays in
// this tab's memory; "Remember on this computer" also keeps it in this
// browser's storage. Shown in the chat dock and in Settings → AI.

const KEYS_URL = "https://console.anthropic.com/settings/keys";

function explain(err: string): string {
  if (/\b(401|403)\b|api key|x-api-key|authentication|unauthori[sz]ed|permission/i.test(err)) {
    return "Anthropic didn't accept this key. Check you copied all of it, or make a new one.";
  }
  if (/failed to fetch|network|couldn't|no response/i.test(err)) return "Couldn't reach Anthropic. Check your internet connection and try again.";
  return err;
}

function GetAKey() {
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
            <a href={KEYS_URL} target="_blank" rel="noreferrer" className="text-ink underline-offset-2 hover:underline">
              Open Anthropic&rsquo;s key page <ArrowUpRight size={11} className="inline" aria-hidden />
            </a>{" "}
            and sign in (a grown-up can help).
          </li>
          <li>
            <span className="mr-2 font-mono text-[12px] text-lime">2</span>Press <span className="text-ink">Create key</span>. Tip:
            set a monthly spending limit for it.
          </li>
          <li>
            <span className="mr-2 font-mono text-[12px] text-lime">3</span>Copy it and paste it here.
          </li>
        </ol>
      )}
    </div>
  );
}

export function LocalConnect({
  notice,
  onConnected,
  onCancel,
  heading = true,
  className = "px-4 py-5",
}: {
  notice?: string | null;
  onConnected?: () => void;
  onCancel?: () => void;
  heading?: boolean;
  className?: string;
}) {
  const id = useId();
  const [current, setCurrent] = useState<{ masked: string; model: string; remembered: boolean } | null | undefined>(undefined);
  const [replacing, setReplacing] = useState(false);
  const [draft, setDraft] = useState("");
  const [remember, setRemember] = useState(false);
  const [models, setModels] = useState<string[] | null>(null);
  const [model, setModel] = useState("");
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(notice ?? null);
  const [more, setMore] = useState(false);
  const seq = useRef(0);

  async function refresh() {
    const [key, s, remembered] = await Promise.all([localKey(), getLocalAiSettings(), keyRemembered()]);
    setCurrent(key ? { masked: maskKey(key), model: s?.model ?? "", remembered } : null);
    if (key) {
      setRemember(remembered);
      setModel(s?.model ?? "");
    }
  }
  useEffect(() => {
    refresh();
    const on = () => refresh();
    window.addEventListener(LOCAL_AI_CHANGED, on);
    return () => window.removeEventListener(LOCAL_AI_CHANGED, on);
  }, []);

  // With a key in use, its model list loads by itself (free) for the picker.
  const usingSaved = !!current && !replacing;
  useEffect(() => {
    if (!usingSaved) return;
    const n = ++seq.current;
    listClaudeModels()
      .then((ids) => n === seq.current && setModels(ids))
      .catch((e: Error) => n === seq.current && setFailure(explain(e.message)));
  }, [usingSaved]);

  // A pasted key is checked as soon as typing stops.
  useEffect(() => {
    const key = draft.trim();
    if (usingSaved || key.length < 20) {
      if (!usingSaved) setModels(null);
      return;
    }
    const n = ++seq.current;
    setChecking(true);
    setFailure(null);
    const t = setTimeout(() => {
      listClaudeModels(key)
        .then((ids) => {
          if (n !== seq.current) return;
          setModels(ids);
          setModel((cur) => pickDefaultModel(ids, cur));
        })
        .catch((e: Error) => n === seq.current && (setModels(null), setFailure(explain(e.message))))
        .finally(() => n === seq.current && setChecking(false));
    }, 400);
    return () => clearTimeout(t);
  }, [draft, usingSaved]);

  const ranked = useMemo(() => (models ? rankModels(models).chat : null), [models]);
  const list = ranked ? (more ? ranked : ranked.slice(0, 4)) : [];
  if (ranked && !more && model && !list.some((m) => m.id === model)) {
    const cur = ranked.find((m) => m.id === model);
    if (cur) list.push(cur);
  }

  async function useThis() {
    setBusy(true);
    setFailure(null);
    try {
      if (usingSaved) {
        const m = ranked?.find((x) => x.id === model);
        await switchLocalModel(model, m?.vision ?? true);
        const key = await localKey();
        if (key && remember !== current?.remembered) await setLocalKey(key, remember);
      } else {
        await connectLocalKey(draft.trim(), remember, model);
        setDraft("");
        setReplacing(false);
      }
      await refresh();
      onConnected?.();
    } catch (e) {
      setFailure(explain((e as Error).message));
    } finally {
      setBusy(false);
    }
  }

  async function removeKey() {
    await forgetLocalKey();
    setModels(null);
    setModel("");
    setReplacing(false);
    await refresh();
  }

  const keyChecked = usingSaved ? !!ranked : !!ranked && !checking;
  const unchanged = usingSaved && model === current?.model && remember === current?.remembered;

  return (
    <div className={cx("flex flex-col gap-5", className)}>
      {heading && (
        <div className="flex flex-col gap-2">
          <h3 className="font-serif text-[26px] font-light italic leading-tight text-ink">
            {current ? "Loso is ready to think." : "Loso needs a key to think."}
          </h3>
          {!current && <p className="text-[13.5px] leading-relaxed text-ink-dim">A key is like a library card for an AI. You paste it once.</p>}
        </div>
      )}

      {failure && (
        <p role="alert" className="border-l-2 border-danger pl-3 text-[13.5px] leading-snug text-danger">
          {failure}
        </p>
      )}

      {current === undefined ? (
        <p role="status" className="text-[13px] text-ink-dim">
          Loading…
        </p>
      ) : usingSaved ? (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 border-l-2 border-line-strong pl-3 text-[13.5px] leading-snug text-ink-dim">
          <span>
            Using your Claude key <span className="font-mono text-[12px] text-ink">{current!.masked}</span>
            {current!.remembered ? ", remembered on this computer." : ", for this visit only."}
          </span>
          <button type="button" onClick={() => setReplacing(true)} className="min-h-8 text-ink underline-offset-2 hover:underline">
            Use a different key
          </button>
        </p>
      ) : (
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] text-ink-dim">Paste your Claude key</span>
          <input
            type="password"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            placeholder="sk-ant-…"
            aria-describedby={`${id}-where`}
            className="uline font-mono text-[13px]"
          />
          {checking && (
            <span role="status" className="flex items-center gap-1.5 text-[12.5px] text-ink-dim">
              <Loader2 size={12} className="animate-spin motion-reduce:animate-none" aria-hidden /> Checking the key…
            </span>
          )}
          {keyChecked && !checking && (
            <span role="status" className="flex items-center gap-1.5 text-[12.5px] text-ink">
              <Check size={12} className="text-lime" aria-hidden /> Key works. Pick a brain below.
            </span>
          )}
        </label>
      )}

      {list.length > 0 && (
        <fieldset className="flex flex-col">
          <legend className="mb-2 font-mono text-[11px] uppercase tracking-[0.12em] text-ink-dim">Which brain?</legend>
          {list.map((m, i) => (
            <label
              key={m.id}
              className={cx(
                "flex min-h-12 cursor-pointer items-start gap-3 border-t border-line py-2.5",
                model === m.id ? "text-ink" : "text-ink-dim hover:text-ink"
              )}
            >
              <input type="radio" name={`${id}-model`} checked={model === m.id} onChange={() => setModel(m.id)} className="mt-1 accent-[var(--color-lime)]" />
              <span className="flex flex-col">
                <span className="font-serif text-[16px] italic">
                  {friendlyModel(m.id)}
                  {i === 0 && <span className="ml-2 font-sans text-[11px] not-italic text-lime">Recommended</span>}
                </span>
                <span className="text-[12.5px] text-ink-dim">
                  Good for: {goodFor(m.id).toLowerCase()}
                  {m.vision ? " · sees pictures" : ""}
                  {isFast(m.id) ? " · fast" : ""}
                </span>
              </span>
            </label>
          ))}
          {ranked && ranked.length > 4 && !more && (
            <button type="button" onClick={() => setMore(true)} className="min-h-10 self-start text-[13px] text-ink-dim hover:text-ink">
              Show all {ranked.length}
            </button>
          )}
        </fieldset>
      )}

      {current !== undefined && (
        <label className="flex min-h-10 cursor-pointer items-start gap-2.5 text-[13.5px] leading-snug text-ink-dim">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="mt-0.5 accent-[var(--color-lime)]" />
          <span>
            <span className="text-ink">Remember on this computer.</span> Otherwise you paste it again next visit. Only use this on
            your own computer.
          </span>
        </label>
      )}

      <p className="border-l-2 border-lime pl-3 text-[13px] leading-snug text-ink">
        Your key stays on this computer. It is sent only to Anthropic, never to Loso.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={busy || !model || !keyChecked || unchanged} onClick={useThis}>
          {busy ? <Loader2 size={14} className="animate-spin motion-reduce:animate-none" aria-hidden /> : null}
          Use this
        </Button>
        {onCancel && (
          <Button variant="ghost" onClick={onCancel}>
            Not now
          </Button>
        )}
        {replacing && (
          <Button variant="ghost" onClick={() => (setReplacing(false), setDraft(""))}>
            Keep the old key
          </Button>
        )}
        {current && (
          <button type="button" onClick={removeKey} className="ml-auto min-h-10 text-[13px] text-danger underline-offset-2 hover:underline">
            Remove key
          </button>
        )}
      </div>

      <div id={`${id}-where`}>
        <GetAKey />
      </div>
    </div>
  );
}
