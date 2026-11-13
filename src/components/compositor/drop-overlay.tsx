"use client";

import { useEffect, useRef, useState } from "react";
import { cx } from "@/components/ui";

// Drop anywhere: dragging files over the editor shows two big targets split
// by a hairline, like a folded sheet of paper.
//   Give it to Loso   — into the chat as an attachment (Loso decides)
//   Put it in the video — the editor's own import
// Drops outside the targets are swallowed so the browser never navigates
// away to the file. Both actions also have buttons (Add files, the paperclip).

export function useWindowFileDrag() {
  const [types, setTypes] = useState<string[] | null>(null);
  const depth = useRef(0);
  useEffect(() => {
    const hasFiles = (e: DragEvent) => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes("Files");
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth.current += 1;
      setTypes(Array.from(e.dataTransfer!.items).map((i) => i.type));
    };
    const over = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setTypes(null);
    };
    const drop = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
      depth.current = 0;
      setTypes(null);
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
    };
  }, []);
  return types;
}

function Target({
  title,
  detail,
  disabledReason,
  preferred,
  onFiles,
}: {
  title: string;
  detail: string;
  disabledReason: string | null;
  preferred: boolean;
  onFiles: (files: File[]) => void;
}) {
  const [hover, setHover] = useState(false);
  const off = !!disabledReason;
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = off ? "none" : "copy";
        if (!hover) setHover(true);
      }}
      onDragLeave={() => setHover(false)}
      onDrop={(e) => {
        e.preventDefault();
        setHover(false);
        if (!off && e.dataTransfer.files?.length) onFiles(Array.from(e.dataTransfer.files));
      }}
      className={cx(
        "flex flex-1 flex-col items-center justify-center gap-3 px-10 text-center transition-colors duration-150",
        off ? "text-ink-faint" : hover ? "bg-lime-fill text-black" : preferred ? "text-ink" : "text-ink-dim"
      )}
    >
      <p className="font-serif text-[clamp(30px,4vw,52px)] font-light italic leading-none tracking-tight">{title}</p>
      {preferred && !off && (
        <span className={cx("font-mono text-[11px] uppercase tracking-[0.14em]", hover ? "text-black/70" : "text-lime")}>Best for this</span>
      )}
      <p className={cx("max-w-[300px] text-[14px] leading-snug", hover ? "text-black/75" : off ? "text-ink-faint" : "text-ink-dim")}>
        {off ? disabledReason : detail}
      </p>
    </div>
  );
}

export function DropOverlay({
  types,
  loso,
  preferVideo,
  losoTarget,
  hint,
  onGiveToLoso,
  onPutInVideo,
}: {
  types: string[];
  /** null = Loso can take these files; otherwise why not. */
  loso: string | null;
  preferVideo: boolean;
  /** Relabel the left target (local projects: "Save to folder notes"). */
  losoTarget?: { title: string; detail: string };
  /** A line at the top, e.g. "Looks like a screenshot". */
  hint?: string;
  onGiveToLoso: (files: File[]) => void;
  onPutInVideo: (files: File[]) => void;
}) {
  const media = types.length === 0 || types.some((t) => /^(video|image|audio)\//.test(t) || t === "");
  return (
    <div
      className="fixed inset-0 z-[90] flex bg-ground/[0.93] backdrop-blur-[2px]"
      aria-hidden
    >
      <div className="pointer-events-none absolute inset-x-0 top-6 text-center font-mono text-[11px] uppercase tracking-[0.14em] text-ink-dim">
        {hint ?? "Drop your files on one side"}
      </div>
      <Target
        title={losoTarget?.title ?? "Give it to Loso"}
        detail={losoTarget?.detail ?? "It goes into the chat, and Loso decides what to do with it."}
        disabledReason={loso}
        preferred={!preferVideo}
        onFiles={onGiveToLoso}
      />
      <span className="my-16 w-px bg-line-strong" />
      <Target
        title="Put it in the video"
        detail="Adds it to your video, right on the stage."
        disabledReason={media ? null : "Only videos, pictures and sounds can go in the video."}
        preferred={preferVideo}
        onFiles={onPutInVideo}
      />
    </div>
  );
}
