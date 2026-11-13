"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button, cx } from "@/components/ui";
import { LosoMark } from "@/components/logo";

// "Show me around": coach marks that spotlight one real thing at a time. The
// page marks what can be pointed at with data-tour="…"; a step whose thing
// isn't on screen (a folded panel, a phone-only tab) is skipped. Each tour
// runs once on its own, after the page has settled and nothing else (a
// dialog, the settings sheet, the key form being typed in) has the floor.
// Replays come from the "?" buttons and Settings → Tell us (showTour /
// replayTours below).

export interface TourStep {
  /** The data-tour name to spotlight. Several elements with it are drawn as one box. */
  target: string;
  title: string;
  body: string;
  /** Different words while another data-tour thing is on screen (e.g. the key form). */
  alt?: { when: string; title: string; body: string };
}

const EVENT = "loso:tour";
const KEY = "loso:tour:";
const PAD = 6;
const GAP = 14;
const EDGE = 12;

function seen(id: string) {
  try {
    return localStorage.getItem(KEY + id) === "1";
  } catch {
    return false;
  }
}
function markSeen(id: string) {
  try {
    localStorage.setItem(KEY + id, "1");
  } catch {
    /* private window: it may show again next time */
  }
}

/** Run this page's tour now. Returns false when the page has none. */
export function showTour(): boolean {
  const detail = { handled: false };
  window.dispatchEvent(new CustomEvent(EVENT, { detail }));
  return detail.handled;
}

/** Forget every tour was seen, and run this page's one now if it has one. */
export function replayTours(): boolean {
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith(KEY)) localStorage.removeItem(k);
  } catch {
    /* nothing to forget */
  }
  return showTour();
}

/** Call back when someone asks for a tour (the settings sheet closes itself on it). */
export function useTourRequest(on: () => void) {
  const ref = useRef(on);
  ref.current = on;
  useEffect(() => {
    const fn = () => ref.current();
    window.addEventListener(EVENT, fn);
    return () => window.removeEventListener(EVENT, fn);
  }, []);
}

type Box = { top: number; left: number; width: number; height: number };

function shown(name: string, root: HTMLElement | null) {
  return Array.from(document.querySelectorAll<HTMLElement>(`[data-tour="${name}"]`)).filter((el) => {
    if (root?.contains(el)) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && el.checkVisibility?.({ visibilityProperty: true }) !== false;
  });
}

/** The union of the step's elements, clipped to the window (null if none shows). */
function measure(els: HTMLElement[]): Box | null {
  if (!els.length) return null;
  let t = Infinity, l = Infinity, b = -Infinity, r = -Infinity;
  for (const el of els) {
    const x = el.getBoundingClientRect();
    t = Math.min(t, x.top);
    l = Math.min(l, x.left);
    b = Math.max(b, x.bottom);
    r = Math.max(r, x.right);
  }
  t = Math.max(t, 0);
  l = Math.max(l, 0);
  b = Math.min(b, window.innerHeight);
  r = Math.min(r, window.innerWidth);
  if (b - t < 2 || r - l < 2) return null;
  return { top: t, left: l, width: r - l, height: b - t };
}

function busyElsewhere(root: HTMLElement | null) {
  const modal = Array.from(document.querySelectorAll('[aria-modal="true"], [role="menu"]')).some((m) => !root?.contains(m));
  const hold = document.activeElement?.closest?.("[data-tour-hold]");
  return modal || !!hold || document.visibilityState !== "visible";
}

