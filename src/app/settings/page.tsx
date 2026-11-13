"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { SettingsContent, type SettingsTab } from "@/components/settings/settings-sheet";

// The full-page version of the settings sheet (same component). Deep links
// like /settings?tab=look work; retired tabs fall back to AI.

const TAB_IDS: SettingsTab[] = ["ai", "look"];

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

  // Warn before leaving with unsaved AI model edits.
  const [anyDirty, setDirty] = useState(false);
  const onDirty = useCallback((v: boolean) => setDirty(v), []);
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
