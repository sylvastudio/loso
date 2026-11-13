"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ArrowUp, Loader2, Mic, Paperclip, Square, X } from "lucide-react";
import { cx } from "@/components/ui";
import { canUseVoice, useVoice } from "./use-voice";

// The chat composer: one hairline frame holding attachment chips (above),
// an auto-growing field and the send / stop button (fixed bottom-right).
// Grows with wrapped text up to 8 lines (~200px) or 40% of the dock,
// whichever is smaller, then scrolls with a fade at the top edge.

export interface ComposerAttachment {
  name: string;
  /** "picture", "video", "sound" — said in words on the chip. */
  kind: string;
  /** A small preview (object or data URL). */
  thumb?: string;
  /** One-click alternative, e.g. "Put it in the video instead". */
  action?: { label: string; onClick: () => void };
}

export interface ComposerHandle {
  focus(): void;
  /** Fill the field without sending (starter prompts, "Ask Loso about this"). Caret defaults to the end. */
  fill(text: string, caret?: number): void;
}

const MAX_LINES_PX = 200;

// Drafts survive a reload, not the browser closing (sessionStorage), and a
// draft that looks like a pasted API key is never stored. A draft written
// around attached pictures ("Fix this: … (at 0:05)") isn't stored either:
// the pictures can't come back after a reload, and the words alone would
// point Loso at a picture it never gets.
const LOOKS_LIKE_KEY = /sk-ant-|\bsk-[A-Za-z0-9]{16}|gsk_|AIza/;

