"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { PROVIDERS } from "@/lib/providers";
import { fetchJson, jsonInit } from "@/lib/fetch-json";
import { Button, ErrorState, InlineError, Input, StatusWord } from "@/components/ui";

interface KeyState {
  set: boolean;
  masked: string | null;
}

export function KeysPanel({ onDirtyChange }: { onDirtyChange?: (dirty: boolean) => void }) {
  const [status, setStatus] = useState<Record<string, KeyState> | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [saveErrors, setSaveErrors] = useState<Record<string, string>>({});

  const load = useCallback(() => {
    setLoadError(null);
    fetchJson<{ keys: Array<{ id: string } & KeyState> }>("/api/keys")
      .then((d) => {
        const map: Record<string, KeyState> = {};
        for (const k of d.keys) map[k.id] = { set: k.set, masked: k.masked };
        setStatus(map);
      })
      .catch((e: Error) => setLoadError(e.message));
  }, []);

  useEffect(load, [load]);

  const dirty = Object.values(drafts).some((v) => v.trim());
  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);

  async function save(id: string, value: string) {
    setBusy(id);
    setSaveErrors((s) => ({ ...s, [id]: "" }));
    try {
      const d = await fetchJson<KeyState>("/api/keys", jsonInit("PUT", { id, value }));
      setStatus((s) => ({ ...s, [id]: { set: d.set, masked: d.masked } }));
      setDrafts((s) => ({ ...s, [id]: "" }));
    } catch (e) {
      setSaveErrors((s) => ({ ...s, [id]: `Couldn't save — ${(e as Error).message}` }));
    } finally {
      setBusy(null);
    }
  }

  if (loadError) {
    return <ErrorState detail={`Key status couldn't load (${loadError}).`} onRetry={load} />;
  }
  if (!status) {
    return <p className="py-16 text-center text-sm text-ink-faint">Loading keys…</p>;
  }

  return (
    <div>
      <p className="max-w-lg pt-6 text-[13px] leading-relaxed text-ink-dim">
        Bring your own keys. They live server-side in the local database — never in the browser,
        never in a rendered video. Missing keys switch their stage off gracefully; the rest of the
        studio keeps working.
      </p>

      <div className="mt-4">
        {PROVIDERS.map((p, i) => {
          const st = status[p.id];
          const ok = st?.set ?? false;
          return (
            <div
              key={p.id}
              className="rise grid grid-cols-1 gap-4 border-b border-line py-7 md:grid-cols-[200px_1fr_auto]"
              style={{ animationDelay: `${i * 50}ms` }}
            >
              <div>
                <div className="flex items-baseline gap-2">
                  <span className="micro text-lime">{String(i + 1).padStart(2, "0")}</span>
                  <h3 className="font-serif text-[18px] tracking-tight">{p.label}</h3>
                  {p.optional && <span className="micro">opt</span>}
                  {!p.live && <span className="micro text-ink-dim">soon</span>}
                </div>
                <p className="mt-1 text-[12px] leading-relaxed text-ink-faint">{p.role}</p>
              </div>

              <div className="max-w-md">
                <div className="flex items-end gap-3">
                  <Input
                    type="password"
                    autoComplete="off"
                    aria-label={`${p.label} API key`}
                    placeholder={
                      ok && st?.masked ? `Saved · ${st.masked} — paste to replace` : p.placeholder
                    }
                    value={drafts[p.id] ?? ""}
                    onChange={(e) => setDrafts((s) => ({ ...s, [p.id]: e.target.value }))}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (drafts[p.id] ?? "").trim()) save(p.id, drafts[p.id]);
                    }}
                    className="font-mono text-[13px]"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!(drafts[p.id] ?? "").trim() || busy === p.id}
                    onClick={() => save(p.id, drafts[p.id])}
                  >
                    {busy === p.id ? "…" : "Save"}
                  </Button>
                  {ok && (
                    <Button size="sm" variant="danger" onClick={() => save(p.id, "")}>
                      Remove
                    </Button>
                  )}
                </div>
                {saveErrors[p.id] ? (
                  <InlineError
                    className="mt-2.5"
                    onDismiss={() => setSaveErrors((s) => ({ ...s, [p.id]: "" }))}
                  >
                    {saveErrors[p.id]}
                  </InlineError>
                ) : (
                  <p className="mt-2.5 text-[12px] leading-relaxed text-ink-faint">
                    {ok ? <>Unlocks: {p.unlocks}.</> : p.degraded}
                  </p>
                )}
              </div>

              <div className="flex flex-col items-end justify-between gap-3">
                <StatusWord ok={ok} labels={p.live ? ["Live", "Off"] : ["Saved", "Off"]} />
                <a
                  href={p.docsUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-0.5 text-[11.5px] text-ink-faint transition-colors hover:text-lime"
                >
                  Get key <ArrowUpRight size={11} />
                </a>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
