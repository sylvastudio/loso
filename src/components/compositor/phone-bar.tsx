"use client";

import { useEffect, useId, useRef, useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { cx } from "@/components/ui";
import { Orb, type DockStatus } from "@/components/agent/chat-dock";

// The phone editor's own bits: the "More" menu that holds the top bar's
// actions, and the tabs under the video (Loso / Pieces / Story).

export type PhoneTab = "loso" | "pieces" | "story";

export interface MenuItem {
  key: string;
  icon: typeof MoreHorizontal;
  label: string;
  /** Small words on the right: a count, the current theme. */
  detail?: string;
  /** Why it can't be used right now (shown instead of running it). */
  disabledReason?: string | null;
  onSelect?: () => void;
  /** A download link instead of a button. */
  href?: string;
  download?: string;
  /** A thin rule above this item. */
  separated?: boolean;
}

export function PhoneMenu({ items }: { items: MenuItem[] }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
        btnRef.current?.focus();
      }
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!menuRef.current?.contains(t) && !btnRef.current?.contains(t)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown, true);
    requestAnimationFrame(() => menuRef.current?.querySelector<HTMLElement>("[role=menuitem]:not([aria-disabled])")?.focus());
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown, true);
    };
  }, [open]);

  function onMenuKey(e: React.KeyboardEvent) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const all = Array.from(menuRef.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? []);
    const i = all.indexOf(document.activeElement as HTMLElement);
    const next = all[(i + (e.key === "ArrowDown" ? 1 : all.length - 1)) % all.length];
    next?.focus();
  }

  const rowClass =
    "flex min-h-12 w-full items-center gap-3.5 px-4 text-left text-[15px] text-ink transition-colors active:bg-panel hover:text-lime";

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        aria-label="More"
        data-tour="more"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen((v) => !v)}
        className={cx(
          "flex h-11 w-11 shrink-0 items-center justify-center transition-colors",
          open ? "text-lime" : "text-ink-dim hover:text-ink"
        )}
      >
        <MoreHorizontal size={20} aria-hidden />
      </button>
      {open && (
        <div
          ref={menuRef}
          id={id}
          role="menu"
          aria-label="More"
          onKeyDown={onMenuKey}
          className="rise absolute right-2 top-[54px] z-[80] flex max-h-[calc(100%-64px)] w-[min(300px,calc(100vw-16px))] flex-col overflow-y-auto border border-line-strong bg-ground py-1.5 shadow-[0_30px_80px_-20px_var(--color-shade)]"
          style={{ borderRadius: 2 }}
        >
          {items.map((it) => {
            const Icon = it.icon;
            const body = (
              <>
                <Icon size={17} aria-hidden className={cx("shrink-0", it.disabledReason ? "text-ink-faint" : "text-ink-dim")} />
                <span className={cx("min-w-0 flex-1", it.disabledReason && "text-ink-faint")}>
                  {it.label}
                  {it.disabledReason && <span className="block text-[12.5px] leading-snug text-ink-faint">{it.disabledReason}</span>}
                </span>
                {it.detail && <span className="shrink-0 font-mono text-[12px] text-ink-dim">{it.detail}</span>}
              </>
            );
            return (
              <div key={it.key} role="none" className={cx(it.separated && "mt-1.5 border-t border-line pt-1.5")}>
                {it.href ? (
                  <a role="menuitem" href={it.href} download={it.download} onClick={() => setOpen(false)} className={rowClass}>
                    {body}
                  </a>
                ) : (
                  <button
                    type="button"
                    role="menuitem"
                    aria-disabled={it.disabledReason ? true : undefined}
                    onClick={() => {
                      if (it.disabledReason) return;
                      setOpen(false);
                      it.onSelect?.();
                    }}
                    className={cx(rowClass, it.disabledReason && "py-2 hover:text-ink")}
                  >
                    {body}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

export function PhoneTabs({
  tab,
  setTab,
  status,
  agent,
  pieces,
  seconds,
}: {
  tab: PhoneTab;
  setTab: (t: PhoneTab) => void;
  status: DockStatus;
  agent: boolean;
  pieces: number;
  seconds: string;
}) {
  const tabs: { id: PhoneTab; label: string; detail: React.ReactNode }[] = [
    ...(agent
      ? [
          {
            id: "loso" as const,
            label: "Loso",
            detail: <Orb status={status} size={15} />,
          },
        ]
      : []),
    { id: "pieces", label: "Pieces", detail: <span className="font-mono text-[11px]">{pieces}</span> },
    { id: "story", label: "Story", detail: <span className="font-mono text-[11px]">{seconds}s</span> },
  ];
  const attention = (status.question || status.unread) && tab !== "loso";

  function onKey(e: React.KeyboardEvent) {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const i = tabs.findIndex((t) => t.id === tab);
    const next = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
    setTab(next.id);
    requestAnimationFrame(() => document.getElementById(`phone-tab-${next.id}`)?.focus());
  }

  return (
    <div
      role="tablist"
      aria-label="Edit with"
      onKeyDown={onKey}
      className="flex min-w-0 border-y border-line bg-ground [grid-area:tabs]"
    >
      {tabs.map((t) => {
        const on = tab === t.id;
        return (
          <button
            key={t.id}
            id={`phone-tab-${t.id}`}
            data-tour={`tab-${t.id}`}
            type="button"
            role="tab"
            aria-selected={on}
            tabIndex={on ? 0 : -1}
            onClick={() => setTab(t.id)}
            className={cx(
              "relative flex min-h-12 min-w-0 flex-1 items-center justify-center gap-2 transition-colors",
              on ? "text-ink" : "text-ink-dim hover:text-ink"
            )}
          >
            <span className="font-mono text-[11.5px] uppercase tracking-[0.14em]">{t.label}</span>
            <span className={cx("flex items-center", on ? "text-ink-dim" : "text-ink-faint")} aria-hidden>
              {t.detail}
            </span>
            {t.id === "loso" && attention && (
              <span className="h-2 w-2 rounded-full bg-lime" aria-label={status.question ? "Loso has a question" : "Loso replied"} />
            )}
            <span
              aria-hidden
              className={cx("absolute inset-x-3 bottom-0 h-[2px] transition-colors", on ? "bg-lime-fill" : "bg-transparent")}
            />
          </button>
        );
      })}
    </div>
  );
}
