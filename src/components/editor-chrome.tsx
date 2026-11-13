"use client";

import { useEffect, useState } from "react";
import { cx } from "@/components/ui";

// ---------- Inline-editable project title ----------
// Enter / blur saves, Escape restores, empty falls back to "Untitled".

export function EditableTitle({
  value,
  onSave,
}: {
  value: string;
  onSave: (title: string) => void | Promise<void>;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);

  function commit() {
    const next = draft.trim() || "Untitled";
    setDraft(next);
    if (next !== value) onSave(next);
  }

  return (
    <input
      value={draft}
      aria-label="Project title"
      title="Rename project"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.nativeEvent.isComposing) return;
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          setDraft(value);
          // blur after state resets so commit() sees the original value
          requestAnimationFrame(() => (e.target as HTMLInputElement).blur());
        }
      }}
      size={Math.max(8, Math.min(40, draft.length + 1))}
      className="min-w-0 max-w-full truncate border-b border-transparent bg-transparent font-serif text-[18px] italic tracking-tight text-ink outline-none transition-colors hover:border-line-strong focus:border-lime"
    />
  );
}

// ---------- Save status word ----------

export type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";

export function SaveStatus({
  state,
  onRetry,
  compact = false,
}: {
  state: SaveState;
  onRetry?: () => void;
  /** Phones: just the dot (the word is kept for screen readers). */
  compact?: boolean;
}) {
  if (state === "idle") return null;
  if (state === "error") {
    return (
      <button
        type="button"
        onClick={onRetry}
        className="min-h-8 text-[12.5px] text-danger underline-offset-2 hover:underline"
        role="alert"
      >
        {compact ? "Retry save" : <>Couldn&rsquo;t save. Try again</>}
      </button>
    );
  }
  return (
    // Visual only: a polite region that flips every 400ms of typing would
    // make screen readers chatty. Failures still announce (role=alert above).
    <span className="flex shrink-0 items-center gap-1.5 text-[12.5px] text-ink-dim">
      <span
        aria-hidden
        className={cx("h-1.5 w-1.5 rounded-full", state === "saved" ? "bg-lime/70" : "bg-ink-faint")}
      />
      <span className={cx(compact && "sr-only")}>{state === "saved" ? "Saved" : "Saving…"}</span>
    </span>
  );
}

// ---------- Phone layout ----------
// Phones (and very narrow windows) get the stage-first editor: the video on
// top, Loso / Pieces / Story as tabs below it. A phone turned sideways keeps
// it too, with the tabs beside the video.

const PHONE_QUERY = "(max-width: 767.98px), (max-height: 500px) and (pointer: coarse)";
const LANDSCAPE_QUERY = "(orientation: landscape)";

const matches = (q: string) => typeof window !== "undefined" && window.matchMedia(q).matches;

export function usePhoneLayout() {
  // The editor mounts on the client only, so the first render can read the window.
  const [state, setState] = useState(() => ({ phone: matches(PHONE_QUERY), landscape: matches(LANDSCAPE_QUERY) }));
  useEffect(() => {
    const a = window.matchMedia(PHONE_QUERY);
    const b = window.matchMedia(LANDSCAPE_QUERY);
    const on = () => setState({ phone: a.matches, landscape: b.matches });
    on();
    a.addEventListener("change", on);
    b.addEventListener("change", on);
    return () => {
      a.removeEventListener("change", on);
      b.removeEventListener("change", on);
    };
  }, []);
  return state;
}