export function Tour({ id, steps }: { id: string; steps: TourStep[] }) {
  const [index, setIndex] = useState<number | null>(null);
  const [box, setBox] = useState<Box | null>(null);
  const [cardSize, setCardSize] = useState({ w: 340, h: 220 });
  const [view, setView] = useState({ w: 0, h: 0 });
  const rootRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const stepsRef = useRef(steps);
  stepsRef.current = steps;
  const titleId = useId();
  const bodyId = useId();

  const present = useCallback((s: TourStep) => shown(s.target, rootRef.current).length > 0, []);

  // Next (or Back) to the closest step that's on screen; past the end, finish.
  const go = useCallback(
    (from: number, dir: 1 | -1) => {
      const list = stepsRef.current;
      for (let i = from; i >= 0 && i < list.length; i += dir) {
        if (present(list[i])) return setIndex(i);
      }
      if (dir === 1) setIndex(null);
    },
    [present]
  );

  // Wait until the page is calm, then start at the first step that shows.
  const startWhenSettled = useCallback(
    (delay: number) => {
      let timer: ReturnType<typeof setTimeout>;
      const tick = () => {
        if (busyElsewhere(rootRef.current) || !stepsRef.current.some(present)) {
          timer = setTimeout(tick, 400);
          return;
        }
        markSeen(id);
        returnFocus.current = document.activeElement as HTMLElement | null;
        go(0, 1);
      };
      timer = setTimeout(tick, delay);
      return () => clearTimeout(timer);
    },
    [id, go, present]
  );

  // First visit: once, on its own.
  useEffect(() => {
    if (seen(id)) return;
    return startWhenSettled(1400);
  }, [id, startWhenSettled]);

  // Replays: the "?" buttons and Settings → Tell us.
  // The request carries a flag so the caller knows this page has a tour.
  const cancelReplay = useRef<(() => void) | null>(null);
  useEffect(() => {
    const on = (e: Event) => {
      (e as CustomEvent<{ handled: boolean }>).detail.handled = true;
      cancelReplay.current?.();
      setIndex(null);
      cancelReplay.current = startWhenSettled(250);
    };
    window.addEventListener(EVENT, on);
    return () => {
      window.removeEventListener(EVENT, on);
      cancelReplay.current?.();
    };
  }, [startWhenSettled]);

  const step = index !== null ? steps[index] : null;
  const active = index !== null;

  // Measure (and keep measuring: panels resize, lists load, the window scrolls).
  const reposition = useCallback(() => {
    if (index === null) return;
    const s = stepsRef.current[index];
    const els = s ? shown(s.target, rootRef.current) : [];
    if (!els.length) return go(index + 1, 1); // it went away: move on
    setBox(measure(els));
    setView({ w: window.innerWidth, h: window.innerHeight });
    const c = cardRef.current;
    if (c) setCardSize((p) => (p.w === c.offsetWidth && p.h === c.offsetHeight ? p : { w: c.offsetWidth, h: c.offsetHeight }));
  }, [index, go]);

  useLayoutEffect(() => {
    if (index === null) return;
    const s = stepsRef.current[index];
    const els = s ? shown(s.target, rootRef.current) : [];
    // Bring it into view inside its own panel. "nearest" only moves the
    // scrolling box that holds it; the app shell is overflow-clip, so the
    // page itself never slides.
    const r = els[0]?.getBoundingClientRect();
    if (r && (r.top < 0 || r.bottom > window.innerHeight || r.left < 0 || r.right > window.innerWidth)) {
      els[0].scrollIntoView({ block: "nearest", inline: "nearest" });
    }
    reposition();
    cardRef.current?.focus({ preventScroll: true });
  }, [index, reposition]);

  useEffect(() => {
    if (!active) return;
    let raf = 0;
    const on = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(reposition);
    };
    window.addEventListener("resize", on);
    window.addEventListener("scroll", on, true);
    const poll = setInterval(on, 500); // late layout shifts (a list loading, the chat folding)
    return () => {
      cancelAnimationFrame(raf);
      clearInterval(poll);
      window.removeEventListener("resize", on);
      window.removeEventListener("scroll", on, true);
    };
  }, [active, reposition]);

  // Back to whatever had focus before the tour.
  useEffect(() => {
    if (active) return;
    const el = returnFocus.current;
    returnFocus.current = null;
    if (el?.isConnected) el.focus({ preventScroll: true });
  }, [active]);

  if (!step || index === null || typeof document === "undefined") return null;

  // The count only counts what's on screen right now.
  const live = steps.filter(present);
  const pos = Math.max(0, live.indexOf(step));
  const last = steps.slice(index + 1).every((s) => !present(s));
  const words = step.alt && shown(step.alt.when, rootRef.current).length ? step.alt : step;

  const end = () => setIndex(null);
  const next = () => (last ? end() : go(index + 1, 1));
  const back = () => go(index - 1, -1);

  function onKeyDown(e: React.KeyboardEvent) {
    const onButton = (e.target as HTMLElement).tagName === "BUTTON";
    if (e.key === "Escape") end();
    else if (e.key === "ArrowRight" || (e.key === "Enter" && !onButton)) next();
    else if (e.key === "ArrowLeft") back();
    else if (e.key === "Tab") {
      // Keep focus in the card while the rest of the page is dimmed.
      const f = Array.from(cardRef.current?.querySelectorAll<HTMLElement>("button") ?? []);
      if (!f.length) return;
      const i = f.indexOf(document.activeElement as HTMLElement);
      const n = e.shiftKey ? (i <= 0 ? f.length - 1 : i - 1) : (i + 1) % f.length;
      f[n].focus();
    } else return;
    e.preventDefault();
    e.stopPropagation();
  }

  // ---- where the card goes ----
  const vw = view.w || window.innerWidth;
  const vh = view.h || window.innerHeight;
  const phone = vw < 640;
  const hole = box && {
    top: box.top - PAD,
    left: box.left - PAD,
    width: box.width + PAD * 2,
    height: box.height + PAD * 2,
  };
  const { w: cw, h: ch } = cardSize;
  let card: React.CSSProperties;
  let arrow: { side: "top" | "bottom" | "left" | "right"; at: number } | null = null;
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

  if (phone) {
    // Phones: a full-width card right under the thing, or right over it;
    // when neither fits, along the bottom with no arrow.
    card = { left: EDGE, right: EDGE, bottom: `max(${EDGE}px, env(safe-area-inset-bottom))` };
    if (hole) {
      const below = hole.top + hole.height + GAP;
      const above = hole.top - GAP - ch;
      const at = clamp(hole.left + hole.width / 2 - EDGE, 18, vw - EDGE * 2 - 18);
      if (below + ch <= vh - EDGE) {
        card = { left: EDGE, right: EDGE, top: below };
        arrow = { side: "top", at };
      } else if (above >= EDGE) {
        card = { left: EDGE, right: EDGE, top: above };
        arrow = { side: "bottom", at };
      }
    }
  } else if (hole) {
    const cx_ = hole.left + hole.width / 2;
    const cy = hole.top + hole.height / 2;
    const options = [
      { side: "bottom" as const, top: hole.top + hole.height + GAP, left: clamp(cx_ - cw / 2, EDGE, vw - cw - EDGE), room: vh - (hole.top + hole.height) - GAP - ch },
      { side: "top" as const, top: hole.top - GAP - ch, left: clamp(cx_ - cw / 2, EDGE, vw - cw - EDGE), room: hole.top - GAP - ch },
      { side: "left" as const, top: clamp(cy - ch / 2, EDGE, vh - ch - EDGE), left: hole.left - GAP - cw, room: hole.left - GAP - cw },
      { side: "right" as const, top: clamp(cy - ch / 2, EDGE, vh - ch - EDGE), left: hole.left + hole.width + GAP, room: vw - (hole.left + hole.width) - GAP - cw },
    ];
    const pick = options.find((o) => o.room >= EDGE) ?? options.reduce((a, b) => (b.room > a.room ? b : a));
    const top = clamp(pick.top, EDGE, vh - ch - EDGE);
    const left = clamp(pick.left, EDGE, vw - cw - EDGE);
    card = { top, left };
    // The arrow sits on the card edge that faces the thing (the card is "bottom" of it → arrow on top).
    const edge = { bottom: "top", top: "bottom", left: "right", right: "left" } as const;
    arrow =
      pick.side === "bottom" || pick.side === "top"
        ? { side: edge[pick.side], at: clamp(cx_ - left, 18, cw - 18) }
        : { side: edge[pick.side], at: clamp(cy - top, 18, ch - 18) };
  } else {
    card = { top: vh / 2 - ch / 2, left: vw / 2 - cw / 2 };
  }

  return createPortal(
    <div ref={rootRef} className="fixed inset-0 z-[140]">
      {/* Clicks wait while the tour is up: the page is for looking at right now. */}
      <div className="absolute inset-0" aria-hidden onPointerDown={(e) => e.preventDefault()} />
      {hole ? (
        <div
          aria-hidden
          className="pointer-events-none absolute outline outline-1 outline-lime motion-safe:transition-[top,left,width,height] motion-safe:duration-300 motion-safe:ease-[cubic-bezier(0.22,1,0.36,1)]"
          style={{ ...hole, borderRadius: 3, boxShadow: "0 0 0 200vmax var(--color-scrim)" }}
        />
      ) : (
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-scrim" />
      )}

      <div
        ref={cardRef}
        key={index}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className={cx(
          "rise absolute flex flex-col border border-line-strong bg-ground text-ink shadow-[0_30px_80px_-20px_var(--color-shade)] outline-none",
          phone ? "" : "w-[340px] motion-safe:transition-[top,left] motion-safe:duration-300"
        )}
        style={{ ...card, borderRadius: 2, animationDuration: "0.35s" }}
      >
        {arrow && (
          <span
            aria-hidden
            className={cx(
              "absolute h-3 w-3 rotate-45 border-line-strong bg-ground",
              arrow.side === "top" && "-top-[7px] border-l border-t",
              arrow.side === "bottom" && "-bottom-[7px] border-b border-r",
              arrow.side === "left" && "-left-[7px] border-b border-l",
              arrow.side === "right" && "-right-[7px] border-r border-t"
            )}
            style={arrow.side === "top" || arrow.side === "bottom" ? { left: arrow.at - 6 } : { top: arrow.at - 6 }}
          />
        )}
        <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
          <LosoMark size={16} />
          <span className="micro">Show me around</span>
          <span className="ml-auto font-mono text-[11px] tabular-nums text-ink-dim" aria-label={`Step ${pos + 1} of ${live.length}`}>
            {pos + 1} of {live.length}
          </span>
        </div>
        <div className="px-4 pb-4 pt-3.5">
          <h2 id={titleId} className="font-serif text-[24px] font-light italic leading-[1.1] tracking-tight text-ink">
            {words.title}
          </h2>
          <p id={bodyId} className="mt-2 text-[14.5px] leading-relaxed text-ink-dim">
            {words.body}
          </p>
        </div>
        <div className="h-px bg-line" aria-hidden>
          <div className="h-px bg-lime motion-safe:transition-[width] motion-safe:duration-300" style={{ width: `${((pos + 1) / Math.max(1, live.length)) * 100}%` }} />
        </div>
        <div className="flex items-center gap-1 px-2 py-2">
          <button
            type="button"
            onClick={end}
            className="flex min-h-11 items-center px-2.5 text-[13px] text-ink-dim underline-offset-4 transition-colors hover:text-ink hover:underline"
          >
            Skip
          </button>
          <span className="flex-1" />
          {pos > 0 && (
            <Button variant="ghost" onClick={back} className="h-11 px-4">
              Back
            </Button>
          )}
          <Button onClick={next} className="h-11 px-5">
            {last ? "Got it" : "Next"}
          </Button>
        </div>
      </div>
    </div>,
    document.body
  );
}
