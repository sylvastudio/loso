"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { ChatControl } from "@/components/agent/chat-panel";
import type { DockState } from "@/components/agent/chat-dock";
import type { EditorBackend } from "@/components/compositor/backend";
import { ScreenshotChoice } from "@/components/compositor/screenshot-choice";
import type { PointResult } from "@/components/compositor/point-at-it";
import { likelyScreenshotDrag, looksLikeScreenshot } from "@/lib/screenshot";

// Where pictures go when they arrive in the editor (paste, drop, "Point at
// it"). A screenshot is "look at this problem", so it goes to Loso's chat
// first with "Fix this: " ready; the video is always one click away and
// nothing becomes a piece of the video by accident. Projects without an
// agent (local, for now) offer the folder's notes/ instead.

const FIX = "Fix this: ";

function stamp() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}.${p(d.getMinutes())}.${p(d.getSeconds())}`;
}

/** Clipboard pictures come in nameless or as "image.png": give them a real name. */
function named(f: File): File {
  if (f.name && f.name !== "image.png") return f;
  const ext = f.type.split("/")[1]?.replace("jpeg", "jpg") || "png";
  return new File([f], `Screenshot ${stamp()}.${ext}`, { type: f.type });
}

export function useLosoInbox({
  backend,
  chat,
  dockState,
  openDock,
  ingestFiles,
  announce,
  setError,
}: {
  backend: EditorBackend;
  chat: RefObject<ChatControl | null>;
  dockState: DockState;
  openDock: () => void;
  ingestFiles: (files: File[]) => void;
  announce: (msg: string) => void;
  setError: (msg: string | null) => void;
}) {
  const [choice, setChoice] = useState<File[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 20000);
    return () => clearTimeout(t);
  }, [notice]);
  const [marking, setMarking] = useState(false);
  const markOpener = useRef<HTMLElement | null>(null);
  const agent = backend.agent;

  const giveToLoso = useCallback(
    (files: File[], prompt?: string, caretAt?: number) => {
      if (dockState !== "open") openDock();
      setTimeout(() => chat.current?.attach(files, prompt ? { prompt, caretAt } : undefined), 30);
      announce(`Gave ${files.length === 1 ? files[0].name || "the picture" : `${files.length} pictures`} to Loso`);
    },
    [dockState, openDock, chat, announce]
  );

  const saveToNotes = useCallback(
    async (files: File[]) => {
      if (!backend.saveNote) return;
      try {
        const where: string[] = [];
        for (const f of files) where.push(await backend.saveNote(f.name || `Screenshot ${stamp()}.png`, f));
        announce(`Saved in your folder: ${where.join(", ")}`);
        setNotice(`Saved in your folder: ${where.join(", ")}`);
        setError(null);
      } catch (e) {
        setError(`Couldn't save to the folder's notes. ${(e as Error).message}`);
      }
    },
    [backend, announce, setError]
  );

  // ⌘V a picture anywhere outside a text field.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (e.defaultPrevented || marking) return;
      const t = e.target as HTMLElement | null;
      if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;
      const files = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith("image/"));
      if (!files.length) return;
      e.preventDefault();
      const pics = files.map(named);
      if (agent) giveToLoso(pics, FIX);
      else setChoice(pics);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [agent, giveToLoso, marking]);

  /** Props for <DropOverlay> while files are dragged over the window. */
  function dropProps(types: string[]) {
    const shot = likelyScreenshotDrag(types);
    const canNote = !agent && !!backend.saveNote;
    return {
      loso: agent ? (chat.current?.attachReason(types) ?? null) : canNote && shot ? null : "Loso's AI arrives in the next update.",
      preferVideo: shot ? false : dockState !== "open" || !agent,
      losoTarget:
        canNote && shot ? { title: "Save to folder notes", detail: "Keeps the picture in your folder, out of the video." } : undefined,
      hint: shot ? "Looks like a screenshot? Drop it on the left" : undefined,
      onGiveToLoso: (files: File[]) => {
        if (agent) giveToLoso(files, files.some(looksLikeScreenshot) ? FIX : undefined);
        else saveToNotes(files);
      },
      onPutInVideo: (files: File[]) => {
        const shots = files.filter(looksLikeScreenshot);
        const rest = files.filter((f) => !looksLikeScreenshot(f));
        if (rest.length) ingestFiles(rest);
        if (shots.length) setChoice(shots); // ask, never add a screenshot silently
      },
    };
  }

  function choiceNode(right: number) {
    if (!choice) {
      if (!notice) return null;
      return (
        <div className="pointer-events-none absolute inset-x-0 bottom-14 z-[60] flex justify-center px-4" style={{ right }}>
          <p className="pointer-events-auto flex items-center gap-3 border border-lime/50 bg-ground/95 py-1.5 pl-4 pr-1.5 text-[13px] text-ink">
            {notice}
            <button type="button" onClick={() => setNotice(null)} className="h-8 px-2 text-ink-dim hover:text-ink" aria-label="Dismiss">
              OK
            </button>
          </p>
        </div>
      );
    }
    const files = choice;
    const done = () => setChoice(null);
    const video = { label: "Put it in the video", run: () => (done(), ingestFiles(files)) };
    const first = agent
      ? { label: "Give it to Loso", run: () => (done(), giveToLoso(files, FIX)) }
      : backend.saveNote
        ? { label: "Save to folder notes", run: () => (done(), void saveToNotes(files)) }
        : null;
    if (!first) return null;
    return (
      <ScreenshotChoice
        files={files}
        first={first}
        second={video}
        right={right}
        detail={
          agent
            ? "Loso can look at it and fix what's wrong. Or it can go in your video as a picture."
            : "Loso's AI arrives in the next update. For now you can keep it in your folder's notes, or put it in your video as a picture."
        }
        onCancel={done}
      />
    );
  }

  // ---- "Point at it" ----
  const startMarking = useCallback((opener: HTMLElement | null) => {
    markOpener.current = opener;
    setMarking(true);
  }, []);
  const stopMarking = useCallback(() => {
    setMarking(false);
    const el = markOpener.current;
    requestAnimationFrame(() => el?.isConnected && el.focus());
  }, []);
  const onMarked = useCallback(
    (r: PointResult) => {
      setMarking(false);
      if (agent) {
        giveToLoso([r.file], r.prompt, r.caretAt);
        if (r.sketch) announce(r.summary);
      } else {
        announce(r.summary);
        setNotice(r.summary.replace(/^Saved in /, "Saved in your folder: "));
        const el = markOpener.current;
        requestAnimationFrame(() => el?.isConnected && el.focus());
      }
    },
    [agent, giveToLoso, announce]
  );

  return { dropProps, choiceNode, marking, startMarking, stopMarking, onMarked, putInVideo: (f: File) => ingestFiles([f]) };
}