export function useDraft(key: string, persist = true) {
  const [draft, setDraft] = useState("");
  const persistRef = useRef(persist);
  persistRef.current = persist;
  useEffect(() => {
    try {
      localStorage.removeItem(key); // drafts from before this moved to sessionStorage
      setDraft(sessionStorage.getItem(key) ?? "");
    } catch {
      /* no storage: start empty */
    }
  }, [key]);
  useEffect(() => {
    if (persist) return;
    try {
      sessionStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  }, [key, persist]);
  const set = useCallback(
    (v: string) => {
      setDraft(v);
      try {
        if (v && persistRef.current && !LOOKS_LIKE_KEY.test(v)) sessionStorage.setItem(key, v);
        else sessionStorage.removeItem(key);
      } catch {
        /* ignore */
      }
    },
    [key]
  );
  return [draft, set] as const;
}

export const Composer = forwardRef<
  ComposerHandle,
  {
    value: string;
    onChange: (v: string) => void;
    onSubmit: () => void;
    busy: boolean;
    onStop?: () => void;
    canSend: boolean;
    /** Why sending isn't possible right now (shown in words, not just a dim button). */
    sendBlockedReason?: string | null;
    attachments?: ComposerAttachment[];
    onRemoveAttachment?: (i: number) => void;
    onAttach?: () => void;
    /** When set, the paperclip explains instead of opening the picker. */
    attachBlockedReason?: string | null;
    onPasteFiles?: (files: File[]) => void;
    placeholder: string;
    label: string;
    showHint: boolean;
    /** A note above the frame (model suggestions, "answer above"). */
    above?: ReactNode;
  }
>(function Composer(
  {
    value,
    onChange,
    onSubmit,
    busy,
    onStop,
    canSend,
    sendBlockedReason,
    attachments = [],
    onRemoveAttachment,
    onAttach,
    attachBlockedReason,
    onPasteFiles,
    placeholder,
    label,
    showHint,
    above,
  },
  ref
) {
  const ta = useRef<HTMLTextAreaElement>(null);
  const [scrolled, setScrolled] = useState(false);
  const [explain, setExplain] = useState<string | null>(null);
  const [hasMic, setHasMic] = useState(false);
  useEffect(() => setHasMic(canUseVoice()), []);
  const voice = useVoice((text) => {
    const before = value.trimEnd();
    pendingCaret.current = null;
    onChange(before ? `${before} ${text}` : text);
    requestAnimationFrame(() => ta.current?.focus({ preventScroll: true }));
  });
  const listening = voice.state === "listening" || voice.state === "starting";

  // Esc stops listening without keeping what was said.
  useEffect(() => {
    if (!listening) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        voice.cancel();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [listening, voice]);

  useImperativeHandle(ref, () => ({
    focus: () => ta.current?.focus(),
    fill: (text: string, caret?: number) => {
      // Placed once the new value has rendered (see the layout effect below).
      pendingCaret.current = caret ?? text.length;
      onChange(text);
      requestAnimationFrame(() => ta.current?.focus());
    },
  }));

  const pendingCaret = useRef<number | null>(null);
  useLayoutEffect(() => {
    const el = ta.current;
    const at = pendingCaret.current;
    if (!el || at === null) return;
    pendingCaret.current = null;
    el.focus();
    el.setSelectionRange(at, at);
  }, [value]);

  // Auto-grow on wrapped text, not just new lines.
  useLayoutEffect(() => {
    const el = ta.current;
    if (!el) return;
    const dock = el.closest("aside");
    const cap = Math.min(MAX_LINES_PX, dock ? dock.clientHeight * 0.4 : MAX_LINES_PX);
    el.style.height = "auto";
    el.style.height = `${Math.min(cap, Math.max(44, el.scrollHeight))}px`;
    el.style.overflowY = el.scrollHeight > cap ? "auto" : "hidden";
  }, [value]);

  const describedBy = [sendBlockedReason ? "composer-blocked" : null, explain ? "composer-explain" : null, voice.error ? "composer-voice" : null]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="flex flex-col gap-2 px-4 pb-4 pt-2">
      {above}
      <div className="flex flex-col border border-edge/70 bg-ground transition-colors focus-within:border-lime/70">
        {attachments.length > 0 && (
          <ul className="flex flex-wrap gap-1.5 border-b border-line px-2.5 pb-2 pt-2.5" aria-label="Attached">
            {attachments.map((a, i) => (
              <li key={`${a.name}-${i}`} className="flex flex-wrap items-center gap-x-1.5 border-l-2 border-lime pl-2 text-[12.5px] text-ink">
                {a.thumb && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={a.thumb} alt="" className="h-8 w-auto max-w-12 border border-line object-cover" />
                )}
                <span className="text-ink-dim">{a.kind}</span>
                <span className="max-w-[160px] truncate">{a.name}</span>
                {a.action && (
                  <button
                    type="button"
                    onClick={a.action.onClick}
                    className="min-h-8 px-1 text-[12.5px] text-lime underline-offset-2 hover:underline"
                  >
                    {a.action.label}
                  </button>
                )}
                {onRemoveAttachment && (
                  <button
                    type="button"
                    aria-label={`Remove ${a.name}`}
                    onClick={() => onRemoveAttachment(i)}
                    className="flex h-6 w-6 items-center justify-center text-ink-dim hover:text-ink"
                  >
                    <X size={12} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        <div className="flex items-end gap-1 pl-1 pr-1.5 py-1.5">
          {onAttach && (
            <button
              type="button"
              aria-label="Add a picture"
              aria-disabled={attachBlockedReason ? true : undefined}
              title={attachBlockedReason ?? "Add a picture"}
              onClick={() => {
                if (attachBlockedReason) setExplain(attachBlockedReason);
                else onAttach();
              }}
              className={cx(
                "flex h-10 w-10 shrink-0 items-center justify-center transition-colors",
                attachBlockedReason ? "text-ink-faint" : "text-ink-dim hover:text-ink"
              )}
            >
              <Paperclip size={16} />
            </button>
          )}
          <textarea
            ref={ta}
            value={value}
            rows={1}
            onChange={(e) => onChange(e.target.value)}
            onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 2)}
            onPaste={(e) => {
              const files = Array.from(e.clipboardData.files ?? []);
              if (files.length && onPasteFiles) {
                e.preventDefault();
                onPasteFiles(files);
              }
            }}
            onKeyDown={(e) => {
              // Enter sends; Shift+Enter is a new line; never mid-IME composition.
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) {
                e.preventDefault();
                if (canSend && !busy) onSubmit();
              }
              if (e.key === "Escape" && busy && onStop) {
                e.preventDefault();
                onStop();
              }
            }}
            aria-label={label}
            aria-describedby={describedBy || undefined}
            placeholder={placeholder}
            className={cx(
              "min-h-[44px] min-w-0 flex-1 resize-none bg-transparent px-2 py-[11px] text-[14.5px] leading-[22px] text-ink outline-none placeholder:text-ink-faint",
              scrolled && "fade-top"
            )}
          />
          {hasMic && (
            <button
              type="button"
              aria-label={listening ? "Stop listening" : voice.state === "writing" ? "Writing down what you said" : "Say it instead of typing"}
              aria-pressed={listening}
              title={listening ? "Stop listening (Esc cancels)" : "Say it instead of typing"}
              disabled={voice.state === "writing" || voice.state === "starting"}
              onClick={() => {
                voice.clearError();
                if (listening) voice.stop();
                else voice.start();
              }}
              className={cx(
                "mb-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors",
                listening ? "mic-live bg-lime-fill text-black" : "text-ink-dim hover:text-ink disabled:opacity-70"
              )}
            >
              {voice.state === "writing" ? <Loader2 size={16} className="animate-spin" /> : <Mic size={16} />}
            </button>
          )}
          {busy && onStop ? (
            <button
              type="button"
              aria-label="Stop Loso"
              title="Stop (Esc)"
              onClick={onStop}
              className="mb-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-edge text-ink transition-colors hover:border-danger hover:text-danger"
            >
              <Square size={11} fill="currentColor" />
            </button>
          ) : (
            <button
              type="button"
              aria-label="Send"
              aria-disabled={!canSend || undefined}
              onClick={() => canSend && onSubmit()}
              className={cx(
                "mb-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors",
                canSend ? "bg-lime-fill text-black hover:bg-lime-deep" : "border border-line-strong text-ink-faint"
              )}
            >
              <ArrowUp size={16} />
            </button>
          )}
        </div>
      </div>
      {(listening || voice.state === "writing") && (
        <p role="status" className="flex items-center gap-2 px-0.5 text-[12.5px] leading-snug text-ink">
          {listening ? (
            <>
              <span aria-hidden className="mic-dot h-2 w-2 rounded-full bg-lime" />
              <span>
                Listening… {Math.floor(voice.seconds / 60)}:{String(voice.seconds % 60).padStart(2, "0")}
              </span>
              <span className="text-ink-dim">Tap the mic when you&rsquo;re done. Esc cancels.</span>
            </>
          ) : (
            <span className="text-ink-dim">{voice.status ?? "Writing down what you said…"}</span>
          )}
        </p>
      )}
      {voice.error && (
        <p id="composer-voice" role="status" className="px-0.5 text-[12.5px] leading-snug text-ink-dim">
          {voice.error}
        </p>
      )}
      {sendBlockedReason && (
        <p id="composer-blocked" className="px-0.5 text-[12.5px] leading-snug text-ink-dim">
          {sendBlockedReason}
        </p>
      )}
      {explain && (
        <p id="composer-explain" role="status" className="px-0.5 text-[12.5px] leading-snug text-ink-dim">
          {explain}
        </p>
      )}
      {showHint && !sendBlockedReason && !listening && voice.state !== "writing" && (
        <p className="px-0.5 text-[12px] text-ink-faint">Enter sends. Shift + Enter makes a new line.</p>
      )}
    </div>
  );
});
