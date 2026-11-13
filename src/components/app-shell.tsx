"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { LosoLogo } from "@/components/logo";
import { usePathname } from "next/navigation";
import { MessageSquareHeart, Settings2 } from "lucide-react";
import { SettingsSheetProvider, useSettingsSheet } from "@/components/settings/settings-sheet";
import { ThemeToggle } from "@/components/theme-toggle";
import { installLogCapture } from "@/lib/log";

// Editor routes bring their own single 52px bar, so the app header steps
// aside there (no double header). Everywhere else: a thin masthead.
export function isEditorRoute(pathname: string) {
  return pathname.startsWith("/edit") || pathname.startsWith("/project/");
}

export function AppShell({ children }: { children: React.ReactNode }) {
  useEffect(() => installLogCapture(), []);
  return (
    <SettingsSheetProvider>
      <Shell>{children}</Shell>
    </SettingsSheetProvider>
  );
}

/** Wider than a phone (Tailwind's sm). Starts wide so the server render matches desktop. */
function useWide() {
  const [wide, setWide] = useState(true);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 640px)");
    const on = () => setWide(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return wide;
}

function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const settings = useSettingsSheet();
  const editor = isEditorRoute(pathname);
  const wide = useWide();

  return (
    // overflow-clip, not hidden: a hidden box can still be scrolled by focus()
    // or scrollIntoView, which slid the whole app up.
    <div className="flex h-dvh flex-col overflow-clip">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[200] focus:bg-lime-fill focus:px-3 focus:py-2 focus:text-[13px] focus:text-black"
      >
        Skip to content
      </a>
      {!editor && (
        <header className="flex h-[58px] shrink-0 items-center justify-between gap-3 border-b border-line px-4 pt-[env(safe-area-inset-top)] sm:px-6">
          <Link href="/" className="flex items-baseline gap-2" aria-label="Loso, your videos">
            <LosoLogo size={23} />
          </Link>
          <nav aria-label="Main" className="flex items-center gap-1 sm:gap-6">
            <ThemeToggle showLabel={wide} />
            <button
              type="button"
              aria-haspopup="dialog"
              onClick={(e) => settings.open({ opener: e.currentTarget, tab: "feedback" })}
              aria-label="Feedback"
              className="flex min-h-11 min-w-11 items-center justify-center gap-1.5 text-[13.5px] text-ink-dim transition-colors hover:text-ink sm:min-w-0"
            >
              <MessageSquareHeart size={wide ? 14 : 18} aria-hidden /> <span className="hidden sm:inline">Feedback</span>
            </button>
            {pathname.startsWith("/settings") ? (
              <span aria-current="page" className="flex min-h-10 items-center text-[13.5px] text-ink">
                Settings
              </span>
            ) : (
              <button
                type="button"
                aria-haspopup="dialog"
                onClick={(e) => settings.open({ opener: e.currentTarget })}
                title="Settings (⌘ ,)"
                aria-label="Settings"
                className="flex min-h-11 min-w-11 items-center justify-center gap-1.5 text-[13.5px] text-ink-dim transition-colors hover:text-ink sm:min-w-0"
              >
                <Settings2 size={wide ? 14 : 18} aria-hidden /> <span className="hidden sm:inline">Settings</span>
              </button>
            )}
          </nav>
        </header>
      )}

      {/* The editor scrolls its own panels; the page itself never moves. */}
      <main id="main" className={editor ? "min-h-0 flex-1 overflow-clip" : "min-h-0 flex-1 overflow-y-auto"}>
        {children}
      </main>
    </div>
  );
}
