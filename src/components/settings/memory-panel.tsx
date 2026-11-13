"use client";

import { useEffect, useId, useState } from "react";
import { deviceMemoryGB, fmtBytes, readPageMemory, type PageMemory } from "@/lib/local/memory";

// Settings → Memory: how much of the computer's memory this tab is using,
// as far as the browser lets a page see. Honest about what it can't see:
// video decoding runs in a separate system helper that isn't counted.

const EVERY_MS = 4000;

export function MemoryPanel() {
  const id = useId();
  const [mem, setMem] = useState<PageMemory | null | undefined>(undefined);
  const [ram, setRam] = useState<number | null>(null);
  const [freed, setFreed] = useState<string | null>(null);

  useEffect(() => {
    setRam(deviceMemoryGB());
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      // No work while the tab is hidden.
      if (document.visibilityState === "visible") {
        const m = await readPageMemory();
        if (!alive) return;
        setMem(m);
      }
      timer = setTimeout(tick, EVERY_MS);
    };
    tick();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, []);

  async function freeUp() {
    const { releaseSpeechModel } = await import("@/lib/local/transcribe");
    await releaseSpeechModel();
    setFreed("Done. Loso let go of the speech model; it comes back by itself next time it's needed.");
  }

  const ramBytes = ram !== null ? ram * 1024 ** 3 : null;
  const share = mem && ramBytes ? Math.min(1, mem.bytes / ramBytes) : null;

  return (
    <section aria-labelledby={`${id}-h`} className="mt-10 flex flex-col gap-4 border-t border-line pt-6">
      <div className="flex flex-col gap-1.5">
        <h3 id={`${id}-h`} className="font-serif text-[22px] font-light italic leading-tight text-ink">
          Memory
        </h3>
        <p className="text-[13px] leading-snug text-ink-dim">
          How much of this computer&rsquo;s memory Loso is using, as far as the browser can tell.
        </p>
      </div>

      <dl className="grid grid-cols-[auto_1fr] items-baseline gap-x-6 gap-y-2 text-[13.5px]">
        <dt className="text-ink-dim">Loso in this tab</dt>
        <dd className="tabular-nums text-ink" aria-live="off">
          {mem === undefined ? (
            "Checking…"
          ) : mem === null ? (
            <span className="text-ink-dim">This browser doesn&rsquo;t say. (Chrome and Edge do.)</span>
          ) : (
            <>
              {fmtBytes(mem.bytes)}
              {mem.scope === "js" && <span className="text-ink-dim"> or more</span>}
            </>
          )}
        </dd>
        <dt className="text-ink-dim">This computer has</dt>
        <dd className="tabular-nums text-ink">
          {ram === null ? (
            <span className="text-ink-dim">The browser doesn&rsquo;t say.</span>
          ) : ram >= 8 ? (
            <>8 GB or more</>
          ) : (
            <>about {ram} GB</>
          )}
        </dd>
      </dl>

      {share !== null && (
        <div
          role="meter"
          aria-label="Loso's share of this computer's memory"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(share * 100)}
          aria-valuetext={`${fmtBytes(mem!.bytes)} of ${ram! >= 8 ? "8 GB or more" : `about ${ram} GB`}`}
          className="h-1.5 w-full bg-line"
        >
          <div className="h-full bg-lime-fill" style={{ width: `${Math.max(1, share * 100)}%` }} />
        </div>
      )}

      <p className="border-l-2 border-line-strong pl-3 text-[12.5px] leading-snug text-ink-dim">
        <span className="text-ink">Not counted here:</span> playing and making videos also uses memory in a helper outside this
        page (on a Mac it&rsquo;s called VTDecoderXPCService), and{" "}
        {mem?.scope === "js" ? "this number only counts part of the page, not pictures or video frames. " : ""}
        the browser doesn&rsquo;t let Loso see that. So the real total can be a lot bigger. To see everything, open Activity
        Monitor (Mac) or Task Manager (Windows).
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={freeUp} className="min-h-10 self-start text-[13px] text-ink-dim hover:text-ink">
          Free up memory now
        </button>
        {freed && (
          <p role="status" className="text-[12.5px] text-ink">
            {freed}
          </p>
        )}
      </div>
    </section>
  );
}
