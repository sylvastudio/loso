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
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          setDraft(value);
          // blur after state resets so commit() sees the original value
          requestAnimationFrame(() => (e.target as HTMLInputElement).blur());
        }
      }}
      size={Math.max(8, Math.min(40, draft.length + 1))}
      className="min-w-0 border-b border-transparent bg-transparent font-serif text-[16px] italic tracking-tight text-ink outline-none transition-colors hover:border-line-strong focus:border-lime"
    />
  );
}

// ---------- Save status word ----------

export type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";

export function SaveStatus({ state, onRetry }: { state: SaveState; onRetry?: () => void }) {
  if (state === "idle") return null;
  if (state === "error") {
    return (
      <button
        type="button"
        onClick={onRetry}
        className="micro !text-danger underline-offset-2 hover:underline"
        role="alert"
      >
        Save failed — retry
      </button>
    );
  }
  return (
    <span
      className={cx("micro", state === "saved" ? "text-ink-faint" : "text-ink-dim")}
      aria-live="polite"
    >
      {state === "saved" ? "Saved" : "Saving…"}
    </span>
  );
}

// ---------- Narrow-window notice ----------
// The editors use fixed side rails; below ~768px the stage collapses.

export function NarrowScreenNote() {
  return (
    <div className="border-b border-line bg-panel px-5 py-2.5 md:hidden">
      <p className="font-serif text-[14px] italic text-ink-dim">
        Loso&rsquo;s editor is built for a desktop-width window — widen it for the full canvas.
      </p>
    </div>
  );
}
