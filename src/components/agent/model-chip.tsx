"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Loader2 } from "lucide-react";
import { cx } from "@/components/ui";
import { fetchJson, jsonInit } from "@/lib/fetch-json";
import { rankModels, topPicks, type RankedModel } from "@/lib/ai/models";
import { useChatApi } from "@/components/agent/chat-api";

// The model in use, said like a person would ("Claude Sonnet 4.5 · sees
// pictures"), switchable in one click from a popover of the best models for
// the saved key. The raw id stays in the tooltip and the "Details" line.

const WORDS: Record<string, string> = {
  gpt: "GPT",
  oss: "OSS",
  claude: "Claude",
  llama: "Llama",
  qwen: "Qwen",
  gemini: "Gemini",
  grok: "Grok",
  mistral: "Mistral",
  kimi: "Kimi",
  deepseek: "DeepSeek",
  versatile: "",
  instruct: "",
  latest: "",
  preview: "preview",
};

/** "openai/gpt-oss-120b" → "GPT OSS 120B"; "claude-sonnet-4-5-20250929" → "Claude Sonnet 4.5". */
export function friendlyModel(id: string): string {
  let s = id.split("/").pop() ?? id;
  s = s.replace(/-\d{8}$/, "").replace(/:.*$/, "");
  // claude-sonnet-4-5 → claude sonnet 4.5
  s = s.replace(/(\d+)-(\d+)(?=$|-)/g, "$1.$2");
  const out = s
    .split(/[-_\s]+/)
    .map((w) => {
      const lower = w.toLowerCase();
      if (lower in WORDS) return WORDS[lower];
      if (/^\d+(\.\d+)?b$/i.test(w)) return w.toUpperCase();
      if (/^[a-z]/.test(w)) return w.charAt(0).toUpperCase() + w.slice(1);
      return w;
    })
    .filter(Boolean)
    .join(" ");
  return out || id;
}

/** One line on what a model is good for, from its family. */
export function goodFor(id: string): string {
  if (/fable/i.test(id)) return "Smartest";
  if (/opus/i.test(id)) return "Very smart, best for big builds";
  if (/405b|-large|k2/i.test(id)) return "Big builds, slower";
  if (/haiku|mini|nano|flash|small|8b|lite|instant/i.test(id)) return "Fast, good for small tweaks";
  if (/sonnet|gpt-5|gpt-4\.1|gpt-4o|120b|70b|pro/i.test(id)) return "Best all-rounder";
  return "Can edit your video";
}

export function isFast(id: string) {
  return /haiku|mini|nano|flash|small|8b|lite|instant|groq/i.test(id);
}

/** The best model on this key that can look at pictures, if any. */
export function bestVisionModel(ids: string[], current: string): RankedModel | null {
  return rankModels(ids).chat.find((m) => m.vision && m.id !== current) ?? null;
}

export async function switchModel(m: RankedModel) {
  await fetchJson("/api/ai/config", jsonInit("PUT", { model: m.id, vision: m.vision }));
  // The key check runs by itself after a switch; the result shows in the dock.
  await fetchJson("/api/ai/test", jsonInit("POST", {})).catch(() => {});
}

