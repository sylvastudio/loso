"use client";

import { Captions } from "lucide-react";
import { cx } from "@/components/ui";
import type { CompositorDoc } from "@/lib/compositor";
import { captionsOf, clockTime, spokenTime } from "@/lib/caption-set";

export { Captions as WordsIcon };

// ---------- captions folded into one row ----------
// The Story drawer shows every caption as one "Words on screen" row with the
// words themselves as segments, instead of a staircase of N rows. The pieces
// rail shows them as a single entry. Both open the Words on screen manager.

export function WordsStoryRow({
  doc,
  activeId,
  onOpen,
}: {
  doc: CompositorDoc;
  activeId: string | null;
  onOpen: (id: string) => void;
}) {
  const { fps, durationInFrames } = doc.output;
  const total = Math.max(1, durationInFrames);
  const caps = captionsOf(doc);
  if (!caps.length) return null;
  return (
    <div role="group" aria-label={`Words on screen, ${caps.length} lines`} className="flex flex-col gap-0.5 py-1">
      <span className="flex items-center gap-1.5 text-[11.5px] text-ink-dim">
        <Captions size={12} aria-hidden />
        Words on screen · {caps.length} {caps.length === 1 ? "line" : "lines"}
      </span>
      <div className="relative h-8 w-full bg-panel">
        {caps.map((c, i) => {
          const left = (c.from / total) * 100;
          const w = (Math.min(c.durationInFrames, total - c.from) / total) * 100;
          const on = c.id === activeId;
          return (
            <button
              key={c.id}
              type="button"
              aria-pressed={on}
              aria-label={`Line ${i + 1}: ${c.text}, ${spokenTime(c.from, fps)} to ${spokenTime(c.from + c.durationInFrames, fps)}`}
              title={`${clockTime(c.from, fps)} → ${clockTime(c.from + c.durationInFrames, fps)}  ${c.text}`}
              onClick={() => onOpen(c.id)}
              className={cx(
                "absolute top-0 flex h-full min-w-0 items-center overflow-hidden border-l px-1 text-left text-[11.5px] leading-none transition-colors",
                on ? "border-black bg-lime text-black" : "border-lime/70 text-ink hover:bg-line-strong",
              )}
              style={{ left: `${left}%`, width: `${Math.max(0.6, w)}%` }}
            >
              <span className="truncate">{c.text}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** The single "Words on screen" entry in the pieces list. */
export function WordsPiecesRow({ doc, onOpen }: { doc: CompositorDoc; onOpen: () => void }) {
  const caps = captionsOf(doc);
  if (!caps.length) return null;
  const sample = caps[0].text;
  return (
    <li className="flex items-center border-b border-line">
      <button
        type="button"
        onClick={onOpen}
        className="group flex min-h-12 min-w-0 flex-1 items-center gap-2.5 py-1.5 text-left text-[13.5px] text-ink-dim transition-colors hover:text-ink"
      >
        <Captions size={14} className="shrink-0" aria-hidden />
        <span className="w-[54px] shrink-0 text-[12px] text-ink-faint">Subtitles</span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-ink">Words on screen</span>
          <span className="truncate text-[12.5px] text-ink-dim">
            {caps.length} {caps.length === 1 ? "line" : "lines"} · <span className="font-serif italic">“{sample}”</span>
          </span>
        </span>
      </button>
    </li>
  );
}
