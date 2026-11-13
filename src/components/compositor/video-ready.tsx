"use client";

import { useEffect, useId, useRef } from "react";
import { Download, FolderOpen } from "lucide-react";
import { Button, cx } from "@/components/ui";
import { LosoMark } from "@/components/logo";

// "Done." — the moment after Make the video / Update the video finishes.
// A calm card over the stage: the finished video to play right here, where
// it was saved (folder projects), Download and Close. Focus moves in and
// comes back to the button that made it; Esc closes. Its only motion is a
// short rise that the global reduced-motion rule turns off.

export function VideoReady({
  url,
  fileName,
  savedAs,
  folderName,
  aspect,
  right,
  onClose,
}: {
  url: string;
  /** Suggested name for Download. */
  fileName: string;
  /** "exports/My video.mp4" — folder projects only. */
  savedAs?: string | null;
  folderName?: string;
  /** width / height of the video, so the preview keeps its shape. */
  aspect: number;
  /** Space kept clear on the right for the chat dock. */
  right: number;
  onClose: () => void;
}) {
  const ids = useId();
  const ref = useRef<HTMLDivElement>(null);
  const downloadRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    downloadRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  // Keep Tab inside the card while it's open.
  function trap(e: React.KeyboardEvent) {
    if (e.key !== "Tab" || !ref.current) return;
    const f = Array.from(ref.current.querySelectorAll<HTMLElement>("a[href], button:not([disabled]), video[controls]"));
    if (!f.length) return;
    const first = f[0];
    const last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  const tall = aspect < 1;

  return (
    <div className="absolute inset-y-0 left-0 z-[60] flex items-center justify-center p-4" style={{ right }}>
      <div className="absolute inset-0 bg-scrim" aria-hidden onPointerDown={onClose} />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${ids}-h`}
        aria-describedby={`${ids}-d`}
        onKeyDown={trap}
        className={cx(
          "rise relative flex max-h-full w-full flex-col gap-5 overflow-y-auto border border-line-strong bg-ground p-6 shadow-[0_30px_90px_-20px_var(--color-shade)]",
          tall ? "max-w-[620px] sm:flex-row sm:items-stretch" : "max-w-[640px]"
        )}
        style={{ borderRadius: 2 }}
      >
        <div className={cx("theme-dark flex shrink-0 items-center justify-center bg-stage", tall ? "sm:w-[46%]" : "w-full")}>
          {/* The finished file itself, muted until you press play. */}
          <video
            src={url}
            controls
            playsInline
            preload="metadata"
            aria-label="Your finished video"
            className="block max-h-[56vh] w-full object-contain"
            style={{ aspectRatio: String(aspect) }}
          />
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-3">
            <LosoMark size={28} />
            <span className="h-px flex-1 bg-lime" aria-hidden />
          </div>
          <h2
            id={`${ids}-h`}
            className="mt-4 font-serif text-[clamp(44px,6vw,64px)] font-light italic leading-[0.95] tracking-[-0.03em] text-ink"
          >
            Done.
          </h2>
          <div id={`${ids}-d`} className="mt-3 flex flex-col gap-2 text-[14px] leading-relaxed text-ink-dim">
            <p>Your video is ready. Play it here, or download it to share.</p>
            {savedAs && (
              <p className="flex items-start gap-1.5">
                <FolderOpen size={14} className="mt-[4px] shrink-0" aria-hidden />
                <span className="min-w-0">
                  Saved in {folderName ? <>your folder <span className="text-ink">“{folderName}”</span></> : "your folder"}:
                  <span className="mt-0.5 block font-mono text-[12.5px] text-ink [overflow-wrap:anywhere]">{savedAs}</span>
                </span>
              </p>
            )}
          </div>
          <div className="mt-auto flex flex-wrap items-center gap-3 pt-6">
            <a
              ref={downloadRef}
              href={url}
              download={fileName}
              className="inline-flex h-10 items-center justify-center gap-2 whitespace-nowrap rounded-full bg-lime-fill px-5 text-sm font-semibold text-black transition-colors hover:bg-lime-deep"
            >
              <Download size={15} aria-hidden /> Download
            </a>
            <Button variant="ghost" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
