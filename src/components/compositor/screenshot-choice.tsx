"use client";

import { useEffect, useMemo, useRef } from "react";
import { Button } from "@/components/ui";

// "This looks like a screenshot": asked when a screenshot would otherwise
// land in the video. Two plain choices, the safe one first and focused.
// Esc or Cancel adds nothing; focus goes back where it was.

export interface ShotAction {
  label: string;
  run: () => void;
}

export function ScreenshotChoice({
  files,
  first,
  second,
  detail,
  right,
  onCancel,
}: {
  files: File[];
  first: ShotAction;
  second: ShotAction;
  detail: string;
  /** Keep clear of the floating chat. */
  right: number;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const back = useRef<HTMLElement | null>(null);
  const thumb = useMemo(() => (files[0] ? URL.createObjectURL(files[0]) : null), [files]);
  useEffect(() => () => {
    if (thumb) URL.revokeObjectURL(thumb);
  }, [thumb]);

  useEffect(() => {
    back.current ??= document.activeElement as HTMLElement | null;
    const box = ref.current;
    box?.querySelector<HTMLElement>("[data-first]")?.focus();
    return () => {
      const el = back.current;
      requestAnimationFrame(() => {
        // Still on screen (a dev re-mount): keep focus here.
        if (box?.isConnected) return;
        if (el && el.isConnected && el !== document.body) el.focus();
      });
    };
  }, []);

  const name = files.length === 1 ? files[0].name || "Pasted picture" : `${files.length} pictures`;

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-14 z-[60] flex justify-center px-4" style={{ right }}>
      <div
        ref={ref}
        role="alertdialog"
        aria-labelledby="shot-h"
        aria-describedby="shot-d"
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            onCancel();
          }
        }}
        className="pointer-events-auto flex max-w-[560px] items-start gap-4 border border-line-strong bg-ground/95 p-4 shadow-[0_30px_80px_-20px_var(--color-shade)]"
      >
        {thumb && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumb} alt="" className="h-16 w-auto max-w-24 shrink-0 border border-line object-cover" />
        )}
        <div className="flex min-w-0 flex-col gap-2.5">
          <p id="shot-h" className="font-serif text-[18px] italic leading-snug text-ink">
            This looks like a screenshot.
          </p>
          <p id="shot-d" className="text-[13px] leading-snug text-ink-dim">
            <span className="text-ink">{name}</span>. {detail}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" data-first onClick={first.run}>
              {first.label}
            </Button>
            <Button size="sm" variant="outline" onClick={second.run}>
              {second.label}
            </Button>
            <Button size="sm" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
