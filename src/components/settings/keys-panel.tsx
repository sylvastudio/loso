"use client";

import { useEffect, useState } from "react";
import { ExternalLink, KeyRound } from "lucide-react";
import { PROVIDERS } from "@/lib/providers";
import { Button, Input, StatusChip } from "@/components/ui";

interface KeyState {
  set: boolean;
  masked: string | null;
}

export function KeysPanel() {
  const [status, setStatus] = useState<Record<string, KeyState>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/keys")
      .then((r) => r.json())
      .then((d) => {
        const map: Record<string, KeyState> = {};
        for (const k of d.keys) map[k.id] = { set: k.set, masked: k.masked };
        setStatus(map);
      });
  }, []);

  async function save(id: string, value: string) {
    setBusy(id);
    const res = await fetch("/api/keys", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, value }),
    });
    const d = await res.json();
    setStatus((s) => ({ ...s, [id]: { set: d.set, masked: d.masked } }));
    setDrafts((s) => ({ ...s, [id]: "" }));
    setBusy(null);
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="mb-1 max-w-xl text-[13px] leading-relaxed text-ink-dim">
        Keys are stored server-side only — they never reach the browser or a rendered
        video. Each missing key disables its pipeline stage gracefully; everything else
        keeps working.
      </p>

      {PROVIDERS.map((p, i) => {
        const st = status[p.id];
        const ok = st?.set ?? false;
        return (
          <div
            key={p.id}
            className="rise rounded-xl border border-line bg-panel p-5"
            style={{ animationDelay: `${i * 60}ms` }}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-lg border border-line bg-inset">
                  <KeyRound size={15} className={ok ? "text-amber" : "text-ink-faint"} />
                </div>
                <div>
                  <div className="flex items-center gap-2.5">
                    <h3 className="font-display text-[15px] font-semibold tracking-tight">
                      {p.label}
                    </h3>
                    {p.optional && (
                      <span className="font-mono text-[10px] uppercase tracking-wider text-ink-faint">
                        optional
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-[13px] text-ink-dim">{p.role}</p>
                </div>
              </div>
              <StatusChip ok={ok} labels={["Connected", "Not set"]} />
            </div>

            <p className="mt-3 text-[13px] leading-relaxed text-ink-faint">
              {ok ? <>Unlocks: {p.unlocks}.</> : <>{p.degraded}</>}
            </p>

            <div className="mt-3.5 flex items-center gap-2">
              <Input
                type="password"
                autoComplete="off"
                placeholder={ok && st?.masked ? `Saved · ${st.masked} — paste to replace` : p.placeholder}
                value={drafts[p.id] ?? ""}
                onChange={(e) => setDrafts((s) => ({ ...s, [p.id]: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (drafts[p.id] ?? "").trim()) {
                    save(p.id, drafts[p.id]);
                  }
                }}
                className="max-w-md font-mono text-[13px]"
              />
              <Button
                size="sm"
                disabled={!(drafts[p.id] ?? "").trim() || busy === p.id}
                onClick={() => save(p.id, drafts[p.id])}
              >
                {busy === p.id ? "Saving…" : "Save"}
              </Button>
              {ok && (
                <Button size="sm" variant="danger" onClick={() => save(p.id, "")}>
                  Remove
                </Button>
              )}
              <a
                href={p.docsUrl}
                target="_blank"
                rel="noreferrer"
                className="ml-auto inline-flex items-center gap-1 text-[12px] text-ink-faint transition-colors hover:text-amber"
              >
                Get key <ExternalLink size={11} />
              </a>
            </div>
          </div>
        );
      })}
    </div>
  );
}
