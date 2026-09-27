"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { KeysPanel } from "@/components/settings/keys-panel";
import { BrandPanel } from "@/components/settings/brand-panel";
import { AiPanel } from "@/components/settings/ai-panel";
import { cx } from "@/components/ui";

const TABS = [
  { id: "ai", label: "AI model" },
  { id: "keys", label: "Pipeline keys" },
  { id: "brand", label: "Brand" },
] as const;

type TabId = (typeof TABS)[number]["id"];

// useSearchParams needs a Suspense boundary under the App Router.
export default function SettingsPage() {
  return (
    <Suspense>
      <SettingsInner />
    </Suspense>
  );
}

function SettingsInner() {
  const router = useRouter();
  const params = useSearchParams();
  const raw = params.get("tab");
  const tab: TabId = TABS.some((t) => t.id === raw) ? (raw as TabId) : "ai";
  const setTab = (t: TabId) => router.replace(t === "ai" ? "/settings" : `/settings?tab=${t}`, { scroll: false });

  // Warn before leaving with unsaved brand edits, pasted-but-unsaved keys, or AI model edits.
  const [dirty, setDirty] = useState({ keys: false, brand: false, ai: false });
  const onKeysDirty = useCallback((v: boolean) => setDirty((d) => ({ ...d, keys: v })), []);
  const onBrandDirty = useCallback((v: boolean) => setDirty((d) => ({ ...d, brand: v })), []);
  const onAiDirty = useCallback((v: boolean) => setDirty((d) => ({ ...d, ai: v })), []);
  const anyDirty = dirty.keys || dirty.brand || dirty.ai;
  useEffect(() => {
    if (!anyDirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [anyDirty]);

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
        <div className="rise mt-7 flex gap-7" role="tablist" style={{ animationDelay: "120ms" }}>
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={cx(
                "relative pb-2 text-[13.5px] transition-colors",
                tab === t.id ? "text-ink" : "text-ink-faint hover:text-ink-dim"
              )}
            >
              {t.label}
              {dirty[t.id] && tab !== t.id && (
                <span className="ml-1.5 inline-block h-1.5 w-1.5 -translate-y-0.5 rounded-full bg-lime" title="Unsaved changes" />
              )}
              {tab === t.id && <span className="absolute inset-x-0 -bottom-px h-px bg-lime" />}
            </button>
          ))}
        </div>
      </header>

      {/* All panels stay mounted so switching tabs never drops unsaved edits. */}
      <div className="pt-2">
        <div hidden={tab !== "keys"}>
          <KeysPanel onDirtyChange={onKeysDirty} />
        </div>
        <div hidden={tab !== "brand"}>
          <BrandPanel onDirtyChange={onBrandDirty} />
        </div>
        <div hidden={tab !== "ai"}>
          <AiPanel onDirtyChange={onAiDirty} />
        </div>
      </div>
    </div>
  );
}
