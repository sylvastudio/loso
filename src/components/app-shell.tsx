"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Clapperboard, Settings2 } from "lucide-react";
import { PROVIDERS } from "@/lib/providers";

interface KeyStatus {
  id: string;
  set: boolean;
}

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [keys, setKeys] = useState<KeyStatus[] | null>(null);

  useEffect(() => {
    fetch("/api/keys")
      .then((r) => r.json())
      .then((d) => setKeys(d.keys))
      .catch(() => setKeys(null));
  }, [pathname]);

  const nav = [
    { href: "/", label: "Projects", icon: Clapperboard, active: pathname === "/" || pathname.startsWith("/project") },
    { href: "/settings", label: "Settings", icon: Settings2, active: pathname.startsWith("/settings") },
  ];

  return (
    <div className="flex h-dvh overflow-hidden">
      <aside className="flex w-[216px] shrink-0 flex-col border-r border-line bg-panel">
        {/* Wordmark */}
        <Link href="/" className="flex items-center gap-2.5 border-b border-line px-5 py-[18px]">
          <span className="rec-dot h-2.5 w-2.5 rounded-full bg-amber" />
          <span className="font-display text-[17px] font-bold tracking-tight">
            Reelsmith
          </span>
        </Link>

        {/* Nav */}
        <nav className="flex flex-col gap-0.5 p-3">
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cx(
                "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors",
                item.active
                  ? "bg-raised text-ink font-medium"
                  : "text-ink-dim hover:bg-raised/60 hover:text-ink"
              )}
            >
              <item.icon size={16} strokeWidth={2} className={item.active ? "text-amber" : ""} />
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="flex-1" />

        {/* Provider status footer */}
        <Link
          href="/settings"
          className="group border-t border-line px-5 py-4 transition-colors hover:bg-raised/50"
        >
          <p className="mb-2.5 font-mono text-[10px] uppercase tracking-[0.16em] text-ink-faint">
            Pipeline keys
          </p>
          <div className="flex flex-col gap-1.5">
            {PROVIDERS.filter((p) => !p.optional).map((p) => {
              const ok = keys?.find((k) => k.id === p.id)?.set ?? false;
              return (
                <div key={p.id} className="flex items-center gap-2">
                  <span
                    className={cx(
                      "h-1.5 w-1.5 rounded-full",
                      ok ? "bg-ok" : "bg-line-strong"
                    )}
                  />
                  <span className={cx("text-[12px]", ok ? "text-ink-dim" : "text-ink-faint")}>
                    {p.label}
                  </span>
                </div>
              );
            })}
          </div>
        </Link>
      </aside>

      <main className="min-w-0 flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}
