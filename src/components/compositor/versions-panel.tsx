"use client";

import { useEffect, useRef, useState } from "react";
import { Redo2, Undo2, X } from "lucide-react";
import { Button, cx } from "@/components/ui";
import { clock, timeline, type History } from "./history";

// Versions: every change this visit, newest first, in plain words. Pointing
// at one previews it on the stage; "Go back to this" adds it again as the
// newest version, so nothing is ever thrown away.

const BY: Record<string, string> = { you: "You", loso: "Loso", start: "Starting point", outside: "Another window", open: "" };

export function VersionsPanel({
  hist,
  onPreview,
  onRestore,
  onUndo,
  onRedo,
  onClose,
}: {
  hist: History;
  /** Index into timeline(hist), or null to show the current video again. */
  onPreview: (index: number | null) => void;
  onRestore: (index: number) => void;
  onUndo: () => void;
  onRedo: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const all = timeline(hist);
  const rows = all.map((s, i) => ({ ...s, i })).reverse();
  const [picked, setPicked] = useState<number | null>(null);

  useEffect(() => {
    ref.current?.querySelector<HTMLElement>("[aria-checked=true]")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => onPreview(picked), [picked, onPreview]);
  useEffect(() => () => onPreview(null), [onPreview]);

  const target = picked !== null ? all[picked] : null;

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Versions"
      className="absolute right-3 top-3 z-50 flex max-h-[calc(100%-24px)] w-[340px] flex-col border border-line-strong bg-black shadow-[0_30px_80px_-20px_rgba(0,0,0,1)]"
      style={{ borderRadius: 2 }}
    >
      <div className="flex items-start gap-3 border-b border-line px-4 pb-3 pt-3.5">
        <div className="min-w-0 flex-1">
          <h2 className="font-serif text-[20px] italic leading-tight text-ink">Versions</h2>
          <p className="mt-0.5 text-[12.5px] leading-snug text-ink-dim">
            Pick one to look at it. Going back never throws anything away.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close versions"
          className="-mr-2 flex h-10 w-10 shrink-0 items-center justify-center text-ink-dim hover:text-ink"
        >
          <X size={16} />
        </button>
      </div>

      <div className="flex items-center gap-1 border-b border-line px-2 py-1">
        <button
          type="button"
          onClick={onUndo}
          disabled={!hist.past.length}
          className="flex min-h-10 items-center gap-1.5 px-2 text-[13px] text-ink transition-colors hover:text-lime disabled:text-ink-faint"
        >
          <Undo2 size={14} aria-hidden /> Undo
        </button>
        <button
          type="button"
          onClick={onRedo}
          disabled={!hist.future.length}
          className="flex min-h-10 items-center gap-1.5 px-2 text-[13px] text-ink transition-colors hover:text-lime disabled:text-ink-faint"
        >
          <Redo2 size={14} aria-hidden /> Redo
        </button>
        <span className="ml-auto pr-2 font-mono text-[11px] text-ink-dim">
          {all.length} version{all.length === 1 ? "" : "s"}
        </span>
      </div>

      <ol role="radiogroup" aria-label="Pick a version to look at" className="min-h-0 flex-1 overflow-y-auto py-1">
        {rows.map((s, n) => {
          const on = picked === s.i || (picked === null && s.current);
          return (
            <li key={s.i} className="relative flex">
              {/* film strip edge */}
              <span aria-hidden className="sprocket w-4 shrink-0" />
              <button
                type="button"
                role="radio"
                aria-checked={on}
                tabIndex={on ? 0 : -1}
                onClick={() => setPicked(s.current ? null : s.i)}
                onKeyDown={(e) => {
                  if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
                  e.preventDefault();
                  const next = rows[n + (e.key === "ArrowDown" ? 1 : -1)];
                  if (!next) return;
                  setPicked(next.current ? null : next.i);
                  const btns = ref.current?.querySelectorAll<HTMLElement>("[role=radio]");
                  btns?.[n + (e.key === "ArrowDown" ? 1 : -1)]?.focus();
                }}
                className={cx(
                  "flex min-h-12 flex-1 items-start gap-3 border-b border-line py-2.5 pl-2 pr-4 text-left transition-colors",
                  on ? "bg-lime/[0.07]" : "hover:bg-panel"
                )}
              >
                <span
                  aria-hidden
                  className={cx(
                    "mt-1 h-[22px] w-[14px] shrink-0 border",
                    s.current ? "border-lime bg-lime" : on ? "border-lime" : "border-edge"
                  )}
                />
                <span className="min-w-0 flex-1">
                  <span className={cx("block text-[13.5px] leading-snug", s.undone ? "text-ink-dim" : "text-ink")}>{s.meta.label}</span>
                  <span className="mt-0.5 block text-[12px] text-ink-dim">
                    {[BY[s.meta.by], clock(s.meta.at), s.current ? "showing now" : s.undone ? "undone" : null]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      <div className="border-t border-line p-3">
        {target && !target.current ? (
          <Button className="w-full" onClick={() => picked !== null && onRestore(picked)}>
            Go back to this ({clock(target.meta.at)})
          </Button>
        ) : (
          <p className="text-center text-[12.5px] text-ink-dim">Pick a version above to look at it.</p>
        )}
      </div>
    </div>
  );
}
