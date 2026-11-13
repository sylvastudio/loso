"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { SettingsContent, type SettingsTab } from "@/components/settings/settings-sheet";

// The full-page version of the settings sheet (same component). Deep links
// like /settings?tab=keys still work.

const TAB_IDS: SettingsTab[] = ["ai", "keys", "brand"];

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
  const tab: SettingsTab = TAB_IDS.includes(raw as SettingsTab) ? (raw as SettingsTab) : "ai";
  const setTab = (t: SettingsTab) => router.replace(t === "ai" ? "/settings" : `/settings?tab=${t}`, { scroll: false });

  // Warn before leaving with unsaved brand edits, pasted-but-unsaved keys, or AI model edits.
  const [dirty, setDirty] = useState({ keys: false, brand: false, ai: false });
  const onDirty = useCallback((part: "keys" | "brand" | "ai", v: boolean) => setDirty((d) => (d[part] === v ? d : { ...d, [part]: v })), []);
  const anyDirty = dirty.keys || dirty.brand || dirty.ai;
  useEffect(() => {
    if (!anyDirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [anyDirty]);

  return (
    <div className="mx-auto flex max-w-3xl flex-col px-8 pb-36">
      <SettingsContent mode="auto" page initialTab={tab} onTabChange={setTab} onDirtyChange={onDirty} />
    </div>
  );
}
