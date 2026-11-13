"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ArrowUpRight, Check, ChevronRight, Loader2 } from "lucide-react";
import { Button, cx } from "@/components/ui";
import { friendlyModel, goodFor, isFast } from "@/components/agent/model-chip";
import { pickDefaultModel, topPicks, weakAtEditing, type RankedModel } from "@/lib/ai/models";
import {
  LOCAL_AI_CHANGED,
  connectLocalKey,
  forgetLocalKey,
  getLocalAiSettings,
  keyRemembered,
  listProviderModels,
  localKey,
  maskKey,
  providersWithKeys,
  rankFor,
  setLocalKey,
  switchLocalModel,
} from "@/lib/local/ai";
import { BROWSER_PROVIDERS, DEFAULT_PROVIDER, browserProvider, companyOf, type BrowserProviderId } from "@/lib/local/providers";

// Connecting the browser-only app to an AI: pick who (Claude recommended),
// paste a key, it is checked by itself (listing models is free), pick a
// brain, "Use this". Keys are per provider and stay in this tab's memory;
// "Remember on this computer" also keeps one in this browser's storage.
// Shown in the chat dock and in Settings → AI.

function explain(err: string, provider: BrowserProviderId): string {
  const who = companyOf(provider);
  if (/\b(401|403)\b|api key|x-api-key|authentication|unauthori[sz]ed|permission|incorrect.*key|key not valid/i.test(err)) {
    return `${who} didn't accept this key. Check you copied all of it, or make a new one.`;
  }
  if (/\b402\b|credit|billing|quota|insufficient/i.test(err)) return `${who} says this account has no credit left. Add some on their site, then try again.`;
  if (/failed to fetch|network|couldn't|no response/i.test(err)) return `Couldn't reach ${who}. Check your internet connection and try again.`;
  return err;
}

function GetAKey({ provider }: { provider: BrowserProviderId }) {
  const [open, setOpen] = useState(false);
  const p = browserProvider(provider);
  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex min-h-10 items-center gap-1.5 self-start text-[13px] text-ink-dim transition-colors hover:text-ink"
      >
        <ChevronRight size={13} className={cx("motion-safe:transition-transform", open && "rotate-90")} aria-hidden />
        Where do I get a {p.name} key?
      </button>
      {open && (
        <ol className="ml-1 flex flex-col gap-2 border-l border-line pl-4 text-[13.5px] leading-snug text-ink-dim">
          <li>
            <span className="mr-2 font-mono text-[12px] text-lime">1</span>
            <a href={p.keysUrl} target="_blank" rel="noreferrer" className="text-ink underline-offset-2 hover:underline">
              Open {p.keysSite} <ArrowUpRight size={11} className="inline" aria-hidden />
              <span className="sr-only"> (opens in a new tab)</span>
            </a>{" "}
            and sign in (a grown-up can help).
          </li>
          <li>
            <span className="mr-2 font-mono text-[12px] text-lime">2</span>
            {p.createStep}
          </li>
          <li>
            <span className="mr-2 font-mono text-[12px] text-lime">3</span>Copy it and paste it here. It starts with{" "}
            <span className="font-mono text-[12px] text-ink">{p.keyHint}</span>
          </li>
        </ol>
      )}
    </div>
  );
}

type Current = { provider: BrowserProviderId; model: string; connected: boolean };
type Saved = { masked: string; remembered: boolean } | null;

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
  const [current, setCurrent] = useState<Current | undefined>(undefined);
  const [provider, setProvider] = useState<BrowserProviderId>(DEFAULT_PROVIDER);
  const [withKeys, setWithKeys] = useState<Set<BrowserProviderId>>(new Set());
  const [saved, setSaved] = useState<Saved | undefined>(undefined); // the picked provider's key
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
  const started = useRef(false);

  async function refresh(pick?: BrowserProviderId) {
    const s = await getLocalAiSettings();
    const cur = s?.provider ?? DEFAULT_PROVIDER;
    const keys = await providersWithKeys();
    setWithKeys(keys);
    setCurrent({ provider: cur, model: s?.model ?? "", connected: keys.has(cur) && !!s?.model });
    if (!started.current) {
      started.current = true;
      setProvider(cur);
      if (s?.model) setModel(s.model);
    } else if (pick) setProvider(pick);
  }
  useEffect(() => {
    refresh();
    const on = () => refresh();
    window.addEventListener(LOCAL_AI_CHANGED, on);
    return () => window.removeEventListener(LOCAL_AI_CHANGED, on);
  }, []);

  // The picked provider's saved key, if any.
  useEffect(() => {
    let live = true;
    Promise.all([localKey(provider), keyRemembered(provider)]).then(([k, r]) => {
      if (!live) return;
      setSaved(k ? { masked: maskKey(k), remembered: r } : null);
      setRemember(r);
    });
    return () => {
      live = false;
    };
  }, [provider, withKeys]);

  // With a key in use, its model list loads by itself (free) for the picker.
  const usingSaved = !!saved && !replacing;
  useEffect(() => {
    if (!usingSaved) return;
    const n = ++seq.current;
    setModels(null);
    listProviderModels(provider)
      .then((ids) => {
        if (n !== seq.current) return;
        setModels(ids);
        setModel((cur) => pickDefaultModel(ids, cur));
      })
      .catch((e: Error) => n === seq.current && setFailure(explain(e.message, provider)));
  }, [usingSaved, provider]);

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
      listProviderModels(provider, key)
        .then((ids) => {
          if (n !== seq.current) return;
          setModels(ids);
          setModel((cur) => pickDefaultModel(ids, cur));
          if (!ids.length) setFailure(`This key works, but it can't use any ${browserProvider(provider).name} models that can edit videos.`);
        })
        .catch((e: Error) => n === seq.current && (setModels(null), setFailure(explain(e.message, provider))))
        .finally(() => n === seq.current && setChecking(false));
    }, 400);
    return () => clearTimeout(t);
  }, [draft, usingSaved, provider]);

  function choose(p: BrowserProviderId) {
    if (p === provider) return;
    seq.current++;
    setProvider(p);
    setDraft("");
    setReplacing(false);
    setModels(null);
    setModel(current?.provider === p ? current.model : "");
    setMore(false);
    setFailure(null);
    setChecking(false);
  }

  const ranked = useMemo(() => (models ? rankFor(models) : null), [models]);
  const list: RankedModel[] = ranked ? (more ? ranked : topPicks(ranked, 4)) : [];
  if (ranked && !more && model && !list.some((m) => m.id === model)) {
    const cur = ranked.find((m) => m.id === model);
    if (cur) list.push(cur);
  }
  const strongest = ranked?.find((m) => !weakAtEditing(m.id)) ?? null;
  const picked = ranked?.find((m) => m.id === model) ?? null;
  const weakPick = !!picked && weakAtEditing(picked.id);

  async function useThis() {
    setBusy(true);
    setFailure(null);
    try {
      if (usingSaved) {
        await switchLocalModel(model, picked?.vision ?? false, provider);
        const key = await localKey(provider);
        if (key && remember !== saved?.remembered) await setLocalKey(provider, key, remember);
      } else {
        await connectLocalKey(provider, draft.trim(), remember, model);
        setDraft("");
        setReplacing(false);
      }
      await refresh();
      onConnected?.();
    } catch (e) {
      setFailure(explain((e as Error).message, provider));
    } finally {
      setBusy(false);
    }
  }

  async function removeKey() {
    await forgetLocalKey(provider);
    setModels(null);
    setReplacing(false);
    setFailure(null);
    await refresh();
  }

  const p = browserProvider(provider);
  const wrongShape = !usingSaved && draft.trim().length >= 8 && !p.keyShape.test(draft.trim());
  const keyChecked = usingSaved ? !!ranked : !!ranked && !checking;
  const unchanged =
    usingSaved && current?.provider === provider && model === current?.model && remember === saved?.remembered;

  return (
    <div className={cx("flex flex-col gap-5", className)}>
      {heading && (
        <div className="flex flex-col gap-2">
          <h3 className="font-serif text-[26px] font-light italic leading-tight text-ink">
            {current?.connected ? "Loso is ready to think." : "Loso needs a key to think."}
          </h3>
          {!current?.connected && (
            <p className="text-[13.5px] leading-relaxed text-ink-dim">A key is like a library card for an AI. Pick one, paste its key once.</p>
          )}
        </div>
      )}

      {failure && (
        <p role="alert" className="border-l-2 border-danger pl-3 text-[13.5px] leading-snug text-danger">
          {failure}
        </p>
      )}

      <fieldset className="flex flex-col">
        <legend className="mb-2 font-mono text-[11px] uppercase tracking-[0.12em] text-ink-dim">Which AI?</legend>
        {BROWSER_PROVIDERS.map((bp) => (
          <label
            key={bp.id}
            className={cx(
              "flex min-h-11 cursor-pointer items-start gap-3 border-t border-line py-2",
              provider === bp.id ? "text-ink" : "text-ink-dim hover:text-ink"
            )}
          >
            <input
              type="radio"
              name={`${id}-provider`}
              checked={provider === bp.id}
              onChange={() => choose(bp.id)}
              className="mt-1 accent-[var(--color-lime)]"
            />
            <span className="flex min-w-0 flex-col">
              <span className="text-[14px]">
                {bp.name}
                {bp.id === "anthropic" && <span className="ml-2 text-[11px] text-lime">Recommended</span>}
                {current?.connected && current.provider === bp.id ? (
                  <span className="ml-2 text-[11px] text-ink-dim">in use</span>
                ) : withKeys.has(bp.id) ? (
                  <span className="ml-2 text-[11px] text-ink-dim">key added</span>
                ) : null}
              </span>
              <span className="text-[12.5px] leading-snug text-ink-dim">{bp.blurb}</span>
            </span>
          </label>
        ))}
      </fieldset>

      {saved === undefined || current === undefined ? (
        <p role="status" className="text-[13px] text-ink-dim">
          Loading…
        </p>
      ) : usingSaved ? (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 border-l-2 border-line-strong pl-3 text-[13.5px] leading-snug text-ink-dim">
          <span>
            Using your {p.name} key <span className="font-mono text-[12px] text-ink">{saved!.masked}</span>
            {saved!.remembered ? ", remembered on this computer." : ", for this visit only."}
          </span>
          <button type="button" onClick={() => setReplacing(true)} className="min-h-8 text-ink underline-offset-2 hover:underline">
            Use a different key
          </button>
        </p>
      ) : (
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] text-ink-dim">Paste your {p.name} key</span>
          <input
            type="password"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            placeholder={p.keyHint}
            aria-describedby={`${id}-where`}
            className="uline font-mono text-[13px]"
          />
          {wrongShape && !checking && !keyChecked && (
            <span className="text-[12.5px] text-ink-dim">
              {p.name} keys usually start with <span className="font-mono text-ink">{p.keyHint}</span>. Check you copied the right one.
            </span>
          )}
          {checking && (
            <span role="status" className="flex items-center gap-1.5 text-[12.5px] text-ink-dim">
              <Loader2 size={12} className="animate-spin motion-reduce:animate-none" aria-hidden /> Checking the key…
            </span>
          )}
          {keyChecked && !checking && list.length > 0 && (
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
              <span className="flex min-w-0 flex-col">
                <span className="font-serif text-[16px] italic">
                  {friendlyModel(m.id)}
                  {i === 0 && !more && <span className="ml-2 font-sans text-[11px] not-italic text-lime">Recommended</span>}
                </span>
                <span className="text-[12.5px] text-ink-dim">
                  Good for: {goodFor(m.id).toLowerCase()}
                  {m.vision ? " · sees pictures" : " · can't see pictures"}
                  {isFast(m.id) ? " · fast" : ""}
                  {weakAtEditing(m.id) ? " · small, may get edits wrong" : ""}
                </span>
              </span>
            </label>
          ))}
          {ranked && ranked.length > list.length && !more && (
            <button type="button" onClick={() => setMore(true)} className="min-h-10 self-start text-[13px] text-ink-dim hover:text-ink">
              Show all {ranked.length}
            </button>
          )}
        </fieldset>
      )}

      {weakPick && (
        <p className="border-l-2 border-line-strong pl-3 text-[13px] leading-snug text-ink-dim">
          {friendlyModel(picked!.id)} is a small model. It&rsquo;s cheap, but it often gets video edits wrong.
          {strongest && strongest.id !== picked!.id ? (
            <>
              {" "}
              <button type="button" onClick={() => setModel(strongest.id)} className="min-h-8 text-ink underline-offset-2 hover:underline">
                Use {friendlyModel(strongest.id)} instead
              </button>
            </>
          ) : provider !== "anthropic" ? (
            " Claude does this job best."
          ) : null}
        </p>
      )}

      {saved !== undefined && (
        <label className="flex min-h-10 cursor-pointer items-start gap-2.5 text-[13.5px] leading-snug text-ink-dim">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="mt-0.5 accent-[var(--color-lime)]" />
          <span>
            <span className="text-ink">Remember on this computer.</span> Otherwise you paste it again next visit. Only use this on
            your own computer.
          </span>
        </label>
      )}

      <p className="border-l-2 border-lime pl-3 text-[13px] leading-snug text-ink">
        Your key stays on this computer. It is sent only to {companyOf(provider)}, never to Loso.
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
        {saved && (
          <button type="button" onClick={removeKey} className="ml-auto min-h-10 text-[13px] text-danger underline-offset-2 hover:underline">
            Remove {p.name} key
          </button>
        )}
      </div>

      <div id={`${id}-where`}>
        <GetAKey provider={provider} />
      </div>
    </div>
  );
}
