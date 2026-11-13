"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { ChevronRight, X } from "lucide-react";
import { cx } from "@/components/ui";
import { fetchJson } from "@/lib/fetch-json";
import { AI_CONFIG_CHANGED } from "@/components/agent/use-connect";
import type { ConfigPayload } from "@/components/agent/connect-card";
import { AiKeyForm, LocalKeyForm } from "@/components/settings/ai-key-form";
import { AiPanel } from "@/components/settings/ai-panel";
import { AppearancePicker } from "@/components/theme-toggle";
import { FeedbackForm } from "@/components/settings/feedback-form";

// Settings without leaving the page: a right-side sheet over whatever you're
// doing (editor or home). Opens from the gear in the editor bar, the home
// header, the model chip ("Change key or provider") and ⌘/Ctrl + , .
// It is a real modal: focus moves in, Tab stays in, Esc closes, focus goes
// back to whatever opened it, and the page behind is inert.
// /settings renders the same <SettingsContent> as a full page.

export type SettingsMode = "server" | "local" | "auto";
export type SettingsTab = "ai" | "look" | "feedback";

interface OpenOpts {
  opener?: HTMLElement | null;
  tab?: SettingsTab;
}

interface SheetApi {
  open(opts?: OpenOpts): void;
  /** The page says where its projects live (editor: local or server). */
  setMode(mode: SettingsMode): void;
}

const Ctx = createContext<SheetApi | null>(null);

export function useSettingsSheet(): SheetApi {
  return (
    useContext(Ctx) ?? {
      // Outside the provider (shouldn't happen): fall back to the page.
      open: () => {
        window.location.href = "/settings";
      },
      setMode: () => {},
    }
  );
}

/** Tell the sheet which kind of project this page edits, while mounted. */
export function useSettingsMode(mode: SettingsMode) {
  const { setMode } = useSettingsSheet();
  useEffect(() => {
    setMode(mode);
    return () => setMode("auto");
  }, [mode, setMode]);
}

export function SettingsSheetProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ tab: SettingsTab } | null>(null);
  const [mode, setModeRaw] = useState<SettingsMode>("auto");
  const opener = useRef<HTMLElement | null>(null);

  const open = useCallback((opts?: OpenOpts) => {
    opener.current = opts?.opener ?? (document.activeElement as HTMLElement | null);
    setState({ tab: opts?.tab ?? "ai" });
  }, []);
  const setMode = useCallback((m: SettingsMode) => setModeRaw(m), []);
  const close = useCallback(() => {
    setState(null);
    const el = opener.current;
    opener.current = null;
    // After React removes the sheet and the page is no longer inert.
    requestAnimationFrame(() => {
      if (el && el.isConnected) el.focus();
    });
  }, []);

  // ⌘/Ctrl + , opens settings anywhere (the usual app shortcut).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key === ",") {
        e.preventDefault();
        if (!state) open();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, state]);

  const api = useMemo(() => ({ open, setMode }), [open, setMode]);

  return (
    <Ctx.Provider value={api}>
      <div inert={state ? true : undefined} className="contents">
        {children}
      </div>
      {state && <SettingsSheet mode={mode} initialTab={state.tab} onClose={close} />}
    </Ctx.Provider>
  );
}

