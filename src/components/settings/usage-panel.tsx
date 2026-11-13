"use client";

import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui";
import { friendlyModel } from "@/components/agent/model-chip";
import { BILLING_PAGES, PRICES_CHECKED } from "@/lib/ai/prices";
import { listLocalProjects } from "@/lib/local/projects";
import { browserProvider } from "@/lib/local/providers";
import {
  USAGE_CHANGED,
  allUsage,
  clearUsage,
  getBudget,
  saveBudget,
  startOfMonth,
  startOfToday,
  startOfWeek,
  total,
  type UsageBudget,
  type UsageRecord,
  type UsageTotals,
} from "@/lib/local/usage";
import { costText, fmtTokensFull, fmtUsd, tokensIn } from "@/lib/usage-format";

// Settings → AI → Usage: what Loso's AI calls used, from the log kept in this
// browser (lib/local/usage.ts). Costs are estimates; each provider's billing
// page is the real record.

function UsageTable({ caption, rows, first }: { caption: string; rows: Array<{ label: string; t: UsageTotals }>; first: string }) {
  return (
    <table className="w-full border-collapse text-left text-[13px]">
      <caption className="mb-1.5 text-left font-mono text-[11px] uppercase tracking-[0.12em] text-ink-dim">{caption}</caption>
      <thead>
        <tr className="border-b border-line text-[12px] text-ink-dim">
          <th scope="col" className="py-1.5 pr-3 font-normal">{first}</th>
          <th scope="col" className="py-1.5 pr-3 text-right font-normal">Tokens in</th>
          <th scope="col" className="py-1.5 pr-3 text-right font-normal">Tokens out</th>
          <th scope="col" className="py-1.5 text-right font-normal">Estimated cost</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(({ label, t }) => (
          <tr key={label} className="border-b border-line/60">
            <th scope="row" className="max-w-[12rem] truncate py-1.5 pr-3 font-normal text-ink" title={label}>
              {label}
            </th>
            <td className="py-1.5 pr-3 text-right tabular-nums text-ink-dim">{fmtTokensFull(tokensIn(t))}</td>
            <td className="py-1.5 pr-3 text-right tabular-nums text-ink-dim">{fmtTokensFull(t.output)}</td>
            <td className="py-1.5 text-right tabular-nums text-ink">{t.calls ? costText(t) : "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function groupBy(records: UsageRecord[], key: (r: UsageRecord) => string) {
  const m = new Map<string, UsageRecord[]>();
  for (const r of records) m.set(key(r), [...(m.get(key(r)) ?? []), r]);
  return [...m].map(([label, rs]) => ({ label, t: total(rs) })).sort((a, b) => b.t.cost - a.t.cost || tokensIn(b.t) - tokensIn(a.t));
}

export function UsagePanel() {
  const id = useId();
  const [records, setRecords] = useState<UsageRecord[] | null>(null);
  const [titles, setTitles] = useState<Map<string, string>>(new Map());
  const [budget, setBudget] = useState<UsageBudget>({ monthlyUsd: null, stopAtLimit: false });
  const [limitDraft, setLimitDraft] = useState("");
  const [savedNote, setSavedNote] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  const load = useCallback(async () => {
    const [rs, b, projects] = await Promise.all([allUsage(), getBudget(), listLocalProjects().catch(() => [])]);
    setRecords(rs);
    setBudget(b);
    setLimitDraft(b.monthlyUsd === null ? "" : String(b.monthlyUsd));
    setTitles(new Map(projects.map((p) => [p.id, p.title])));
  }, []);
  useEffect(() => {
    load();
    window.addEventListener(USAGE_CHANGED, load);
    return () => window.removeEventListener(USAGE_CHANGED, load);
  }, [load]);

  const view = useMemo(() => {
    if (!records) return null;
    const since = (t: number) => total(records.filter((r) => r.at >= t));
    return {
      periods: [
        { label: "Today", t: since(startOfToday()) },
        { label: "This week", t: since(startOfWeek()) },
        { label: "This month", t: since(startOfMonth()) },
        { label: "All time", t: total(records) },
      ],
      byModel: groupBy(records, (r) => `${browserProvider(r.provider).name} · ${friendlyModel(r.model)}`),
      byProject: groupBy(records, (r) => titles.get(r.projectId) ?? "A video no longer in your list"),
      providers: [...new Set(records.map((r) => r.provider))],
      month: since(startOfMonth()),
    };
  }, [records, titles]);

  async function saveLimit(next: Partial<UsageBudget>) {
    const raw = limitDraft.trim();
    const n = raw === "" ? null : Number(raw.replace(",", "."));
    if (n !== null && (!Number.isFinite(n) || n < 0)) {
      setSavedNote("Type an amount in dollars, like 5 or 12.50, or leave it empty for no limit.");
      return;
    }
    const b = { ...budget, monthlyUsd: n, ...next };
    await saveBudget(b);
    setBudget(b);
    setSavedNote(b.monthlyUsd === null ? "No monthly limit." : `Limit saved: ${fmtUsd(b.monthlyUsd)} a month.`);
  }

  const billing = (view?.providers.length ? view.providers : ["anthropic"]).map((p) => BILLING_PAGES[p]).filter(Boolean);

  return (
    <section aria-labelledby={`${id}-h`} className="mt-10 flex flex-col gap-5 border-t border-line pt-6">
      <div className="flex flex-col gap-1.5">
        <h3 id={`${id}-h`} className="font-serif text-[22px] font-light italic leading-tight text-ink">
          Usage
        </h3>
        <p className="text-[13px] leading-snug text-ink-dim">
          What Loso&rsquo;s AI used, counted on this computer only. Costs are estimates from published prices (checked{" "}
          {new Date(`${PRICES_CHECKED}T12:00:00`).toLocaleDateString(undefined, { dateStyle: "medium" })}). Your real bill is on{" "}
          {billing.map((b, i) => (
            <span key={b.url}>
              {i > 0 && (i === billing.length - 1 ? " and " : ", ")}
              <a href={b.url} target="_blank" rel="noreferrer" className="text-ink underline-offset-2 hover:underline">
                {b.label}
                <ArrowUpRight size={11} className="ml-0.5 inline" aria-hidden />
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            </span>
          ))}
          .
        </p>
      </div>

      {!view ? (
        <p role="status" className="text-[13px] text-ink-dim">
          Loading…
        </p>
      ) : !records!.length ? (
        <p className="text-[13.5px] text-ink-dim">Nothing yet. Ask Loso for something and it shows up here.</p>
      ) : (
        <>
          <UsageTable caption="When" first="Period" rows={view.periods} />
          <UsageTable caption="By AI" first="Model" rows={view.byModel} />
          <UsageTable caption="By video" first="Video" rows={view.byProject} />
          {view.byModel.some((r) => r.t.unpriced > 0) && (
            <p className="text-[12.5px] text-ink-dim">&ldquo;Price unknown&rdquo; means Loso doesn&rsquo;t have a published price for that model, so only its tokens are counted.</p>
          )}
        </>
      )}

      <div className="flex flex-col gap-2.5">
        <h4 className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-dim">Monthly limit (optional)</h4>
        <p className="text-[13px] leading-snug text-ink-dim">
          Loso tells you calmly when this month&rsquo;s estimate passes it.
          {view && budget.monthlyUsd !== null && <> So far this month: {costText(view.month)}.</>}
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[12.5px] text-ink-dim">Dollars a month</span>
            <input
              inputMode="decimal"
              value={limitDraft}
              onChange={(e) => (setLimitDraft(e.target.value), setSavedNote(null))}
              placeholder="No limit"
              className="uline w-32 text-[13.5px] tabular-nums"
            />
          </label>
          <Button variant="outline" size="sm" onClick={() => saveLimit({})}>
            Save limit
          </Button>
        </div>
        <label className="flex min-h-10 cursor-pointer items-start gap-2.5 text-[13.5px] leading-snug text-ink-dim">
          <input
            type="checkbox"
            checked={budget.stopAtLimit}
            onChange={(e) => saveLimit({ stopAtLimit: e.target.checked })}
            className="mt-0.5 accent-[var(--color-lime)]"
          />
          <span>
            <span className="text-ink">Stop Loso when the estimate reaches the limit.</span> Off unless you turn it on.
          </span>
        </label>
        {savedNote && (
          <p role="status" className="text-[12.5px] text-ink">
            {savedNote}
          </p>
        )}
      </div>

      {!!records?.length &&
        (confirmClear ? (
          <p className="flex flex-wrap items-center gap-3 text-[13px] text-ink" role="group" aria-label="Clear usage history?">
            Clear the whole usage history? Your videos and chats stay.
            <button
              type="button"
              onClick={async () => {
                await clearUsage();
                setConfirmClear(false);
              }}
              className="min-h-10 text-danger hover:underline"
            >
              Clear
            </button>
            <button type="button" autoFocus onClick={() => setConfirmClear(false)} className="min-h-10 text-ink-dim hover:text-ink">
              Keep
            </button>
          </p>
        ) : (
          <button type="button" onClick={() => setConfirmClear(true)} className="min-h-10 self-start text-[13px] text-ink-dim hover:text-ink">
            Clear usage history
          </button>
        ))}
    </section>
  );
}
