"use client";

import Link from "next/link";
import { LosoLogo } from "@/components/logo";
import { usePathname } from "next/navigation";
import { Settings2 } from "lucide-react";
import { SettingsSheetProvider, useSettingsSheet } from "@/components/settings/settings-sheet";
import { ThemeToggle } from "@/components/theme-toggle";

// Editor routes bring their own single 52px bar, so the app header steps
// aside there (no double header). Everywhere else: a thin masthead.
export function isEditorRoute(pathname: string) {
  return pathname.startsWith("/edit") || pathname.startsWith("/project/");
}

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <SettingsSheetProvider>
      <Shell>{children}</Shell>
    </SettingsSheetProvider>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const settings = useSettingsSheet();
  const editor = isEditorRoute(pathname);

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
        <header className="flex h-[58px] shrink-0 items-center justify-between border-b border-line px-6">
          <Link href="/" className="flex items-baseline gap-2" aria-label="Loso, your videos">
            <LosoLogo size={23} />
          </Link>
          <nav aria-label="Main" className="flex items-center gap-6">
            <ThemeToggle showLabel />
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
                className="flex min-h-10 items-center gap-1.5 text-[13.5px] text-ink-dim transition-colors hover:text-ink"
              >
                <Settings2 size={14} aria-hidden /> Settings
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
