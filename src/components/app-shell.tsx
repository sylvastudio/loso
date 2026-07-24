"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { PROVIDERS } from "@/lib/providers";

interface KeyStatus {
  id: string;
  set: boolean;
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
    { href: "/", label: "Projects", active: pathname === "/" || pathname.startsWith("/project") },
    { href: "/settings", label: "Settings", active: pathname.startsWith("/settings") },
  ];

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <header className="flex h-[58px] shrink-0 items-center justify-between border-b border-line px-6">
        <Link href="/" className="flex items-baseline gap-2">
          <span className="font-serif text-[24px] italic leading-none tracking-tight">
            Sylva
          </span>
          <span className="micro translate-y-[-1px] text-ink-dim">studio</span>
        </Link>

        <nav className="flex items-center gap-7">
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`relative text-[13.5px] transition-colors ${
                item.active ? "text-ink" : "text-ink-faint hover:text-ink-dim"
              }`}
            >
              {item.label}
              {item.active && (
                <span className="absolute -bottom-[21px] left-0 right-0 h-px bg-lime" />
              )}
            </Link>
          ))}

          <Link
            href="/settings"
            title="Provider keys"
            className="ml-2 flex items-center gap-1.5 border-l border-line pl-6"
          >
            {PROVIDERS.filter((p) => !p.optional).map((p) => {
              const ok = keys?.find((k) => k.id === p.id)?.set ?? false;
              return <span key={p.id} className={`led ${ok ? "on" : ""}`} title={p.label} />;
            })}
          </Link>
        </nav>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}
