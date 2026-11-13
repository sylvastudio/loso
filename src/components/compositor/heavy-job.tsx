"use client";

import { useEffect, useRef } from "react";
import { Button } from "@/components/ui";
import { fmtBytes, type JobEstimate } from "@/lib/local/memory";

// "This is a big video for this computer": asked before making a video that
// looks heavy for this machine, or that has clips the browser can't read.
// It never blocks: the safe choice (a quick test) comes first and is focused,
// "Make the whole video" is always there, Esc or Not now does nothing.

export type HeavyChoice = "test" | "full" | "cancel";

function clock(sec: number) {
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function HeavyJobAsk({
  est,
  unreadable,
  canTest,
  right,
  onChoose,
}: {
  est: JobEstimate;
  unreadable: Array<{ clip: string; why: string }>;
  /** The backend can make a quick small test copy. */
  canTest: boolean;
  /** Keep clear of the floating chat. */
  right: number;
  onChoose: (c: HeavyChoice) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const back = useRef<HTMLElement | null>(null);

  useEffect(() => {
    back.current ??= document.activeElement as HTMLElement | null;
    const box = ref.current;
    box?.querySelector<HTMLElement>("[data-first]")?.focus();
    return () => {
      const el = back.current;
      requestAnimationFrame(() => {
        if (box?.isConnected) return;
        if (el && el.isConnected && el !== document.body) el.focus();
      });
    };
  }, []);

  const heavy = est.load !== "light";
  const names = unreadable.map((u) => u.clip.split("/").pop()).slice(0, 3).join(", ") + (unreadable.length > 3 ? "…" : "");

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-14 z-[60] flex justify-center px-4" style={{ right }}>
      <div
        ref={ref}
        role="alertdialog"
        aria-labelledby="heavy-h"
        aria-describedby="heavy-d"
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            onChoose("cancel");
          }
        }}
        className="pointer-events-auto flex max-w-[600px] flex-col gap-3 border border-line-strong bg-ground/95 p-5 shadow-[0_30px_80px_-20px_var(--color-shade)]"
      >
        <p id="heavy-h" className="font-serif text-[20px] font-light italic leading-snug text-ink">
          {heavy ? "This is a big video for this computer." : "Some clips may come out black."}
        </p>
        <div id="heavy-d" className="flex flex-col gap-2 text-[13.5px] leading-snug text-ink-dim">
          {heavy && (
            <p>
              It&rsquo;s <span className="tabular-nums text-ink">{clock(est.seconds)}</span> long
              {est.clipsAtOnce > 1 && <>, with {est.clipsAtOnce} clips playing at the same time</>}. Making it could use
              about <span className="text-ink">{fmtBytes(est.peakBytes)}</span> of memory
              {est.ramGB !== null && <> (this computer says it has {est.ramGB < 8 ? "about" : "at least"} {est.ramGB} GB)</>}, so other
              apps may get slow{est.load === "very-heavy" && <> and the browser could stop halfway</>}.
            </p>
          )}
          {unreadable.length > 0 && (
            <p>
              <span className="text-ink">{names}</span>: this browser can&rsquo;t play {unreadable.length === 1 ? "it" : "them"}, so{" "}
              {unreadable.length === 1 ? "that part" : "those parts"} may come out black. Saving {unreadable.length === 1 ? "it" : "them"} again as
              an MP4 (H.264) fixes it (a grown-up can help).
            </p>
          )}
          {heavy && (
            <ul className="flex flex-col gap-1 pl-0">
              <li>
                <span className="mr-2 font-mono text-[11px] text-lime">1</span>Close other tabs and apps first.
              </li>
              <li>
                <span className="mr-2 font-mono text-[11px] text-lime">2</span>Keep this tab open until it&rsquo;s done.
              </li>
            </ul>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {canTest && (
            <Button size="sm" data-first onClick={() => onChoose("test")} title="The first 10 seconds, smaller. Quick to check it works.">
              Make a quick test first
            </Button>
          )}
          <Button size="sm" variant={canTest ? "outline" : "primary"} data-first={canTest ? undefined : true} onClick={() => onChoose("full")}>
            {heavy ? "Make the whole video" : "Make it anyway"}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => onChoose("cancel")}>
            Not now
          </Button>
        </div>
        {canTest && <p className="text-[12px] text-ink-faint">The test is the first 10 seconds, smaller. It doesn&rsquo;t replace your video.</p>}
      </div>
    </div>
  );
}