function SettingsSheet({ mode, initialTab, onClose }: { mode: SettingsMode; initialTab: SettingsTab; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();

  // Focus in on open; slide in unless reduced motion.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!reduce) {
      el.animate([{ transform: "translateX(24px)", opacity: 0 }, { transform: "none", opacity: 1 }], {
        duration: 180,
        easing: "cubic-bezier(0.2, 0.8, 0.2, 1)",
      });
    }
    const first = el.querySelector<HTMLElement>("[data-autofocus]:not([disabled])") ?? el.querySelector<HTMLElement>("h2");
    first?.focus();
  }, []);

  function onKeyDown(e: ReactKeyboardEvent) {
    if (e.key === "Escape") {
      // Let an open select / popover inside handle its own Escape first.
      if ((e.target as HTMLElement).tagName === "SELECT") return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== "Tab" || !ref.current) return;
    const f = Array.from(
      ref.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
    ).filter((x) => x.offsetParent !== null || x === document.activeElement);
    if (!f.length) return;
    const firstEl = f[0];
    const lastEl = f[f.length - 1];
    if (e.shiftKey && (document.activeElement === firstEl || !ref.current.contains(document.activeElement))) {
      e.preventDefault();
      lastEl.focus();
    } else if (!e.shiftKey && document.activeElement === lastEl) {
      e.preventDefault();
      firstEl.focus();
    }
  }

  return (
    <div className="fixed inset-0 z-[150] flex justify-end" onKeyDown={onKeyDown}>
      <div className="absolute inset-0 bg-scrim" aria-hidden onPointerDown={onClose} />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative flex h-full w-full max-w-[520px] flex-col border-l border-line-strong bg-ground shadow-[-30px_0_80px_-20px_var(--color-shade)]"
      >
        <SettingsContent mode={mode} initialTab={initialTab} titleId={titleId} onClose={onClose} />
      </div>
    </div>
  );
}

const TABS: Array<{ id: SettingsTab; label: string }> = [
  { id: "ai", label: "AI" },
  { id: "look", label: "Appearance" },
  { id: "feedback", label: "Tell us" },
];

/**
 * The settings themselves. In the sheet: a close button and a scrolling body.
 * On /settings: a full page (`page`), tab kept in the URL by the caller.
 */
