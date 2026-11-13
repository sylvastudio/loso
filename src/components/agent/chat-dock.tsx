"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronRight, PanelRightClose, PanelRightOpen } from "lucide-react";
import { cx } from "@/components/ui";

// The floating chat dock: Loso's home in the editor. It floats over the
// right edge of the stage (the stage never reflows), and has three states:
//   open   — 400px (360–520, drag the left hairline), the whole chat
//   peek   — a 64px spine: the orb, what Loso is doing, click to open
//   closed — a pill bottom-right: orb + "Talk to Loso" / the current step
// The chat inside stays mounted in every state so a running turn survives.

export type DockState = "open" | "peek" | "closed";

export interface DockStatus {
  busy: boolean;
  /** Plain words: "Adding a title", "Loso has a question". */
  phase: string | null;
  question: boolean;
  /** A reply arrived while the dock was not open. */
  unread: boolean;
}

export const IDLE_STATUS: DockStatus = { busy: false, phase: null, question: false, unread: false };

export const DOCK_MIN = 360;
export const DOCK_MAX = 520;
export const DOCK_DEFAULT = 400;
export const DOCK_INSET = 12;
export const PEEK_W = 64;

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode: per-visit only */
  }
}

/** Dock state + width, remembered per project. Narrow windows start in peek. */
export function useDockState(projectId: string) {
  const key = `loso:dock:${projectId}`;
  const [state, setStateRaw] = useState<DockState>("open");
  const [width, setWidthRaw] = useState(DOCK_DEFAULT);
  useEffect(() => {
    const saved = read<{ state?: DockState; width?: number } | null>(key, null);
    if (saved?.state) setStateRaw(saved.state);
    else if (window.innerWidth < 1100) setStateRaw("peek");
    if (saved?.width) setWidthRaw(Math.min(DOCK_MAX, Math.max(DOCK_MIN, saved.width)));
  }, [key]);
  const setState = useCallback(
    (s: DockState) => {
      setStateRaw(s);
      write(key, { ...read(key, {}), state: s });
    },
    [key]
  );
  const setWidth = useCallback(
    (w: number) => {
      const v = Math.min(DOCK_MAX, Math.max(DOCK_MIN, Math.round(w)));
      setWidthRaw(v);
      write(key, { ...read(key, {}), width: v });
    },
    [key]
  );
  return { state, setState, width, setWidth };
}

/** Space the stage keeps clear for the dock (a soft safe area, not a column). */
export function dockSafeArea(state: DockState, width: number) {
  if (state === "open") return width + DOCK_INSET * 2;
  if (state === "peek") return PEEK_W + DOCK_INSET * 2;
  return 0;
}

/**
 * One polite status region for the whole editor, throttled: at most one
 * announcement every 2.5s, latest wins. Never fed streamed tokens.
 */
export function useAnnouncer() {
  const [message, setMessage] = useState("");
  const last = useRef(0);
  const pending = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const announce = useCallback((msg: string) => {
    pending.current = msg;
    if (timer.current) return;
    const wait = Math.max(0, 2500 - (Date.now() - last.current));
    timer.current = setTimeout(() => {
      timer.current = null;
      if (pending.current) {
        setMessage(pending.current);
        pending.current = null;
        last.current = Date.now();
      }
    }, wait);
  }, []);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  return { message, announce };
}

export function Orb({ status, className }: { status: DockStatus; className?: string }) {
  return (
    <span
      aria-hidden
      className={cx("orb", status.busy ? "working" : status.question || status.unread ? "" : "idle", className)}
    />
  );
}

function pillLabel(status: DockStatus) {
  if (status.question) return "Loso has a question";
  if (status.busy) return status.phase ?? "Loso is working";
  if (status.unread) return "Loso replied";
  return "Talk to Loso";
}

