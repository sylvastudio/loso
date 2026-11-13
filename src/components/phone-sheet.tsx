"use client";

import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { ChevronDown } from "lucide-react";
import { cx } from "@/components/ui";

// Bottom sheets for the phone editor (portrait): Loso's chat, Pieces, Story.
// A sheet slides up over the stage, stays mounted when it slides away (so a
// running Loso turn survives), and closes on Esc, the scrim, a swipe down on
// its handle, or its close button. On iOS Safari the keyboard doesn't resize
// the page, so the open sheet follows the visual viewport instead.

/** How much of the layout viewport's bottom the keyboard covers (iOS), and the visible height. */
function useKeyboardInset(active: boolean) {
  const [v, setV] = useState({ inset: 0, height: 0 });
  useEffect(() => {
    const vv = window.visualViewport;
    if (!active || !vv) {
      setV({ inset: 0, height: 0 });
      return;
    }
    const on = () => {
      // Pinch-zoomed: the numbers describe the zoom, not a keyboard.
      if (vv.scale > 1.01) return setV({ inset: 0, height: 0 });
      const inset = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
      setV({ inset, height: inset > 0 ? Math.round(vv.height) : 0 });
    };
    on();
    vv.addEventListener("resize", on);
    vv.addEventListener("scroll", on);
    return () => {
      vv.removeEventListener("resize", on);
      vv.removeEventListener("scroll", on);
    };
  }, [active]);
  return v;
}

const FOCUSABLE = 'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

const EASE = "cubic-bezier(.32,.72,0,1)";

/**
 * The behaviour of one sheet panel: Esc, a focus trap, swipe-to-close on the
 * handle, keyboard lift, focus in on open and back out on close.
 */
export function useSheet({
  open,
  onClose,
  panelRef,
  height,
  returnFocus,
}: {
  open: boolean;
  onClose: () => void;
  panelRef: RefObject<HTMLElement | null>;
  /** CSS height while no keyboard is up, e.g. "82dvh". */
  height: string;
  /** Where focus goes when the sheet closes with focus inside it. */
  returnFocus?: () => HTMLElement | null | undefined;
}) {
  const [drag, setDrag] = useState<number | null>(null);
  const start = useRef<{ y: number; t: number } | null>(null);
  const kb = useKeyboardInset(open);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const returnRef = useRef(returnFocus);
  returnRef.current = returnFocus;

  // Focus: in on open (unless the opener already put it somewhere inside),
  // back to the opener on close (only if it was inside: switching sheets
  // or tapping elsewhere shouldn't steal it).
  const wasOpen = useRef(open);
  useEffect(() => {
    const panel = panelRef.current;
    if (open && !wasOpen.current) {
      requestAnimationFrame(() => {
        if (panel && !panel.contains(document.activeElement)) panel.focus({ preventScroll: true });
      });
    } else if (!open && wasOpen.current) {
      const a = document.activeElement;
      if (!a || a === document.body || panel?.contains(a)) returnRef.current?.()?.focus({ preventScroll: true });
    }
    wasOpen.current = open;
  }, [open, panelRef]);

  // Esc closes; Tab stays inside while open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      const panel = panelRef.current;
      if (e.defaultPrevented || !panel) return;
      const t = e.target as Node | null;
      const ours = !t || t === document.body || panel.contains(t);
      if (!ours) return;
      if (e.key === "Escape") {
        e.preventDefault();
        closeRef.current();
      } else if (e.key === "Tab") {
        const els = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
          (el) => el.getClientRects().length > 0 && el.checkVisibility?.({ visibilityProperty: true }) !== false
        );
        if (!els.length) return;
        const first = els[0];
        const last = els[els.length - 1];
        const a = document.activeElement;
        if (!panel.contains(a) || (e.shiftKey && (a === first || a === panel)) || (!e.shiftKey && a === last)) {
          e.preventDefault();
          (e.shiftKey ? last : first).focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, panelRef]);

  const end = (y: number) => {
    const s = start.current;
    start.current = null;
    setDrag(null);
    if (!s) return;
    const dy = y - s.y;
    const speed = dy / Math.max(1, performance.now() - s.t);
    if (dy > 80 || (dy > 24 && speed > 0.5)) closeRef.current();
  };

  const handleProps = {
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      start.current = { y: e.clientY, t: performance.now() };
      e.currentTarget.setPointerCapture(e.pointerId);
      setDrag(0);
    },
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => {
      if (start.current) setDrag(Math.max(0, e.clientY - start.current.y));
    },
    onPointerUp: (e: React.PointerEvent<HTMLElement>) => end(e.clientY),
    onPointerCancel: () => {
      start.current = null;
      setDrag(null);
    },
  };

  const style: CSSProperties = {
    bottom: kb.inset,
    height: kb.height ? `min(${height}, ${kb.height - 8}px)` : height,
    transform: open ? (drag ? `translateY(${drag}px)` : "translateY(0)") : "translateY(calc(100% + 32px))",
    ...(drag !== null ? { transition: "none" } : null),
  };

  return {
    style,
    handleProps,
    panelProps: {
      role: "dialog" as const,
      "aria-modal": open || undefined,
      tabIndex: -1,
      inert: !open || undefined,
      "aria-hidden": !open || undefined,
    },
    className: cx(
      "fixed inset-x-0 z-[60] flex flex-col overflow-hidden rounded-t-[14px] border-x border-t border-line-strong bg-ground shadow-[0_-30px_80px_-30px_var(--color-shade)] outline-none",
      open ? "visible" : "invisible",
      "motion-reduce:[transition:none]!"
    ),
    transition: open ? `transform 380ms ${EASE}, visibility 0s` : `transform 300ms ${EASE}, visibility 0s linear 300ms`,
  };
}

