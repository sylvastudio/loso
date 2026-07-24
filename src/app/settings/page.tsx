"use client";

import { useState } from "react";
import { KeysPanel } from "@/components/settings/keys-panel";
import { BrandPanel } from "@/components/settings/brand-panel";
import { cx } from "@/components/ui";

const TABS = [
  { id: "keys", label: "API Keys" },
  { id: "brand", label: "Brand" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export default function SettingsPage() {
  const [tab, setTab] = useState<TabId>("keys");

  return (
    <div className="mx-auto max-w-4xl px-8 pb-36">
      <header className="border-b border-line pb-8 pt-14">
        <p className="micro rise mb-3">Studio setup</p>
        <h1
          className="rise font-serif text-[clamp(34px,5vw,52px)] font-light italic tracking-[-0.02em]"
          style={{ animationDelay: "60ms" }}
        >
          Settings
        </h1>
        <div className="rise mt-7 flex gap-7" style={{ animationDelay: "120ms" }}>
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cx(
                "relative pb-2 text-[13.5px] transition-colors",
                tab === t.id ? "text-ink" : "text-ink-faint hover:text-ink-dim"
              )}
            >
              {t.label}
              {tab === t.id && <span className="absolute inset-x-0 -bottom-px h-px bg-lime" />}
            </button>
          ))}
        </div>
      </header>

      <div className="pt-2">{tab === "keys" ? <KeysPanel /> : <BrandPanel />}</div>
    </div>
  );
}
