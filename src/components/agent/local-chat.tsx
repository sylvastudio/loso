"use client";

import { useImperativeHandle, useRef, useState, type ReactNode, type RefObject } from "react";
import { ChevronRight, KeyRound } from "lucide-react";
import { cx } from "@/components/ui";
import { Composer, useDraft, type ComposerHandle } from "@/components/agent/composer";
import { STARTERS, type ChatControl } from "@/components/agent/chat-panel";

// The chat dock for projects in your folder. The in-browser agent arrives in
// the next update, so this is the dock in its final shape, honestly labelled:
// the key field and Send are visibly not working yet, nothing is stored and
// nothing pretends to send. Starters, the composer and drafts are real.

const SOON = "Loso's AI arrives in the next update. For now you can add files and change things by hand.";

export function LocalChat({
  projectId,
  dockControls,
  controlRef,
}: {
  projectId: string;
  dockControls?: ReactNode;
  controlRef?: RefObject<ChatControl | null>;
}) {
  const composerRef = useRef<ComposerHandle>(null);
  const keyRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useDraft(`loso:draft:${projectId}`);
  const [guide, setGuide] = useState(false);

  useImperativeHandle(controlRef, () => ({
    focus: () => composerRef.current?.focus(),
    fill: (text: string) => composerRef.current?.fill(text),
    attach: () => {},
    stop: () => {},
    attachReason: () => "Loso's AI arrives in the next update.",
  }));

  return (
    <>
      <div className="flex min-h-[52px] shrink-0 items-center gap-2 border-b border-line pl-4 pr-1">
        <h2 className="shrink-0 font-serif text-[19px] italic leading-none text-ink">Loso</h2>
        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={() => keyRef.current?.scrollIntoView({ block: "start" })}
            className="flex h-8 items-center gap-1.5 border border-edge/60 px-2.5 text-[12.5px] text-ink transition-colors hover:border-lime"
            style={{ borderRadius: 2 }}
          >
            <KeyRound size={13} aria-hidden /> Add your key
          </button>
        </div>
        {dockControls}
      </div>

      <div role="log" aria-live="off" aria-label="Conversation with Loso" className="flex min-h-0 flex-1 flex-col gap-7 overflow-y-auto px-4 py-5">
        {/* Key setup, in its final shape — not wired up yet. */}
        <section ref={keyRef} aria-labelledby="key-h" className="flex flex-col gap-3">
          <h3 id="key-h" className="font-serif text-[24px] font-light italic leading-tight text-ink">
            Loso needs a key to think.
          </h3>
          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] text-ink-dim">Paste your Claude key</span>
            <input
              disabled
              aria-describedby="key-soon"
              placeholder="sk-ant-…"
              className="uline cursor-not-allowed font-mono text-[13px] opacity-60"
            />
          </label>
          <p id="key-soon" className="border-l-2 border-lime pl-3 text-[13px] leading-snug text-ink">
            Not ready yet: this arrives in the next update. When it does, your key stays on this computer.
          </p>
          <button
            type="button"
            aria-expanded={guide}
            onClick={() => setGuide((g) => !g)}
            className="flex min-h-10 items-center gap-1.5 self-start text-[13px] text-ink-dim transition-colors hover:text-ink"
          >
            <ChevronRight size={13} className={cx("transition-transform", guide && "rotate-90")} aria-hidden />
            Where do I get one?
          </button>
          {guide && (
            <ol className="ml-1 flex flex-col gap-2 border-l border-line pl-4 text-[13.5px] leading-snug text-ink-dim">
              <li>
                <span className="mr-2 font-mono text-[12px] text-lime">1</span>Go to console.anthropic.com and sign in (a grown-up
                can help).
              </li>
              <li>
                <span className="mr-2 font-mono text-[12px] text-lime">2</span>Open <span className="text-ink">API keys</span> and
                press <span className="text-ink">Create key</span>.
              </li>
              <li>
                <span className="mr-2 font-mono text-[12px] text-lime">3</span>Copy it and paste it here.
              </li>
            </ol>
          )}
        </section>

        <section aria-labelledby="try-h" className="flex flex-col gap-3">
          <h3 id="try-h" className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-dim">
            Things you&rsquo;ll be able to say
          </h3>
          <ul className="flex flex-col border-t border-line">
            {STARTERS.map((s) => (
              <li key={s} className="border-b border-line">
                <button
                  type="button"
                  onClick={() => composerRef.current?.fill(s)}
                  className="group flex min-h-11 w-full items-center gap-3 py-2 text-left font-serif text-[16px] italic text-ink-dim transition-colors hover:text-ink"
                >
                  <span className="flex-1">“{s}”</span>
                  <ChevronRight size={14} className="shrink-0 text-ink-faint transition-colors group-hover:text-lime" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <Composer
        ref={composerRef}
        value={draft}
        onChange={setDraft}
        onSubmit={() => {}}
        busy={false}
        canSend={false}
        sendBlockedReason={SOON}
        onAttach={() => {}}
        attachBlockedReason="Giving pictures to Loso arrives with the AI in the next update."
        placeholder="Tell Loso what you want…"
        label="Message Loso (sending arrives in the next update)"
        showHint={false}
      />
    </>
  );
}
