"use client";

import { useState } from "react";
import { KeysPanel } from "@/components/settings/keys-panel";
import { BrandPanel } from "@/components/settings/brand-panel";

const TABS = [
  { id: "keys", label: "API Keys" },
  { id: "brand", label: "Brand" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export default function SettingsPage() {
  const [tab, setTab] = useState<TabId>("keys");

  return (
    <div className="mx-auto max-w-4xl px-8 pb-32 pt-10">
      <header className="mb-8">
        <p className="mb-1 font-mono text-[11px] uppercase tracking-[0.2em] text-amber">
          Studio setup
        </p>
        <h1 className="font-display text-3xl font-bold tracking-tight">Settings</h1>
        <p className="mt-1.5 max-w-lg text-sm text-ink-dim">
          One-time setup: connect your provider keys, then define the brand every video
          will carry.
        </p>
      </header>

      <div className="mb-6 inline-flex rounded-lg border border-line bg-panel p-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`rounded-md px-4 py-1.5 text-sm transition-colors ${
              tab === t.id
                ? "bg-raised font-medium text-ink shadow-[0_1px_0_rgba(255,255,255,0.06)_inset]"
                : "text-ink-dim hover:text-ink"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "keys" ? <KeysPanel /> : <BrandPanel />}
    </div>
  );
}
