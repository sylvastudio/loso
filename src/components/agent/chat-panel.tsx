"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { Check, ChevronRight, Loader2, RotateCcw, X } from "lucide-react";
import { Button, InlineError, cx } from "@/components/ui";
import {
  ChatApiContext,
  serverChatApi,
  useChatApi,
  type AgentBody,
  type ChatApi,
  type ChatUsage,
  type UsageSum,
  type LiveEvent,
  type Stored,
  type StoredPart,
  type ToolCall,
} from "@/components/agent/chat-api";
import { LocalConnect } from "@/components/agent/local-connect";
import { LosoMark } from "@/components/logo";
import type { CompositorDoc } from "@/lib/compositor";
import { ConnectCard, explainFailure, type ConfigPayload } from "@/components/agent/connect-card";
import { Composer, useDraft, type ComposerHandle } from "@/components/agent/composer";
import { ModelChip, bestVisionModel, friendlyModel } from "@/components/agent/model-chip";
import type { DockStatus } from "@/components/agent/chat-dock";
import type { RankedModel } from "@/lib/ai/models";
import { AI_CONFIG_CHANGED } from "@/components/agent/use-connect";
import { useSettingsSheet } from "@/components/settings/settings-sheet";
import { USAGE_CHANGED } from "@/lib/local/usage";
import { costText, fmtTokens, fmtUsd, tokensIn, usageLine } from "@/lib/usage-format";

// ---------- stored message shapes (see chat-api.ts) ----------

type ToolResult = { content: string; isError?: boolean; images: string[] };

const CONFIRM_TOOLS = new Set(["footage_cut", "render_video", "delete_template"]);
const INTERACTIVE = new Set(["ask_user", "propose_storyboard"]);

// ---------- plain words for what Loso did / is doing ----------

function countOf(a: unknown, one: string, many: string) {
  const n = Array.isArray(a) ? a.length : 0;
  return n === 1 ? one : `${n || "some"} ${many}`;
}

function firstAdded(a: Record<string, unknown>): string {
  const layers = Array.isArray(a.layers) ? (a.layers as Array<Record<string, unknown>>) : [];
  if (layers.length !== 1) return countOf(layers, "a piece", "things");
  const l = layers[0];
  if (l.type === "text") return l.text ? `the words “${String(l.text).slice(0, 24)}”` : "some words";
  if (l.type === "audio") return "a sound";
  if (l.type === "image") return "a picture";
  return "a video";
}

/** Past tense, for the "Did N things" list. */
function toolLabel(name: string, args: Record<string, unknown>): string {
  const a = args ?? {};
  const s = (k: string) => (a[k] == null ? "" : String(a[k]).split("/").pop());
  switch (name) {
    case "footage_scan": return "Looked at what's in your folder";
    case "footage_contact_sheet": return `Looked through ${s("clip")}`;
    case "footage_frame": return `Checked ${s("clip")} at ${s("timeSec")}s`;
    case "footage_transcribe": return `Listened to ${s("clip")}`;
    case "footage_words": return `Read what's said in ${s("clip")}`;
    case "footage_cut": return "Cut the video";
    case "snapshot": return "Looked at your video";
    case "get_composition": return "Looked at your video";
    case "set_output": return "Set the shape of the video";
    case "add_layers": return `Added ${firstAdded(a)}`;
    case "update_layers": return `Changed ${countOf(a.updates, "one thing", "things")}`;
    case "remove_layers": return a.all ? "Cleared everything" : `Removed ${countOf(a.ids, "one thing", "things")}`;
    case "add_captions": return "Added words on screen";
    case "apply_template": return "Used a starting point";
    case "save_template": return `Saved “${s("name")}” as a starting point`;
    case "list_templates": return "Checked the starting points";
    case "import_file": return `Brought in ${s("path")}`;
    case "render_video": return "Made the video";
    default: return name.replace(/_/g, " ");
  }
}

/** Present tense, for the one live status line. */
function toolDoing(name: string, args: Record<string, unknown>): string {
  const a = args ?? {};
  const s = (k: string) => (a[k] == null ? "" : String(a[k]).split("/").pop());
  switch (name) {
    case "footage_scan": return "Looking at your folder";
    case "footage_contact_sheet": return `Looking through ${s("clip")}`;
    case "footage_frame": return `Checking a moment in ${s("clip")}`;
    case "footage_transcribe": return `Listening to ${s("clip")}`;
    case "footage_words": return "Reading what's said";
    case "footage_cut": return "Cutting the video";
    case "snapshot":
    case "get_composition": return "Looking at your video";
    case "set_output": return "Setting the shape";
    case "add_layers": return `Adding ${firstAdded(a)}`;
    case "update_layers": return `Changing ${countOf(a.updates, "one thing", "things")}`;
    case "remove_layers": return "Tidying up";
    case "add_captions": return "Adding words on screen";
    case "apply_template": return "Using a starting point";
    case "save_template": return "Saving a starting point";
    case "list_templates": return "Checking the starting points";
    case "import_file": return "Bringing in a file";
    case "render_video": return "Making the video";
    case "ask_user": return "Loso has a question";
    case "propose_storyboard": return "Drawing up a plan";
    default: return "Working";
  }
}

function firstSentence(text: string) {
  const t = text.replace(/[*`#]/g, "").trim();
  const m = t.match(/^.{0,160}?[.!?](\s|$)/);
  return (m ? m[0] : t.slice(0, 160)).trim();
}

// Minimal, safe markdown: paragraphs, **bold**, `code`, - lists.
function Prose({ text }: { text: string }) {
  const blocks = text.trim().split(/\n{2,}/);
  const inline = (t: string, k: number) =>
    t.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((p, i) =>
      p.startsWith("**") ? (
        <strong key={`${k}-${i}`} className="font-semibold text-ink">{p.slice(2, -2)}</strong>
      ) : p.startsWith("`") ? (
        <code key={`${k}-${i}`} className="bg-panel px-1 font-mono text-[12.5px]">{p.slice(1, -1)}</code>
      ) : (
        <span key={`${k}-${i}`}>{p}</span>
      )
    );
  return (
    <div className="flex flex-col gap-2.5 text-[14.5px] leading-[1.6] text-ink/90">
      {blocks.map((b, i) => {
        const lines = b.split("\n");
        if (lines.every((l) => /^\s*([-*]|\d+\.)\s+/.test(l))) {
          return (
            <ul key={i} className="flex flex-col gap-1 pl-4">
              {lines.map((l, j) => (
                <li key={j} className="list-disc marker:text-ink-faint">{inline(l.replace(/^\s*([-*]|\d+\.)\s+/, ""), j)}</li>
              ))}
            </ul>
          );
        }
        return <p key={i} className="whitespace-pre-wrap">{inline(b, i)}</p>;
      })}
    </div>
  );
}