export function SettingsContent({
  mode,
  initialTab = "ai",
  titleId,
  onClose,
  page = false,
  onTabChange,
  onDirtyChange,
}: {
  mode: SettingsMode;
  initialTab?: SettingsTab;
  titleId?: string;
  onClose?: () => void;
  page?: boolean;
  onTabChange?: (t: SettingsTab) => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [tab, setTabRaw] = useState<SettingsTab>(initialTab);
  useEffect(() => setTabRaw(initialTab), [initialTab]);
  const setTab = (t: SettingsTab) => {
    setTabRaw(t);
    onTabChange?.(t);
  };
  const [payload, setPayload] = useState<ConfigPayload | null>(null);
  // The public static site has no server API: only the browser-only settings.
  const [apiDown, setApiDown] = useState(mode === "local" || !!process.env.NEXT_PUBLIC_LOSO_STATIC);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [advanced, setAdvanced] = useState(false);
  const fallbackId = useId();
  const hId = titleId ?? fallbackId;
  // Stable callbacks: the panels re-run their "dirty" effect on identity change.
  const dirtyRef = useRef(onDirtyChange);
  dirtyRef.current = onDirtyChange;
  const aiDirty = useCallback((d: boolean) => dirtyRef.current?.(d), []);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      // A busy studio shouldn't leave "Loading…" up forever.
      setPayload(await fetchJson<ConfigPayload>("/api/ai/config", { signal: AbortSignal.timeout(20000) }));
    } catch (e) {
      const status = (e as { status?: number }).status;
      // No server API here (the static site, or the API switched off): browser-only settings.
      if (mode === "auto" && (status === 404 || status === 503)) setApiDown(true);
      else setLoadError(status ? (e as Error).message : "The studio didn't answer in time.");
    }
  }, [mode]);

  useEffect(() => {
    if (mode === "local" || process.env.NEXT_PUBLIC_LOSO_STATIC) return;
    load();
    const reload = () => load();
    window.addEventListener(AI_CONFIG_CHANGED, reload);
    return () => window.removeEventListener(AI_CONFIG_CHANGED, reload);
  }, [mode, load]);

  const local = mode === "local" || apiDown;
  const tabs = TABS;
  const shown = tab;

  function onTabKey(e: ReactKeyboardEvent, i: number) {
    const dir = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    const next = tabs[(i + dir + tabs.length) % tabs.length];
    setTab(next.id);
    requestAnimationFrame(() => document.getElementById(`${hId}-tab-${next.id}`)?.focus());
  }

  return (
    <>
      <header className={cx("shrink-0 border-b border-line", page ? "pb-0 pt-14" : "px-6 pt-5")}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2
              id={hId}
              tabIndex={-1}
              className={cx(
                "font-serif font-light italic leading-none tracking-[-0.02em] text-ink outline-none",
                page ? "text-[clamp(34px,5vw,52px)]" : "text-[34px]"
              )}
            >
              Settings
            </h2>
            <p className="mt-2 text-[13px] text-ink-dim">
              {local ? "For videos in your folder." : "For every video in Loso."}
              {!page && <span className="text-ink-faint"> ⌘ , opens this anytime.</span>}
            </p>
          </div>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close settings"
              title="Close (Esc)"
              className="-mr-2 flex h-10 w-10 shrink-0 items-center justify-center text-ink-dim transition-colors hover:text-ink"
            >
              <X size={18} />
            </button>
          )}
        </div>
        {tabs.length > 1 && (
          <div role="tablist" aria-label="Settings" className="mt-5 flex gap-7">
            {tabs.map((t, i) => (
              <button
                key={t.id}
                id={`${hId}-tab-${t.id}`}
                role="tab"
                type="button"
                aria-selected={shown === t.id}
                aria-controls={`${hId}-panel-${t.id}`}
                tabIndex={shown === t.id ? 0 : -1}
                onClick={() => setTab(t.id)}
                onKeyDown={(e) => onTabKey(e, i)}
                className={cx("relative min-h-10 pb-2 text-[14px] transition-colors", shown === t.id ? "text-ink" : "text-ink-dim hover:text-ink")}
              >
                {t.label}
                {shown === t.id && <span className="absolute inset-x-0 -bottom-px h-px bg-lime" />}
              </button>
            ))}
          </div>
        )}
        {tabs.length === 1 && <div className="h-5" />}
      </header>

      <div className={cx("min-h-0 flex-1 overflow-y-auto", page ? "pt-8" : "px-6 py-6")}>
        <div id={`${hId}-panel-ai`} role="tabpanel" aria-labelledby={`${hId}-tab-ai`} hidden={shown !== "ai"}>
          {local ? (
            <LocalKeyForm />
          ) : loadError ? (
            <p role="alert" className="border-l-2 border-danger pl-3 text-[13.5px] text-danger">
              Couldn&rsquo;t load your AI settings. {loadError}{" "}
              <button type="button" onClick={load} className="min-h-8 text-lime hover:underline">
                Try again
              </button>
            </p>
          ) : !payload ? (
            <p role="status" className="text-[13.5px] text-ink-dim">
              Loading…
            </p>
          ) : (
            <div className="flex flex-col gap-8">
              <AiKeyForm payload={payload} onSaved={load} />
              <section className="flex flex-col gap-2 border-t border-line pt-4">
                <button
                  type="button"
                  aria-expanded={advanced}
                  onClick={() => setAdvanced((a) => !a)}
                  className="flex min-h-10 items-center gap-1.5 self-start text-[14px] text-ink-dim transition-colors hover:text-ink"
                >
                  <ChevronRight size={14} className={cx("motion-safe:transition-transform", advanced && "rotate-90")} aria-hidden />
                  All AI options (sound to words, server address)
                </button>
                {advanced && <AiPanel onDirtyChange={aiDirty} />}
              </section>
            </div>
          )}
        </div>
        <div id={`${hId}-panel-look`} role="tabpanel" aria-labelledby={`${hId}-tab-look`} hidden={shown !== "look"}>
          <AppearancePicker />
        </div>
        <div id={`${hId}-panel-feedback`} role="tabpanel" aria-labelledby={`${hId}-tab-feedback`} hidden={shown !== "feedback"}>
          {shown === "feedback" && <FeedbackForm />}
        </div>
      </div>
    </>
  );
}