export function ChatDock({
  state,
  setState,
  width,
  setWidth,
  status,
  focusInside,
  children,
}: {
  state: DockState;
  setState: (s: DockState) => void;
  width: number;
  setWidth: (w: number) => void;
  status: DockStatus;
  /** Move focus into the chat (composer, or the recommended answer). */
  focusInside: () => void;
  /** The chat. Gets the header controls (peek / close) to place in its own header. */
  children: (controls: ReactNode) => ReactNode;
}) {
  const pillRef = useRef<HTMLButtonElement>(null);
  const spineRef = useRef<HTMLButtonElement>(null);
  const userToggled = useRef(false);

  function go(next: DockState) {
    userToggled.current = true;
    setState(next);
  }

  // Focus follows the user's toggle: into the chat when it opens, back to
  // the pill / spine when it folds away.
  useEffect(() => {
    if (!userToggled.current) return;
    userToggled.current = false;
    if (state === "open") requestAnimationFrame(focusInside);
    else if (state === "closed") pillRef.current?.focus();
    else spineRef.current?.focus();
  }, [state, focusInside]);

  // ⌘/Ctrl+J opens the dock (or focuses the composer when it's already open).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "j") {
        e.preventDefault();
        if (state === "open") focusInside();
        else go("open");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, focusInside]);

  // Drag the left hairline to resize; double-click resets.
  function beginResize(e: React.PointerEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const startW = width;
    const move = (ev: PointerEvent) => setWidth(startW + (startX - ev.clientX));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  const controls = (
    <div className="flex items-center">
      <button
        type="button"
        onClick={() => go("peek")}
        aria-label="Fold Loso to the side"
        title="Fold to the side"
        className="flex h-10 w-10 items-center justify-center text-ink-dim transition-colors hover:text-ink"
      >
        <PanelRightClose size={16} />
      </button>
      <button
        type="button"
        onClick={() => go("closed")}
        aria-label="Hide Loso"
        title="Hide (⌘J brings it back)"
        className="flex h-10 w-10 items-center justify-center text-ink-dim transition-colors hover:text-ink"
      >
        <ChevronRight size={17} />
      </button>
    </div>
  );

  const attention = (status.question || status.unread) && state !== "open";

  return (
    <>
      <aside
        id="loso-chat"
        aria-label="Loso chat"
        hidden={state === "closed"}
        className={cx(
          "absolute z-30 flex border border-line-strong bg-black shadow-[0_30px_80px_-20px_rgba(0,0,0,0.95),0_0_0_1px_rgba(0,0,0,0.6)]",
          state === "closed" && "hidden"
        )}
        style={{
          top: DOCK_INSET,
          bottom: DOCK_INSET,
          right: DOCK_INSET,
          width: state === "peek" ? PEEK_W : width,
          borderRadius: 2,
        }}
      >
        {state === "open" && (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize Loso chat"
            aria-valuemin={DOCK_MIN}
            aria-valuemax={DOCK_MAX}
            aria-valuenow={width}
            tabIndex={0}
            onPointerDown={beginResize}
            onDoubleClick={() => setWidth(DOCK_DEFAULT)}
            onKeyDown={(e) => {
              if (e.key === "ArrowLeft") setWidth(width + 20);
              if (e.key === "ArrowRight") setWidth(width - 20);
            }}
            className="group absolute -left-[5px] top-0 z-10 flex h-full w-[9px] cursor-col-resize justify-center"
          >
            <span className="h-full w-px bg-transparent transition-colors group-hover:bg-lime/70 group-focus-visible:bg-lime" />
          </div>
        )}

        {state === "peek" && (
          <button
            ref={spineRef}
            type="button"
            onClick={() => go("open")}
            aria-expanded={false}
            aria-controls="loso-chat-body"
            aria-label={`Open Loso chat. ${pillLabel(status)}`}
            className="flex h-full w-full flex-col items-center gap-4 py-4 text-ink-dim transition-colors hover:text-ink"
          >
            <PanelRightOpen size={16} />
            <Orb status={status} />
            <span
              className="min-h-0 flex-1 overflow-hidden text-[13px] leading-none"
              style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}
            >
              <span className={cx(status.question || status.busy ? "text-ink" : "text-ink-dim")}>
                {status.question ? "Loso has a question" : status.busy ? (status.phase ?? "Working") : "Loso"}
              </span>
            </span>
            {attention && <span className="h-2 w-2 rounded-full bg-lime" aria-hidden />}
          </button>
        )}

        {/* The chat: always mounted, shown only when open. */}
        <div id="loso-chat-body" hidden={state !== "open"} className={cx("min-w-0 flex-1 flex-col", state === "open" ? "flex" : "hidden")}>
          {children(controls)}
        </div>
      </aside>

      {state === "closed" && (
        <button
          ref={pillRef}
          type="button"
          onClick={() => go("open")}
          aria-expanded={false}
          aria-controls="loso-chat"
          className="absolute bottom-[52px] right-4 z-30 flex h-11 max-w-[320px] items-center gap-2.5 rounded-full border border-edge bg-black/95 pl-4 pr-5 text-[14px] text-ink shadow-[0_20px_50px_-15px_rgba(0,0,0,0.9)] transition-colors hover:border-lime"
        >
          <Orb status={status} />
          <span className="truncate">{pillLabel(status)}</span>
          {attention && <span className="h-2 w-2 shrink-0 rounded-full bg-lime" aria-hidden />}
        </button>
      )}
    </>
  );
}