// ---------- the question card ("Your call") ----------

// Sent back when the user leaves a question to the agent's judgement.
const DECIDE = "You decide — use your best judgement";

interface AskHandle {
  focus(): void;
  /** Composer text counts as "type your own" for the current question. */
  answerCurrent(text: string): void;
}

type Question = { id: string; question: string; options?: string[] };

const AskCard = forwardRef<
  AskHandle,
  {
    call: ToolCall;
    onSubmit: (answer: Record<string, string>) => void;
    disabled: boolean;
    /** Esc: step out of the card (to the composer) without answering. */
    onLeave: () => void;
  }
>(
  function AskCard({ call, onSubmit, disabled, onLeave }, ref) {
    const qs = (Array.isArray(call.args.questions) ? call.args.questions : []) as Question[];
    const [step, setStep] = useState(0);
    const [answers, setAnswers] = useState<Record<string, string>>({});
    const [choice, setChoice] = useState<string | null>(null);
    const [own, setOwn] = useState("");
    const [hint, setHint] = useState<string | null>(null);
    const fieldsetRef = useRef<HTMLFieldSetElement>(null);
    const q = qs[step];
    const options = q?.options ?? [];

    function commit(value: string | null) {
      if (!q) return;
      const v = value?.trim();
      if (!v) {
        setHint(`Pick an answer for “${q.question}”, type your own, or choose You decide.`);
        fieldsetRef.current?.querySelector<HTMLInputElement>("input[type=radio]")?.focus();
        return;
      }
      const next = { ...answers, [q.id]: v };
      setAnswers(next);
      setChoice(null);
      setOwn("");
      setHint(null);
      if (step + 1 < qs.length) {
        setStep(step + 1);
        requestAnimationFrame(() => fieldsetRef.current?.querySelector<HTMLInputElement>("input[type=radio]")?.focus());
      } else {
        onSubmit(next);
      }
    }
    const current = () => (own.trim() ? own : choice);

    useImperativeHandle(ref, () => ({
      focus: () => fieldsetRef.current?.querySelector<HTMLInputElement>("input[type=radio]")?.focus(),
      answerCurrent: (text: string) => commit(text),
    }));

    if (!q) return null;
    const name = `${call.id}-${q.id}`;
    const all = [...options, DECIDE];
    return (
      <section
        aria-labelledby={`${name}-h`}
        className="border-t border-line-strong px-4 pb-1 pt-3.5"
        onKeyDown={(e) => {
          const t = e.target as HTMLElement;
          if (t.tagName === "INPUT" && (t as HTMLInputElement).type === "text") return;
          if (/^[1-4]$/.test(e.key) && all[Number(e.key) - 1]) {
            e.preventDefault();
            setChoice(all[Number(e.key) - 1]);
            setOwn("");
          } else if (e.key === "Escape") {
            // Leaving isn't answering: "You decide" stays an explicit choice.
            e.preventDefault();
            e.stopPropagation();
            onLeave();
          }
        }}
      >
        <div className="flex items-baseline justify-between">
          <h3 id={`${name}-h`} className="font-mono text-[11px] uppercase tracking-[0.12em] text-lime">
            Your call
          </h3>
          {qs.length > 1 && (
            <span className="font-mono text-[11px] text-ink-dim">
              {step + 1}/{qs.length}
            </span>
          )}
        </div>
        <fieldset ref={fieldsetRef} disabled={disabled} className="mt-1.5">
          <legend className="font-serif text-[19px] italic leading-snug text-ink">{q.question}</legend>
          <div role="radiogroup" aria-label={q.question} className="mt-3 flex flex-wrap gap-2">
            {all.map((o, i) => {
              const best = i === 0 && o !== DECIDE;
              const decide = o === DECIDE;
              const on = choice === o && !own.trim();
              return (
                <label
                  key={o}
                  className={cx(
                    "flex min-h-10 cursor-pointer items-center gap-1.5 rounded-full border px-4 text-[14px] transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-1 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-lime",
                    on
                      ? "border-lime bg-lime-fill text-black"
                      : best
                        ? "border-lime/70 text-ink hover:bg-lime/10"
                        : decide
                          ? "border-dashed border-edge text-ink-dim hover:text-ink"
                          : "border-edge/80 text-ink hover:border-ink-dim"
                  )}
                >
                  <input
                    type="radio"
                    name={name}
                    value={o}
                    className="sr-only"
                    checked={on}
                    onChange={() => {
                      setChoice(o);
                      setOwn("");
                      setHint(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        commit(o);
                      }
                    }}
                  />
                  {decide ? "You decide" : o}
                  {best && <span className={cx("text-[11px] uppercase tracking-[0.1em]", on ? "text-black/70" : "text-lime")}>best</span>}
                </label>
              );
            })}
          </div>
          <div className="mt-3 flex items-end gap-2">
            <input
              aria-label={`Your own answer: ${q.question}`}
              value={own}
              onChange={(e) => {
                setOwn(e.target.value);
                setHint(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  commit(current());
                }
              }}
              className="uline text-[14px]"
              placeholder="Or type your own…"
            />
            <Button size="sm" onClick={() => commit(current())} disabled={disabled} className="shrink-0">
              {step + 1 < qs.length ? "Next" : "Send"}
            </Button>
          </div>
        </fieldset>
        <p className="mt-2 min-h-[18px] text-[12.5px] text-ink" role="status">
          {hint ?? ""}
        </p>
      </section>
    );
  }
);