/** The grab handle: a strip you can swipe down. Decorative for AT (the close button is the real control). */
export function SheetHandle(props: ReturnType<typeof useSheet>["handleProps"]) {
  return (
    <div {...props} aria-hidden className="flex h-6 shrink-0 cursor-grab touch-none items-center justify-center active:cursor-grabbing">
      <span className="h-1 w-10 rounded-full bg-line-strong" />
    </div>
  );
}

export function SheetClose({ onClose, label }: { onClose: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClose}
      aria-label={label}
      className="flex h-11 w-11 shrink-0 items-center justify-center text-ink-dim transition-colors hover:text-ink"
    >
      <ChevronDown size={20} aria-hidden />
    </button>
  );
}

/** One scrim for whichever sheet is up. */
export function SheetScrim({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <div
      aria-hidden
      onClick={onClose}
      className={cx(
        "fixed inset-0 z-[55] bg-black/40 transition-opacity duration-300 motion-reduce:transition-none",
        open ? "opacity-100" : "pointer-events-none opacity-0"
      )}
    />
  );
}

export interface PhoneSheetProps {
  id: string;
  open: boolean;
  onClose: () => void;
  title: string;
  /** Small words beside the title: a count, a length. */
  detail?: ReactNode;
  height?: string;
  returnFocus?: () => HTMLElement | null | undefined;
  children: ReactNode;
}

/** A titled sheet (Pieces, Story). Its content stays mounted while it's down. */
export function PhoneSheet({ id, open, onClose, title, detail, height = "66dvh", returnFocus, children }: PhoneSheetProps) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const s = useSheet({ open, onClose, panelRef: ref, height, returnFocus });
  return (
    <div
      ref={ref}
      id={id}
      {...s.panelProps}
      aria-labelledby={titleId}
      className={s.className}
      style={{ transition: s.transition, ...s.style }}
    >
      <SheetHandle {...s.handleProps} />
      <div className="flex min-h-11 shrink-0 items-center gap-3 border-b border-line pl-5 pr-1">
        <h2 id={titleId} className="font-serif text-[21px] italic leading-none text-ink">
          {title}
        </h2>
        {detail && <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-ink-dim">{detail}</span>}
        <span className={cx(!detail && "flex-1")} />
        <SheetClose onClose={onClose} label={`Close ${title}`} />
      </div>
      <div className="flex min-h-0 flex-1 flex-col pb-[env(safe-area-inset-bottom)]">{children}</div>
    </div>
  );
}

/** A sheet on a portrait phone, the bare content everywhere else. */
export function MaybeSheet({ sheet, children }: { sheet: Omit<PhoneSheetProps, "children"> | null; children: ReactNode }) {
  return sheet ? <PhoneSheet {...sheet}>{children}</PhoneSheet> : <>{children}</>;
}