export function ModelChip({
  model,
  vision,
  busy,
  onSwitched,
  onManage,
  usageNote,
}: {
  model: string;
  vision: boolean;
  busy: boolean;
  /** e.g. "This chat: 48k tokens in · ~$0.21", shown on hover. */
  usageNote?: string;
  onSwitched: (name: string) => void;
  /** Change key or provider (the full connect flow). */
  onManage: () => void;
}) {
  const [open, setOpen] = useState(false);
  const chipRef = useRef<HTMLButtonElement>(null);
  const name = friendlyModel(model);
  return (
    <div className="relative min-w-0">
      <button
        ref={chipRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Model: ${name}${vision ? ", sees pictures" : ", can't see pictures"}. Change model`}
        title={usageNote ? `${model}\n${usageNote}` : model}
        onClick={() => setOpen((o) => !o)}
        className="flex h-8 min-w-0 max-w-full items-center gap-1.5 border border-edge/60 px-2.5 text-[12.5px] text-ink transition-colors hover:border-lime"
        style={{ borderRadius: 2 }}
      >
        <span className="truncate">{name}</span>
        <span className="shrink-0 text-ink-dim">· {vision ? "sees pictures" : "words only"}</span>
        <ChevronDown size={13} className="shrink-0 text-ink-dim" />
      </button>
      {open && (
        <ModelPopover
          current={model}
          busy={busy}
          onClose={() => {
            setOpen(false);
            chipRef.current?.focus();
          }}
          onPicked={(m) => {
            setOpen(false);
            chipRef.current?.focus();
            onSwitched(friendlyModel(m.id));
          }}
          onManage={() => {
            setOpen(false);
            onManage();
          }}
        />
      )}
    </div>
  );
}

function ModelPopover({
  current,
  busy,
  onClose,
  onPicked,
  onManage,
}: {
  current: string;
  busy: boolean;
  onClose: () => void;
  onPicked: (m: RankedModel) => void;
  onManage: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [ranked, setRanked] = useState<RankedModel[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const [switching, setSwitching] = useState<string | null>(null);

  // Inside a chat panel the panel's agent knows where models come from (server or this browser).
  const api = useChatApi();
  useEffect(() => {
    (api ? api.models() : fetchJson<{ models: string[] }>("/api/ai/models").then((d) => d.models))
      .then((ids) => setRanked(api?.rank ? api.rank(ids) : rankModels(ids).chat))
      .catch((e: Error) => setError(e.message));
  }, [api]);

  // Modal popover: Esc closes, Tab stays inside, focus returns to the chip.
  useEffect(() => {
    const el = ref.current;
    el?.querySelector<HTMLElement>("[data-autofocus], button")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
      if (e.key !== "Tab" || !el) return;
      const f = el.querySelectorAll<HTMLElement>("button:not([disabled])");
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) {
        e.preventDefault();
        f[f.length - 1].focus();
      } else if (!e.shiftKey && document.activeElement === f[f.length - 1]) {
        e.preventDefault();
        f[0].focus();
      }
    };
    const onDown = (e: MouseEvent) => {
      if (el && !el.contains(e.target as Node) && !(e.target as HTMLElement).closest("[aria-haspopup=dialog]")) onClose();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [onClose, ranked]);

  async function pick(m: RankedModel) {
    if (m.id === current || busy) return;
    setSwitching(m.id);
    try {
      await (api ? api.switchModel(m) : switchModel(m));
      onPicked(m);
    } catch (e) {
      setError((e as Error).message);
      setSwitching(null);
    }
  }

  const list = ranked ? (more ? ranked : topPicks(ranked, 3)) : [];
  if (ranked && !more && !list.some((m) => m.id === current)) {
    const cur = ranked.find((m) => m.id === current);
    if (cur) list.push(cur);
  }

  return (
    <div
      ref={ref}
      role="dialog"
      aria-modal="true"
      aria-label="Choose the AI model"
      className="absolute left-0 top-full z-50 mt-2 flex max-h-[60vh] w-[320px] flex-col border border-line-strong bg-ground shadow-[0_30px_80px_-20px_var(--color-shade)]"
      style={{ borderRadius: 2 }}
    >
      <div className="border-b border-line px-4 pb-2.5 pt-3.5">
        <p className="font-serif text-[17px] italic text-ink">Which brain should Loso use?</p>
        <p className="mt-0.5 text-[12.5px] text-ink-dim">The change starts with your next message.</p>
      </div>
      {busy && (
        <p className="border-b border-line px-4 py-2 text-[12.5px] text-ink" role="status">
          Wait until Loso finishes, then switch.
        </p>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto" role="radiogroup" aria-label="Models">
        {!ranked && !error && (
          <p className="flex items-center gap-2 px-4 py-4 text-[13px] text-ink-dim" role="status">
            <Loader2 size={13} className="animate-spin" /> Finding models for your key…
          </p>
        )}
        {error && <p className="px-4 py-3 text-[12.5px] text-danger" role="alert">{error}</p>}
        {list.map((m, i) => {
          const on = m.id === current;
          const traits = [i === 0 && !more ? "Recommended" : null, m.vision ? "sees pictures" : "words only", isFast(m.id) ? "fast" : null]
            .filter(Boolean)
            .join(" · ");
          return (
            <button
              key={m.id}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={busy || !!switching}
              data-autofocus={on || undefined}
              onClick={() => pick(m)}
              title={m.id}
              className={cx(
                "flex w-full items-start gap-3 border-b border-line px-4 py-3 text-left transition-colors last:border-b-0 disabled:cursor-not-allowed",
                on ? "bg-lime/[0.06]" : "hover:bg-panel"
              )}
            >
              <span className="mt-1 flex h-4 w-4 shrink-0 items-center justify-center">
                {switching === m.id ? (
                  <Loader2 size={13} className="animate-spin text-lime" />
                ) : on ? (
                  <Check size={14} className="text-lime" />
                ) : (
                  <span className="h-2 w-2 rounded-full border border-edge" />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] text-ink">{friendlyModel(m.id)}</span>
                <span className="block text-[12.5px] text-ink-dim">{goodFor(m.id)}</span>
                <span className="mt-0.5 block text-[12px] text-ink-faint">{traits}</span>
              </span>
            </button>
          );
        })}
      </div>
      <div className="flex items-center justify-between border-t border-line px-4 py-2">
        {ranked && ranked.length > 3 ? (
          <button type="button" onClick={() => setMore((v) => !v)} className="min-h-10 text-[12.5px] text-ink-dim hover:text-ink">
            {more ? "Fewer models" : `More models (${ranked.length - 3}) ▸`}
          </button>
        ) : (
          <span />
        )}
        <button type="button" onClick={onManage} disabled={busy} className="min-h-10 text-[12.5px] text-ink-dim hover:text-lime disabled:opacity-50">
          Change key or provider
        </button>
      </div>
      <p className="border-t border-line px-4 py-2 font-mono text-[11px] text-ink-faint">Details: {current}</p>
    </div>
  );
}