function AskReceipt({ call, answered }: { call: ToolCall; answered: string }) {
  const qs = (Array.isArray(call.args.questions) ? call.args.questions : []) as Question[];
  const given = useMemo<Record<string, string>>(() => {
    try {
      return JSON.parse(answered);
    } catch {
      return {};
    }
  }, [answered]);
  if (!Object.keys(given).length) return <p className="text-[13px] text-ink-dim">Answered: {answered}</p>;
  return (
    <ul className="flex flex-col gap-1">
      {qs.map((q) =>
        given[q.id] ? (
          <li key={q.id} className="flex items-start gap-2 text-[13px] text-ink-dim">
            <Check size={14} className="mt-[3px] shrink-0 text-lime" aria-hidden />
            <span>
              <span className="font-serif italic text-ink">{q.question}</span>{" "}
              {given[q.id] === DECIDE ? "Loso decides" : given[q.id]}
            </span>
          </li>
        ) : null
      )}
    </ul>
  );
}

// ---------- plan + confirm ----------

function StoryboardCard({
  call, result, onDecide, disabled,
}: {
  call: ToolCall; result?: string; onDecide: (approved: boolean, note: string) => void; disabled: boolean;
}) {
  const a = call.args as {
    folder?: string; summary?: string;
    beats?: Array<{ from: number; to: number; heard?: string; clip: string; clipTime: number; caption?: string }>;
  };
  const [note, setNote] = useState("");
  const [changing, setChanging] = useState(false);
  const api = useChatApi();
  return (
    <section aria-labelledby={`${call.id}-h`} className="border-y border-line py-3.5">
      <h3 id={`${call.id}-h`} className="font-mono text-[11px] uppercase tracking-[0.12em] text-lime">
        Plan for your video{result ? (result.startsWith("User approved") ? " · you said yes" : " · you asked for changes") : ""}
      </h3>
      {a.summary && <p className="mt-2 font-serif text-[17px] italic leading-snug text-ink">{a.summary}</p>}
      <ol className="mt-3 flex flex-col">
        {(a.beats ?? []).map((b, i) => {
          const frame = api?.clipFrameUrl(a.folder, b.clip, b.clipTime) ?? null;
          return (
          <li key={i} className="flex gap-3 border-t border-line py-2.5 first:border-t-0">
            {frame ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={frame}
                alt={`${b.clip} at ${b.clipTime} seconds`}
                className="h-[72px] w-[44px] shrink-0 object-cover"
                loading="lazy"
              />
            ) : (
              <span className="h-[72px] w-[44px] shrink-0 bg-panel" />
            )}
            <div className="min-w-0 flex-1">
              <p className="font-mono text-[11px] text-ink-dim">
                {Number(b.from).toFixed(1)}–{Number(b.to).toFixed(1)}s · {b.clip} at {b.clipTime}s
              </p>
              {b.heard && <p className="mt-0.5 font-serif text-[14px] italic leading-snug text-ink">“{b.heard}”</p>}
              {b.caption && <p className="mt-0.5 text-[12.5px] text-ink-dim">Words on screen: {b.caption}</p>}
            </div>
          </li>
          );
        })}
      </ol>
      {!result && (
        <div className="mt-2 flex flex-col gap-2.5">
          {changing && (
            <input
              autoFocus
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="What should change?"
              aria-label="What should change?"
              className="uline text-[14px]"
            />
          )}
          <div className="flex justify-end gap-2">
            {changing ? (
              <Button size="sm" variant="outline" disabled={!note.trim() || disabled} onClick={() => onDecide(false, note)}>
                Send changes
              </Button>
            ) : (
              <Button size="sm" variant="ghost" disabled={disabled} onClick={() => setChanging(true)}>
                Change something
              </Button>
            )}
            <Button size="sm" disabled={disabled} onClick={() => onDecide(true, note)}>
              <Check size={13} /> Looks good, make it
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

function ConfirmCard({
  call, onDecide, disabled,
}: {
  call: ToolCall; onDecide: (approved: boolean) => void; disabled: boolean;
}) {
  const a = call.args as { shots?: unknown[]; audio?: unknown[]; durationSec?: number };
  const what =
    call.name === "footage_cut"
      ? `Cut ${a.shots?.length ?? 0} shots over ${a.audio?.length ?? 0} sound pieces, ${a.durationSec ?? "?"} seconds long. Takes a minute or two.`
      : call.name === "delete_template"
        ? "Delete this saved starting point for good."
        : "Make the video file now. Takes about a minute.";
  return (
    <section aria-labelledby={`${call.id}-h`} className="border-l-2 border-lime py-1 pl-3.5">
      <h3 id={`${call.id}-h`} className="text-[14px] font-medium text-ink">
        {call.name === "footage_cut" ? "Ready to cut your video" : call.name === "delete_template" ? "Delete a starting point?" : "Ready to make the video"}
      </h3>
      <p className="mt-1 text-[13.5px] leading-relaxed text-ink-dim">{what}</p>
      <div className="mt-2.5 flex gap-2">
        <Button size="sm" disabled={disabled} onClick={() => onDecide(true)}>
          <Check size={13} /> Go ahead
        </Button>
        <Button size="sm" variant="ghost" disabled={disabled} onClick={() => onDecide(false)}>
          Not now
        </Button>
      </div>
    </section>
  );
}

// ---------- "Did N things" ----------

type StepItem = { id: string; name: string; args: Record<string, unknown>; result?: ToolResult; running?: boolean };

function Steps({ steps, cost }: { steps: StepItem[]; cost?: UsageSum }) {
  const [open, setOpen] = useState(false);
  const done = steps.filter((s) => !s.running);
  const running = steps.find((s) => s.running);
  const failed = done.filter((s) => s.result?.isError);
  const images = done.flatMap((s) => (s.result?.images ?? []).map((src) => ({ src, alt: toolLabel(s.name, s.args) })));
  return (
    <div className="flex flex-col gap-1.5">
      {done.length > 0 && (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex min-h-8 items-center gap-2 self-start text-left text-[13px] text-ink-dim transition-colors hover:text-ink"
        >
          <Check size={14} className="shrink-0 text-lime" aria-hidden />
          Did {done.length === 1 ? "1 thing" : `${done.length} things`}
          {cost && (
            <span className="text-ink-faint" title={usageLine(cost)}>
              · {costText(cost)}
            </span>
          )}
          <ChevronRight size={13} className={cx("shrink-0 transition-transform", open && "rotate-90")} aria-hidden />
        </button>
      )}
      {open && (
        <ul className="ml-[7px] flex flex-col gap-1 border-l border-line pl-4">
          {done.map((s) => (
            <li key={s.id} className={cx("text-[13px]", s.result?.isError ? "text-danger" : "text-ink-dim")}>
              {toolLabel(s.name, s.args)}
              {s.result?.isError && <span className="sr-only"> (didn&rsquo;t work)</span>}
            </li>
          ))}
        </ul>
      )}
      {failed.length > 0 && !open && (
        <p className="flex items-center gap-2 text-[13px] text-danger">
          <X size={14} className="shrink-0" aria-hidden /> {toolLabel(failed[0].name, failed[0].args)} didn&rsquo;t work
          {failed.length > 1 ? ` (and ${failed.length - 1} more)` : ""}
        </p>
      )}
      {images.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {images.slice(-3).map((im) => (
            <a key={im.src} href={im.src} target="_blank" rel="noreferrer">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={im.src} alt={im.alt} className="max-h-24" />
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          ))}
        </div>
      )}
      {running && (
        <p className="flex items-center gap-2 text-[13px] text-ink">
          <LosoMark working size={16} />
          {toolDoing(running.name, running.args)}…
        </p>
      )}
    </div>
  );
}

// ---------- panel ----------

export interface ChatControl {
  /** Focus the composer, or the recommended answer when a question waits. */
  focus(): void;
  /** Caret defaults to the end of the text. */
  fill(text: string, caret?: number): void;
  /** Attach pictures; `prompt` prefills the field (kept if you already typed), caret after `caretAt` chars. */
  attach(files: File[], opts?: { prompt?: string; caretAt?: number }): void;
  stop(): void;
  /** null = these files can go to Loso; otherwise why not, in plain words. */
  attachReason(types: string[]): string | null;
}

export const STARTERS = [
  "Put a big title on my video",
  "Make the words pop in one by one",
  "Line up my sound with my video",
  "Make it look like this picture",
];

type Attachment = { mime: string; data: string; name: string; file: File; thumb: string };

/** The chat with Loso. `api` = where the agent runs (default: the dev server). */
export function ChatPanel(props: ChatPanelProps & { api?: ChatApi }) {
  const { api: given, projectId } = props;
  const api = useMemo(() => given ?? serverChatApi(projectId), [given, projectId]);
  return (
    <ChatApiContext.Provider value={api}>
      <ChatPanelInner {...props} api={api} />
    </ChatApiContext.Provider>
  );
}

interface ChatPanelProps {
  projectId: string;
  onDoc: (doc: CompositorDoc, turn: string) => void;
  onBusyChange: (busy: boolean) => void;
  beforeSend: () => Promise<boolean>;
  canUndoTurn: (turn: string) => boolean;
  onUndoTurn: () => void;
  /** Fold / hide buttons from the dock, placed in this header. */
  dockControls?: ReactNode;
  controlRef?: RefObject<ChatControl | null>;
  onStatus?: (s: DockStatus) => void;
  /** The editor's one polite status region. */
  announce?: (msg: string) => void;
  dockOpen?: boolean;
  /** "Put it in the video instead" on a picture chip: the editor adds it as a piece. */
  onPutInVideo?: (file: File) => void;
}

function ChatPanelInner({
  api,
  projectId,
  onDoc,
  onBusyChange,
  beforeSend,
  canUndoTurn,
  onUndoTurn,
  dockControls,
  controlRef,
  onStatus,
  announce,
  dockOpen,
  onPutInVideo,
}: ChatPanelProps & { api: ChatApi}) {
  const settings = useSettingsSheet();
  const [payload, setPayload] = useState<ConfigPayload | undefined>(undefined);
  const [configError, setConfigError] = useState<string | null>(null);
  // Explicitly re-open the connect card (switch provider, rejected key, …).
  const [connect, setConnect] = useState<null | { notice?: string }>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const composerRef = useRef<ComposerHandle>(null);
  const askRef = useRef<AskHandle>(null);
  const [history, setHistory] = useState<Stored[]>([]);
  const [live, setLive] = useState<LiveEvent[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [draft, setDraft] = useDraft(`loso:draft:${projectId}`, attachments.length === 0);
  const [lastTurn, setLastTurn] = useState<string | null>(null);
  const [receipts, setReceipts] = useState<Array<{ afterSeq: number; text: string }>>([]);
  const [confirmClear, setConfirmClear] = useState(false);
  const [visionPick, setVisionPick] = useState<RankedModel | null | undefined>(undefined);
  const [dismissedVision, setDismissedVision] = useState(false);
  const [unread, setUnread] = useState(false);
  const [startedAt, setStartedAt] = useState(0);
  const [usage, setUsage] = useState<ChatUsage | null>(null);
  const [, tick] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const stoppedRef = useRef(false);

  const loadHistory = useCallback(async () => {
    const messages = await api.history();
    setHistory(messages);
    setLastTurn(messages.at(-1)?.turn ?? null);
    return messages;
  }, [api]);

  // Never wait forever on "Getting Loso ready…": after 15s it says so, with Try again.
  const loadConfig = useCallback(async () => {
    setConfigError(null);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const slow = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("it took too long")), 15_000);
      });
      setPayload(await Promise.race([api.config(), slow]));
    } catch (e) {
      setConfigError((e as Error).message);
    } finally {
      clearTimeout(timer);
    }
  }, [api]);

  useEffect(() => {
    loadConfig();
    loadHistory().catch((e: Error) => setError(e.message));
  }, [loadHistory, loadConfig]);

  // Tokens and estimated cost (the in-browser agent logs them; the dev server doesn't).
  const loadUsage = useCallback(() => {
    api.usage?.().then(setUsage, () => {});
  }, [api]);
  useEffect(() => {
    loadUsage();
    window.addEventListener(USAGE_CHANGED, loadUsage);
    return () => window.removeEventListener(USAGE_CHANGED, loadUsage);
  }, [loadUsage]);

  // A key or model saved from the settings sheet: pick it up here too.
  useEffect(() => {
    const reload = () => loadConfig();
    window.addEventListener(AI_CONFIG_CHANGED, reload);
    return () => window.removeEventListener(AI_CONFIG_CHANGED, reload);
  }, [loadConfig]);

  useEffect(() => onBusyChange(busy), [busy, onBusyChange]);
  useEffect(() => {
    if (dockOpen) setUnread(false);
  }, [dockOpen]);

  // Elapsed time shows only after 20s; tick once a second while busy.
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [busy]);

  // Follow new content only if the reader is already near the bottom.
  const nearBottom = useRef(true);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !nearBottom.current) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollTo({ top: el.scrollHeight, behavior: reduce ? "auto" : "smooth" });
  }, [history, live, receipts]);

  // Abort a running turn when the panel unmounts.
  useEffect(() => () => abortRef.current?.abort(), []);

  const send = useCallback(
    async (body: Record<string, unknown>) => {
      setError(null);
      setErrorCode(null);
      if (!(await beforeSend().catch(() => false))) {
        setError("Couldn't save your latest changes, so Loso didn't start.");
        return;
      }
      const ac = new AbortController();
      abortRef.current = ac;
      stoppedRef.current = false;
      nearBottom.current = true;
      setBusy(true);
      setStartedAt(Date.now());
      setLive([]);
      announce?.("Loso is thinking");
      try {
        await api.run(
          body as AgentBody,
          (ev) => {
            if (ev.type === "doc") onDoc(ev.doc, ev.turn);
            else if (ev.type === "turn") setLastTurn(ev.turn);
            else if (ev.type === "tool_start") announce?.(toolDoing(ev.name, ev.args));
            else if (ev.type === "error") {
              setError(ev.message);
              setErrorCode(ev.code ?? null);
              if (ev.code === "auth") setConnect({ notice: "The provider rejected your key — it may be revoked or mistyped." });
              if (ev.code === "no_model") loadConfig();
            }
            if (ev.type !== "doc") setLive((l) => [...l, ev]);
          },
          ac.signal
        );
      } catch (e) {
        if ((e as Error).name !== "AbortError") setError((e as Error).message);
      } finally {
        abortRef.current = null;
        setBusy(false);
        const msgs = await loadHistory().catch(() => null);
        setLive([]);
        if (stoppedRef.current) {
          announce?.("Stopped. Loso didn't change anything after that.");
        } else if (msgs) {
          const last = [...msgs].reverse().find((s) => s.message.role === "assistant");
          const m = last?.message;
          const asks = m && m.role === "assistant" ? m.toolCalls?.find((c) => c.name === "ask_user") : undefined;
          if (asks) {
            const q = (asks.args.questions as Question[] | undefined)?.[0]?.question;
            announce?.(`Loso has a question${q ? `: ${q}` : ""}`);
          } else {
            const text = m && m.role === "assistant" ? m.content.find((p) => p.type === "text") : undefined;
            announce?.(`Loso finished.${text && text.type === "text" ? ` ${firstSentence(text.text)}` : ""}`);
          }
        }
        setUnread(true);
      }
    },
    [api, onDoc, beforeSend, loadHistory, loadConfig, announce]
  );

  const resume = (toolCallId: string, p: Record<string, unknown>) => {
    // C2: keep focus somewhere sensible once the card turns into a receipt.
    composerRef.current?.focus();
    return send({ kind: "resume", toolCallId, ...p });
  };

  // ---- view model ----
  const results = useMemo(() => {
    const m = new Map<string, ToolResult>();
    for (const s of history) {
      if (s.message.role === "tool") {
        m.set(s.message.toolCallId, {
          content: s.message.content,
          isError: s.message.isError,
          images: (s.message.images ?? []).map((i) => api.imageUrl(i)).filter(Boolean),
        });
      }
    }
    for (const e of live) if (e.type === "tool_end") m.set(e.id, { content: e.summary, isError: !e.ok, images: e.images });
    return m;
  }, [history, live]);

  // The open question (if any) pins above the composer instead of the thread.
  const pendingAsk = useMemo(() => {
    if (busy) return null;
    for (let i = history.length - 1; i >= 0; i--) {
      const m = history[i].message;
      if (m.role === "user") return null;
      if (m.role === "assistant") {
        const c = m.toolCalls?.find((t) => t.name === "ask_user" && !results.has(t.id));
        return c ?? null;
      }
    }
    return null;
  }, [history, results, busy]);

  const phase = useMemo(() => {
    if (pendingAsk) return "Loso has a question";
    if (!busy) return null;
    const running = [...live].reverse().find((e) => e.type === "tool_start" && !results.has(e.id));
    if (running && running.type === "tool_start") {
      // A long step (model download, transcribing) reports its own progress.
      const after = live.slice(live.lastIndexOf(running) + 1);
      const progress = [...after].reverse().find((e) => e.type === "progress");
      return progress && progress.type === "progress" ? progress.text : toolDoing(running.name, running.args);
    }
    if (live.at(-1)?.type === "text") return "Writing back";
    return "Thinking";
  }, [busy, live, results, pendingAsk]);

  const status: DockStatus = useMemo(
    () => ({ busy, phase, question: !!pendingAsk, unread: unread && !busy }),
    [busy, phase, pendingAsk, unread]
  );
  const statusKey = JSON.stringify(status);
  useEffect(() => {
    onStatus?.(status);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusKey]);

  const cfg = payload?.config ?? null;
  const vision = !!cfg?.vision;

  function addFiles(files: FileList | File[]) {
    for (const f of Array.from(files)) {
      if (!f.type.startsWith("image/")) {
        setError(`Loso can only look at pictures in the chat for now, so ${f.name} wasn't added.`);
        continue;
      }
      if (f.size > 8 * 1024 * 1024) {
        setError(`${f.name} is too big (over 8 MB).`);
        continue;
      }
      const r = new FileReader();
      r.onload = () => {
        const url = String(r.result);
        const data = url.split(",")[1] ?? "";
        setAttachments((a) => [...a, { mime: f.type, data, name: f.name || "Pasted picture", file: f, thumb: url }]);
      };
      r.readAsDataURL(f);
    }
    setDismissedVision(false);
  }

  // Suggest a model that can see, the moment a picture meets a words-only model.
  const needsVision = attachments.length > 0 && !!cfg && !vision && !dismissedVision;
  useEffect(() => {
    if (!needsVision || visionPick !== undefined || !cfg) return;
    api
      .models()
      .then((ids) => setVisionPick(bestVisionModel(ids, cfg.model)))
      .catch(() => setVisionPick(null));
  }, [needsVision, visionPick, cfg, api]);

  useImperativeHandle(controlRef, () => ({
    focus: () => (pendingAsk ? askRef.current?.focus() : composerRef.current?.focus()),
    fill: (text: string, caret?: number) => composerRef.current?.fill(text, caret),
    attach: (files: File[], opts?: { prompt?: string; caretAt?: number }) => {
      addFiles(files);
      if (opts?.prompt) {
        // Don't throw away what's already typed: put the prompt in front of it.
        const typed = draft.trim();
        const text = typed ? `${opts.prompt}${typed}` : opts.prompt;
        composerRef.current?.fill(text, opts.caretAt ?? opts.prompt.length);
      } else {
        composerRef.current?.focus();
      }
    },
    stop: () => {
      stoppedRef.current = true;
      abortRef.current?.abort();
    },
    attachReason: (types: string[]) =>
      types.length && types.every((t) => t.startsWith("image/"))
        ? null
        : "Loso can only look at pictures in the chat for now.",
  }));

  function submit() {
    const text = draft.trim();
    if (busy) return;
    if (pendingAsk && text && !attachments.length) {
      setDraft("");
      askRef.current?.answerCurrent(text);
      return;
    }
    if (!text && !attachments.length) return;
    if (attachments.length && !vision) return; // the suggestion above explains
    setDraft("");
    const images = attachments.map(({ mime, data }) => ({ mime, data }));
    const names = attachments.map((a) => a.name);
    setAttachments([]);
    // optimistic user line
    setHistory((h) => [
      ...h,
      {
        seq: -1,
        turn: "",
        message: { role: "user", content: [{ type: "text", text }, ...names.map((n) => ({ type: "text" as const, text: `Picture: ${n}` }))] },
      },
    ]);
    send({ kind: "message", text, images });
  }

  async function clearChat() {
    await api.clear();
    setHistory([]);
    setLastTurn(null);
    setReceipts([]);
    setError(null);
    setConfirmClear(false);
    announce?.("Chat cleared. Your video is unchanged.");
  }

  // ---- header ----
  const header = (title: ReactNode) => (
    <div className="flex min-h-[52px] shrink-0 items-center gap-2 border-b border-line pl-4 pr-1">
      <h2 className="shrink-0 font-serif text-[19px] italic leading-none text-ink">Loso</h2>
      <div className="min-w-0 flex-1">{title}</div>
      {dockControls}
    </div>
  );

  if (configError) {
    return (
      <>
        {header(null)}
        <div className="flex flex-col gap-2 p-5">
          <InlineError>{`Loso couldn't get ready (${configError}).`}</InlineError>
          <button
            type="button"
            onClick={() => {
              setPayload(undefined);
              loadConfig();
            }}
            className="min-h-10 self-start text-[13px] text-lime hover:underline"
          >
            Try again
          </button>
        </div>
      </>
    );
  }
  if (payload === undefined) {
    return (
      <>
        {header(null)}
        <p className="flex items-center gap-2.5 p-5 text-[13px] text-ink-dim" role="status">
          <LosoMark working size={18} />
          Getting Loso ready…
        </p>
      </>
    );
  }

  const presetLabel = payload.presets.find((p) => p.id === cfg?.preset)?.label ?? "the provider";
  const failedTest = cfg?.lastTest && (!cfg.lastTest.ok || !cfg.lastTest.tools) ? cfg.lastTest : null;
  const notConnected = !cfg || !cfg.model || (cfg.needsKey && !cfg.hasKey);
  if (notConnected || failedTest || connect) {
    const notice =
      connect?.notice ??
      (failedTest
        ? failedTest.ok
          ? `${friendlyModel(failedTest.model)} answered but can't edit your video. Pick another model.`
          : explainFailure(failedTest.error ?? "The model didn't answer", presetLabel, cfg?.baseUrl ?? "").text
        : null);
    return (
      <>
        {header(
          <button
            type="button"
            onClick={() => setConnect({})}
            className="flex h-8 items-center border border-lime/70 px-2.5 text-[12.5px] text-ink"
            style={{ borderRadius: 2 }}
          >
            Add your key
          </button>
        )}
        {/* data-tour-hold: no tour starts while someone is typing their key here. */}
        <div data-tour="connect" data-tour-hold className="min-h-0 flex-1 overflow-y-auto">
          {api.local ? (
            <LocalConnect
              notice={notice}
              onCancel={connect && !notConnected && !failedTest ? () => setConnect(null) : undefined}
              onConnected={async () => {
                setConnect(null);
                setError(null);
                setErrorCode(null);
                await loadConfig();
              }}
            />
          ) : (
            <ConnectCard
              key={`${cfg?.preset}-${cfg?.model}-${!!connect}`}
              payload={payload}
              notice={notice}
              onCancel={connect && !notConnected && !failedTest ? () => setConnect(null) : undefined}
              onConnected={async () => {
                setConnect(null);
                setError(null);
                setErrorCode(null);
                await loadConfig();
              }}
            />
          )}
        </div>
      </>
    );
  }
  const model = cfg!; // connected: preset + model (+ key) present, last test (if any) passed

  async function runTest() {
    setTesting(true);
    try {
      await api.test();
    } catch {
      /* the result is recorded server-side either way */
    } finally {
      setTesting(false);
      loadConfig();
    }
  }

  const turnUndoable = !busy && !!lastTurn && canUndoTurn(lastTurn);
  const lastSeq = history.at(-1)?.seq ?? 0;
  const elapsed = busy ? Math.floor((Date.now() - startedAt) / 1000) : 0;

  // ---- thread items: user quotes, Loso's words, grouped steps, cards ----
  type Item =
    | { kind: "user"; key: string; parts: StoredPart[] }
    | { kind: "prose"; key: string; text: string }
    | { kind: "steps"; key: string; steps: StepItem[]; turn?: string }
    | { kind: "card"; key: string; node: ReactNode }
    | { kind: "receipt"; key: string; text: string };
  const items: Item[] = [];
  const pushStep = (s: StepItem, key: string, turn?: string) => {
    const last = items.at(-1);
    if (last?.kind === "steps" && last.turn === turn) last.steps.push(s);
    else items.push({ kind: "steps", key, steps: [s], turn });
  };
  const receiptsAfter = (seq: number) =>
    receipts.filter((r) => r.afterSeq === seq).forEach((r, i) => items.push({ kind: "receipt", key: `r${seq}-${i}`, text: r.text }));
  receiptsAfter(0);
  history.forEach((s, idx) => {
    const m = s.message;
    const key = `${s.seq}-${idx}`;
    if (m.role === "user") items.push({ kind: "user", key, parts: m.content });
    else if (m.role === "assistant") {
      m.content.forEach((p, i) => p.type === "text" && p.text.trim() && items.push({ kind: "prose", key: `${key}-t${i}`, text: p.text }));
      for (const c of m.toolCalls ?? []) {
        const r = results.get(c.id);
        if (c.name === "ask_user") {
          if (r) items.push({ kind: "card", key: c.id, node: <AskReceipt call={c} answered={r.content.replace(/^User answers: /, "")} /> });
        } else if (c.name === "propose_storyboard") {
          items.push({
            kind: "card",
            key: c.id,
            node: <StoryboardCard call={c} result={r?.content} disabled={busy} onDecide={(approved, note) => resume(c.id, { approved, note })} />,
          });
        } else if (CONFIRM_TOOLS.has(c.name) && !r) {
          items.push({ kind: "card", key: c.id, node: <ConfirmCard call={c} disabled={busy} onDecide={(approved) => resume(c.id, { approved })} /> });
        } else {
          pushStep({ id: c.id, name: c.name, args: c.args, result: r }, `${key}-s`, s.turn);
        }
      }
    }
    if (s.seq > 0) receiptsAfter(s.seq);
  });
  live.forEach((e, i) => {
    if (e.type === "text" && e.text.trim()) {
      const last = items.at(-1);
      if (last?.kind === "prose" && last.key.startsWith("live")) last.text += e.text;
      else items.push({ kind: "prose", key: `live-${i}`, text: e.text });
    }
    if (e.type === "tool_start" && !INTERACTIVE.has(e.name)) {
      const r = results.get(e.id);
      pushStep({ id: e.id, name: e.name, args: e.args, result: r, running: !r }, `live-s${i}`, lastTurn ?? undefined);
    }
  });

  // Each turn's cost shows once, on its last "Did N things" row, after it finishes.
  const costAt = new Map<string, string>();
  for (const it of items) {
    if (it.kind === "steps" && it.turn && usage?.turns[it.turn] && !(busy && it.turn === lastTurn)) costAt.set(it.turn, it.key);
  }
  const chatUsage = usage && usage.chat.input + usage.chat.output + usage.chat.cacheRead > 0 ? usage.chat : null;
  const overBudget = usage && usage.budget !== null && usage.monthCost >= usage.budget ? usage : null;

  const pictureNeedsSwitch = attachments.length > 0 && !vision;

  return (
    <>
      {header(
        <ModelChip
          usageNote={chatUsage ? `This chat: ${usageLine(chatUsage)} (estimate)` : undefined}
          model={model.model}
          vision={model.vision}
          busy={busy}
          onManage={() => settings.open({ opener: document.querySelector<HTMLElement>("#loso-chat [aria-haspopup=dialog]") })}
          onSwitched={async (name) => {
            setReceipts((r) => [...r, { afterSeq: lastSeq, text: `Switched to ${name}` }]);
            announce?.(`Switched to ${name}`);
            setVisionPick(undefined);
            await loadConfig();
          }}
        />
      )}

      {/* One status line, never a log. */}
      {(busy || !model.lastTest) && (
        <div className="shrink-0 border-b border-line">
          {busy ? (
            <>
              <p className="flex min-h-10 items-center gap-2.5 px-4 text-[13.5px] text-ink">
                <LosoMark working size={18} />
                <span className="min-w-0 flex-1 truncate">{phase}…</span>
                {elapsed >= 20 && <span className="font-mono text-[12px] text-ink-dim">{elapsed}s</span>}
              </p>
              <div className="shimmer" aria-hidden />
            </>
          ) : (
            <p className="flex min-h-10 items-center gap-2 px-4 text-[13px] text-ink-dim">
              <span className="flex-1">Loso hasn&rsquo;t checked this model yet.</span>
              <button type="button" onClick={runTest} disabled={testing} className="flex min-h-8 items-center gap-1.5 text-lime hover:underline disabled:opacity-60">
                {testing && <Loader2 size={12} className="animate-spin" />} Check it now
              </button>
            </p>
          )}
        </div>
      )}

      <div
        ref={scrollRef}
        role="log"
        aria-live="off"
        aria-label="Conversation with Loso"
        onScroll={(e) => {
          const el = e.currentTarget;
          nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 py-5"
      >
        {history.length === 0 && live.length === 0 && (
          <div className="flex flex-col gap-4">
            <p className="font-serif text-[24px] font-light italic leading-tight text-ink">What are we making?</p>
            <p className="text-[13.5px] leading-relaxed text-ink-dim">Tell Loso in your own words. Try one of these:</p>
            <ul className="flex flex-col border-t border-line">
              {STARTERS.filter((s) => vision || !s.includes("picture")).map((s) => (
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
            {model.preset === "groq" && (
              <p className="text-[12.5px] leading-relaxed text-ink-dim">
                Groq&rsquo;s free plan has a speed limit. Big jobs may pause for a moment and then carry on.
              </p>
            )}
          </div>
        )}

        {items.map((it) => {
          if (it.kind === "user") {
            return (
              <div key={it.key} className="flex flex-col items-end gap-1.5">
                {it.parts.map((p, i) =>
                  p.type === "text" ? (
                    p.text.trim() && (
                      <p
                        key={i}
                        className="max-w-[88%] whitespace-pre-wrap border-l border-lime/60 pl-3 font-serif text-[16.5px] italic leading-snug text-ink"
                      >
                        {p.text}
                      </p>
                    )
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={i} src={api.imageUrl(p)} alt="A picture you gave Loso" className="max-h-40" />
                  )
                )}
              </div>
            );
          }
          if (it.kind === "prose") return <Prose key={it.key} text={it.text} />;
          if (it.kind === "steps") return <Steps key={it.key} steps={it.steps} cost={it.key === costAt.get(it.turn ?? "") ? usage?.turns[it.turn ?? ""] : undefined} />;
          if (it.kind === "receipt")
            return (
              <p key={it.key} className="flex items-center gap-2 text-[13px] text-ink-dim">
                <Check size={14} className="text-lime" aria-hidden /> {it.text}
              </p>
            );
          return <div key={it.key}>{it.node}</div>;
        })}

        {!busy && (turnUndoable || (history.length > 0 && !pendingAsk)) && (
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
            {turnUndoable && (
              <button
                type="button"
                onClick={onUndoTurn}
                className="flex min-h-10 items-center gap-1.5 text-[13px] text-ink-dim transition-colors hover:text-ink"
              >
                <RotateCcw size={13} aria-hidden /> Undo what Loso just did
              </button>
            )}
            {history.length > 0 &&
              (confirmClear ? (
                <span className="flex items-center gap-3 text-[13px] text-ink" role="group" aria-label="Clear the chat?">
                  Clear the whole chat? Your video stays.
                  <button type="button" onClick={clearChat} className="min-h-10 text-danger hover:underline">
                    Clear
                  </button>
                  <button type="button" autoFocus onClick={() => setConfirmClear(false)} className="min-h-10 text-ink-dim hover:text-ink">
                    Keep
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmClear(true)}
                  className="min-h-10 text-[13px] text-ink-faint transition-colors hover:text-ink"
                >
                  Clear chat
                </button>
              ))}
          </div>
        )}

        {!busy && chatUsage && (
          <p className="text-[12px] text-ink-faint">
            This chat: {fmtTokens(tokensIn(chatUsage))} tokens in · {fmtTokens(chatUsage.output)} out · {costText(chatUsage)}
            <span className="sr-only"> (an estimate; your AI provider&rsquo;s billing page has the real amount)</span>
          </p>
        )}
        {!busy && overBudget && (
          <p role="status" className="border-l-2 border-line-strong pl-3 text-[13px] leading-snug text-ink-dim">
            This month&rsquo;s estimate ({fmtUsd(overBudget.monthCost)}) has passed the limit you set ({fmtUsd(overBudget.budget!)}). You
            can see what was used, or change the limit, in Settings → AI.
          </p>
        )}
      </div>

      {error && (
        <div className="flex shrink-0 flex-col gap-1 border-t border-line px-4 py-2.5">
          <InlineError onDismiss={() => setError(null)}>
            {errorCode === "rate_limit"
              ? `${presetLabel} asked Loso to slow down. ${error}`
              : errorCode === "context"
                ? `This chat got too long for ${friendlyModel(model.model)}.`
                : error}
          </InlineError>
          {!busy && (errorCode === "rate_limit" || errorCode === "connection" || errorCode === "other") && (
            <button
              type="button"
              onClick={() => send({ kind: "message", text: "continue" })}
              className="min-h-8 self-start text-[13px] text-lime hover:underline"
            >
              Try again
            </button>
          )}
          {!busy && errorCode === "context" && (
            <div className="flex gap-4 text-[13px]">
              <button type="button" onClick={() => setConfirmClear(true)} className="min-h-8 text-lime hover:underline">
                Clear chat (your video stays)
              </button>
            </div>
          )}
        </div>
      )}

      {pendingAsk && (
        <div className="max-h-[55%] shrink-0 overflow-y-auto">
          <AskCard
            key={pendingAsk.id}
            ref={askRef}
            call={pendingAsk}
            disabled={busy}
            onSubmit={(answer) => resume(pendingAsk.id, { answer })}
            onLeave={() => composerRef.current?.focus()}
          />
        </div>
      )}

      <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => e.target.files && addFiles(e.target.files)} />
      <Composer
        ref={composerRef}
        value={draft}
        onChange={setDraft}
        onSubmit={submit}
        busy={busy}
        onStop={() => {
          stoppedRef.current = true;
          abortRef.current?.abort();
        }}
        canSend={!busy && (!!draft.trim() || attachments.length > 0) && !pictureNeedsSwitch}
        attachments={attachments.map((a, i) => ({
          name: a.name,
          kind: "picture",
          thumb: a.thumb,
          action: onPutInVideo
            ? {
                label: "Put it in the video instead",
                onClick: () => {
                  setAttachments((x) => x.filter((_, j) => j !== i));
                  // The last picture is gone: drop the "Fix this:" we added, keep their words.
                  if (attachments.length === 1)
                    setDraft(draft.replace(/^Fix this:\s*/, "").replace(/\s*\(at \d+:\d\d[^)]*\)\s*$/, ""));
                  onPutInVideo(a.file);
                  composerRef.current?.focus();
                },
              }
            : undefined,
        }))}
        onRemoveAttachment={(i) => setAttachments((x) => x.filter((_, j) => j !== i))}
        onAttach={() => fileRef.current?.click()}
        onPasteFiles={(files) => addFiles(files.filter((f) => f.type.startsWith("image/")))}
        placeholder={busy ? "Loso is working…" : pendingAsk ? "Answer above, or type here" : "Tell Loso what you want…"}
        label={pendingAsk ? "Your answer, or a message for Loso" : "Message Loso"}
        showHint={history.length === 0}
        above={
          pictureNeedsSwitch && !dismissedVision ? (
            <div className="flex flex-col gap-2 border-l-2 border-lime py-1 pl-3" role="status">
              <p className="text-[13.5px] leading-snug text-ink">
                {visionPick
                  ? `This needs to look at your picture. Switch to ${friendlyModel(visionPick.id)} (sees pictures)?`
                  : visionPick === null
                    ? "This model can't look at pictures, and none of the models on your key can. Remove the picture to send."
                    : "This model can't look at pictures. Finding one that can…"}
              </p>
              <div className="flex gap-2">
                {visionPick && (
                  <Button
                    size="sm"
                    onClick={async () => {
                      try {
                        await api.switchModel(visionPick);
                        const name = friendlyModel(visionPick.id);
                        setReceipts((r) => [...r, { afterSeq: lastSeq, text: `Switched to ${name}` }]);
                        announce?.(`Switched to ${name}`);
                        setVisionPick(undefined);
                        await loadConfig();
                      } catch (e) {
                        setError((e as Error).message);
                      }
                    }}
                  >
                    Switch
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setAttachments([]);
                    setDismissedVision(true);
                  }}
                >
                  Not now
                </Button>
              </div>
            </div>
          ) : null
        }
      />
    </>
  );
}

export { INTERACTIVE };
