"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUp,
  Check,
  ChevronRight,
  ImagePlus,
  Loader2,
  RotateCcw,
  Square,
  Trash2,
  X,
} from "lucide-react";
import { Button, InlineError, cx } from "@/components/ui";
import { fetchJson } from "@/lib/fetch-json";
import type { CompositorDoc } from "@/lib/compositor";
import { ConnectCard, explainFailure, type ConfigPayload } from "@/components/agent/connect-card";

// ---------- stored message shapes (mirror lib/studio/agent.ts) ----------

type StoredImage = { type: "image"; mime: string; hash: string };
type StoredPart = { type: "text"; text: string } | StoredImage;
type ToolCall = { id: string; name: string; args: Record<string, unknown> };
type Msg =
  | { role: "user"; content: StoredPart[] }
  | { role: "assistant"; content: StoredPart[]; toolCalls?: ToolCall[] }
  | { role: "tool"; toolCallId: string; name: string; content: string; images?: StoredImage[]; isError?: boolean };
type Stored = { seq: number; turn: string; message: Msg };

type LiveEvent =
  | { type: "turn"; turn: string }
  | { type: "text"; text: string }
  | { type: "tool_start"; id: string; name: string; args: Record<string, unknown> }
  | { type: "tool_end"; id: string; name: string; ok: boolean; summary: string; images: string[] }
  | { type: "doc"; doc: CompositorDoc; turn: string }
  | { type: "waiting"; id: string; name: string; args: Record<string, unknown> }
  | { type: "done" }
  | { type: "error"; message: string; code?: string; retryAfterSec?: number };

const CONFIRM_TOOLS = new Set(["footage_cut", "render_video"]);
const INTERACTIVE = new Set(["ask_user", "propose_storyboard"]);

// Friendly one-liners for tool activity.
function toolLabel(name: string, args: Record<string, unknown>): string {
  const a = args ?? {};
  const s = (k: string) => (a[k] == null ? "" : String(a[k]));
  switch (name) {
    case "footage_scan": return `Scanned ${s("folder")}`;
    case "footage_contact_sheet": return `Looked through ${s("clip")}`;
    case "footage_frame": return `Checked ${s("clip")} at ${s("timeSec")}s`;
    case "footage_transcribe": return `Transcribed ${s("clip")}`;
    case "footage_words": return `Word timings · ${s("clip")} ${s("from")}–${s("to")}s`;
    case "footage_cut": return "Cut the edit";
    case "snapshot": return `Looked at the frame at ${s("timeSec")}s`;
    case "get_composition": return "Read the composition";
    case "set_output": return "Set the canvas";
    case "add_layers": return `Added ${Array.isArray(a.layers) ? a.layers.length : ""} layer(s)`;
    case "update_layers": return `Updated ${Array.isArray(a.updates) ? a.updates.length : ""} layer(s)`;
    case "remove_layers": return a.all ? "Cleared the canvas" : "Removed layers";
    case "add_captions": return `Added ${Array.isArray(a.captions) ? a.captions.length : ""} captions`;
    case "apply_template": return `Applied template ${s("templateId")}`;
    case "save_template": return `Saved template “${s("name")}”`;
    case "list_templates": return "Checked templates";
    case "import_file": return `Imported ${s("path").split("/").pop()}`;
    case "render_video": return "Rendered the MP4";
    default: return name.replace(/_/g, " ");
  }
}

// Minimal, safe markdown: paragraphs, **bold**, `code`, - lists.
function Prose({ text }: { text: string }) {
  const blocks = text.trim().split(/\n{2,}/);
  const inline = (t: string, k: number) =>
    t.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((p, i) =>
      p.startsWith("**") ? (
        <strong key={`${k}-${i}`} className="font-semibold text-ink">{p.slice(2, -2)}</strong>
      ) : p.startsWith("`") ? (
        <code key={`${k}-${i}`} className="rounded bg-line px-1 font-mono text-[11.5px]">{p.slice(1, -1)}</code>
      ) : (
        <span key={`${k}-${i}`}>{p}</span>
      )
    );
  return (
    <div className="flex flex-col gap-2 text-[13px] leading-relaxed text-ink-dim">
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

// ---------- interactive cards ----------

function AskCard({
  call, answered, onSubmit, disabled,
}: {
  call: ToolCall; answered?: string; onSubmit: (answer: Record<string, string>) => void; disabled: boolean;
}) {
  const qs = (Array.isArray(call.args.questions) ? call.args.questions : []) as Array<{ id: string; question: string; options?: string[] }>;
  const [vals, setVals] = useState<Record<string, string>>({});
  const [other, setOther] = useState<Record<string, string>>({});
  const ready = qs.every((q) => (vals[q.id] === "__other" ? other[q.id]?.trim() : vals[q.id]));
  const given = useMemo<Record<string, string>>(() => {
    try {
      return answered ? JSON.parse(answered) : {};
    } catch {
      return {};
    }
  }, [answered]);
  return (
    <div className="rounded-lg border border-line-strong bg-panel/60 p-3.5">
      <p className="micro mb-3 text-lime">{answered ? "Answered" : "The agent needs your call"}</p>
      <div className="flex flex-col gap-4">
        {qs.map((q) => (
          <div key={q.id} className="flex flex-col gap-2">
            <p className="text-[13px] text-ink">{q.question}</p>
            {answered && given[q.id] && (
              <p className="flex items-center gap-1.5 text-[12.5px] text-lime">
                <Check size={12} /> {given[q.id]}
              </p>
            )}
            {!answered && (
              <div className="flex flex-wrap gap-1.5">
                {(q.options ?? []).map((o) => (
                  <button
                    key={o}
                    type="button"
                    aria-pressed={vals[q.id] === o}
                    onClick={() => setVals((v) => ({ ...v, [q.id]: o }))}
                    className={cx(
                      "rounded-full border px-3 py-1 text-left text-[12px] transition-colors",
                      vals[q.id] === o ? "border-lime bg-lime/10 text-ink" : "border-line text-ink-dim hover:border-line-strong"
                    )}
                  >
                    {o}
                  </button>
                ))}
                <button
                  type="button"
                  aria-pressed={vals[q.id] === "__other"}
                  onClick={() => setVals((v) => ({ ...v, [q.id]: "__other" }))}
                  className={cx(
                    "rounded-full border px-3 py-1 text-[12px] transition-colors",
                    vals[q.id] === "__other" ? "border-lime bg-lime/10 text-ink" : "border-dashed border-line text-ink-faint hover:border-line-strong"
                  )}
                >
                  Other…
                </button>
              </div>
            )}
            {!answered && vals[q.id] === "__other" && (
              <input
                autoFocus
                aria-label={`Your answer: ${q.question}`}
                value={other[q.id] ?? ""}
                onChange={(e) => setOther((o) => ({ ...o, [q.id]: e.target.value }))}
                className="uline text-[13px]"
                placeholder="Type your answer"
              />
            )}
          </div>
        ))}
      </div>
      {answered ? (
        Object.keys(given).length ? null : (
          <p className="mt-3 border-t border-line pt-2.5 font-mono text-[11px] text-ink-faint">{answered}</p>
        )
      ) : (
        <div className="mt-4 flex justify-end">
          <Button
            size="sm"
            disabled={!ready || disabled}
            onClick={() =>
              onSubmit(Object.fromEntries(qs.map((q) => [q.id, vals[q.id] === "__other" ? other[q.id].trim() : vals[q.id]])))
            }
          >
            Send answers
          </Button>
        </div>
      )}
    </div>
  );
}

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
  return (
    <div className="rounded-lg border border-line-strong bg-panel/60 p-3.5">
      <p className="micro mb-2 text-lime">Storyboard{result ? (result.startsWith("User approved") ? " · approved" : " · changes requested") : ""}</p>
      {a.summary && <p className="mb-3 font-serif text-[15px] italic leading-snug text-ink">{a.summary}</p>}
      <ol className="flex flex-col gap-2.5">
        {(a.beats ?? []).map((b, i) => (
          <li key={i} className="flex gap-2.5">
            {a.folder ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`/api/studio/frame?folder=${encodeURIComponent(a.folder)}&clip=${encodeURIComponent(b.clip)}&t=${b.clipTime}`}
                alt={`${b.clip} at ${b.clipTime}s`}
                className="h-[72px] w-[44px] shrink-0 rounded-sm border border-line object-cover"
                loading="lazy"
              />
            ) : (
              <span className="h-[72px] w-[44px] shrink-0 rounded-sm border border-line" />
            )}
            <div className="min-w-0 flex-1">
              <p className="font-mono text-[10.5px] text-ink-faint">
                {Number(b.from).toFixed(1)}–{Number(b.to).toFixed(1)}s · {b.clip} @ {b.clipTime}s
              </p>
              {b.heard && <p className="mt-0.5 font-serif text-[13px] italic leading-snug text-ink-dim">“{b.heard}”</p>}
              {b.caption && <p className="mt-0.5 text-[11.5px] text-ink-faint">CC: {b.caption}</p>}
            </div>
          </li>
        ))}
      </ol>
      {!result && (
        <div className="mt-3.5 flex flex-col gap-2 border-t border-line pt-3">
          {changing && (
            <textarea
              autoFocus
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="What should change?"
              aria-label="Requested changes"
              className="w-full resize-none rounded-md border border-line bg-black/40 px-2.5 py-2 text-[12.5px] text-ink outline-none focus:border-lime/60"
            />
          )}
          <div className="flex justify-end gap-2">
            {changing ? (
              <Button size="sm" variant="outline" disabled={!note.trim() || disabled} onClick={() => onDecide(false, note)}>
                Send changes
              </Button>
            ) : (
              <Button size="sm" variant="ghost" disabled={disabled} onClick={() => setChanging(true)}>
                Request changes
              </Button>
            )}
            <Button size="sm" disabled={disabled} onClick={() => onDecide(true, note)}>
              <Check size={13} /> Approve & cut
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function ConfirmCard({
  call, onDecide, disabled,
}: {
  call: ToolCall; onDecide: (approved: boolean) => void; disabled: boolean;
}) {
  const a = call.args as { shots?: unknown[]; audio?: unknown[]; durationSec?: number; window?: { width: number; height: number } };
  const what =
    call.name === "footage_cut"
      ? `Cut ${a.shots?.length ?? 0} shots over ${a.audio?.length ?? 0} sound pieces · ${a.durationSec ?? "?"}s · ${a.window?.width}×${a.window?.height}. Takes a minute or two.`
      : "Export the composition to MP4. Takes about a minute.";
  return (
    <div className="rounded-lg border border-lime/40 bg-lime/5 p-3.5">
      <p className="micro mb-1.5 text-lime">{call.name === "footage_cut" ? "Ready to cut" : "Ready to render"}</p>
      <p className="text-[12.5px] leading-relaxed text-ink-dim">{what}</p>
      <div className="mt-3 flex justify-end gap-2">
        <Button size="sm" variant="ghost" disabled={disabled} onClick={() => onDecide(false)}>
          Not now
        </Button>
        <Button size="sm" disabled={disabled} onClick={() => onDecide(true)}>
          <Check size={13} /> Go ahead
        </Button>
      </div>
    </div>
  );
}

function ToolRow({
  name, args, result, running,
}: {
  name: string; args: Record<string, unknown>; result?: { content: string; isError?: boolean; images: string[] }; running?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 text-left font-mono text-[11px] text-ink-faint transition-colors hover:text-ink-dim"
        aria-expanded={open}
      >
        {running ? (
          <Loader2 size={11} className="shrink-0 animate-spin text-lime" />
        ) : result?.isError ? (
          <X size={11} className="shrink-0 text-danger" />
        ) : (
          <Check size={11} className="shrink-0 text-lime" />
        )}
        <span className={cx("min-w-0 flex-1 truncate", result?.isError && "text-danger/80")}>{toolLabel(name, args)}</span>
        <ChevronRight size={11} className={cx("shrink-0 transition-transform", open && "rotate-90")} />
      </button>
      {result?.images?.length ? (
        <div className="flex gap-1.5 pl-[19px]">
          {result.images.map((src) => (
            <a key={src} href={src} target="_blank" rel="noreferrer">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt={toolLabel(name, args)} className="max-h-28 rounded-sm border border-line" />
            </a>
          ))}
        </div>
      ) : null}
      {open && (
        <pre className="ml-[19px] max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-black/50 p-2 font-mono text-[10.5px] leading-relaxed text-ink-faint">
          {JSON.stringify(args, null, 1)}
          {result ? `\n→ ${result.content}` : ""}
        </pre>
      )}
    </div>
  );
}

// ---------- panel ----------

const FOLDER_TOKEN = "[folder]";
const STARTERS: Array<{ text: string; vision?: boolean }> = [
  { text: `Make a 30-second short from the clips in ${FOLDER_TOKEN} — the talk plus audience reactions. Ask me what you need first.` },
  { text: "Design a poster-card template like the screenshot I'm attaching, with the video inside the card.", vision: true },
  { text: "Look at the current composition and fix anything that overlaps or wraps badly." },
];

export function ChatPanel({
  projectId,
  onDoc,
  onBusyChange,
  beforeSend,
  canUndoTurn,
  onUndoTurn,
}: {
  projectId: string;
  onDoc: (doc: CompositorDoc, turn: string) => void;
  onBusyChange: (busy: boolean) => void;
  beforeSend: () => Promise<boolean>;
  canUndoTurn: (turn: string) => boolean;
  onUndoTurn: () => void;
}) {
  const [payload, setPayload] = useState<ConfigPayload | undefined>(undefined);
  const [configError, setConfigError] = useState<string | null>(null);
  // Explicitly re-open the connect card (switch model, rejected key, …).
  const [connect, setConnect] = useState<null | { notice?: string }>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const draftRef = useRef<HTMLTextAreaElement>(null);
  const [history, setHistory] = useState<Stored[]>([]);
  const [live, setLive] = useState<LiveEvent[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<Array<{ mime: string; data: string; name: string }>>([]);
  const [lastTurn, setLastTurn] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const loadHistory = useCallback(async () => {
    const d = await fetchJson<{ messages: Stored[] }>(`/api/projects/${projectId}/agent`);
    setHistory(d.messages);
    setLastTurn(d.messages.at(-1)?.turn ?? null);
  }, [projectId]);

  const loadConfig = useCallback(async () => {
    try {
      setPayload(await fetchJson<ConfigPayload>("/api/ai/config"));
      setConfigError(null);
    } catch (e) {
      setConfigError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    loadConfig();
    loadHistory().catch((e: Error) => setError(e.message));
  }, [loadHistory, loadConfig]);

  useEffect(() => onBusyChange(busy), [busy, onBusyChange]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [history, live]);

  // Abort a running turn when the panel unmounts.
  useEffect(() => () => abortRef.current?.abort(), []);

  const send = useCallback(
    async (body: Record<string, unknown>) => {
      setError(null);
      setErrorCode(null);
      if (!(await beforeSend())) {
        setError("Couldn't save your latest edits, so the agent wasn't started.");
        return;
      }
      const ac = new AbortController();
      abortRef.current = ac;
      setBusy(true);
      setLive([]);
      try {
        const res = await fetch(`/api/projects/${projectId}/agent`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: ac.signal,
        });
        if (!res.ok || !res.body) {
          const t = await res.text();
          throw new Error((() => { try { return JSON.parse(t).error; } catch { return t || `Request failed (${res.status})`; } })());
        }
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let i;
          while ((i = buf.indexOf("\n\n")) >= 0) {
            const chunk = buf.slice(0, i);
            buf = buf.slice(i + 2);
            const line = chunk.split("\n").find((l) => l.startsWith("data: "));
            if (!line) continue;
            const ev = JSON.parse(line.slice(6)) as LiveEvent;
            if (ev.type === "doc") onDoc(ev.doc, ev.turn);
            else if (ev.type === "turn") setLastTurn(ev.turn);
            else if (ev.type === "error") {
              setError(ev.message);
              setErrorCode(ev.code ?? null);
              if (ev.code === "auth") setConnect({ notice: "The provider rejected your key — it may be revoked or mistyped." });
              if (ev.code === "no_model") loadConfig();
            }
            if (ev.type !== "doc") setLive((l) => [...l, ev]);
          }
        }
      } catch (e) {
        if ((e as Error).name !== "AbortError") setError((e as Error).message);
      } finally {
        abortRef.current = null;
        setBusy(false);
        await loadHistory().catch(() => {});
        setLive([]);
      }
    },
    [projectId, onDoc, beforeSend, loadHistory, loadConfig]
  );

  function submit() {
    const text = draft.trim();
    if ((!text && !attachments.length) || busy) return;
    setDraft("");
    const images = attachments.map(({ mime, data }) => ({ mime, data }));
    setAttachments([]);
    // optimistic user bubble
    setHistory((h) => [
      ...h,
      { seq: -1, turn: "", message: { role: "user", content: [{ type: "text", text }, ...images.map(() => ({ type: "text" as const, text: "📎 image" }))] } },
    ]);
    send({ kind: "message", text, images });
  }

  function addFiles(files: FileList | File[]) {
    for (const f of Array.from(files)) {
      if (!f.type.startsWith("image/")) continue;
      if (f.size > 8 * 1024 * 1024) {
        setError(`${f.name} is over 8 MB`);
        continue;
      }
      const r = new FileReader();
      r.onload = () => {
        const data = String(r.result).split(",")[1] ?? "";
        setAttachments((a) => [...a, { mime: f.type, data, name: f.name }]);
      };
      r.readAsDataURL(f);
    }
  }

  // Build view: tool results by call id, and what's still waiting.
  const results = useMemo(() => {
    const m = new Map<string, { content: string; isError?: boolean; images: string[] }>();
    for (const s of history) {
      if (s.message.role === "tool") {
        m.set(s.message.toolCallId, {
          content: s.message.content,
          isError: s.message.isError,
          images: (s.message.images ?? []).map((i) => `/api/assets/${i.hash}`),
        });
      }
    }
    for (const e of live) if (e.type === "tool_end") m.set(e.id, { content: e.summary, isError: !e.ok, images: e.images });
    return m;
  }, [history, live]);

  const resume = (toolCallId: string, payload: Record<string, unknown>) =>
    send({ kind: "resume", toolCallId, ...payload });

  if (configError) {
    return (
      <div className="flex flex-col gap-2 p-5">
        <InlineError>{`Couldn't load the AI settings (${configError}).`}</InlineError>
        <button type="button" onClick={loadConfig} className="self-start text-[12px] text-lime hover:underline">
          Retry
        </button>
      </div>
    );
  }
  if (payload === undefined) {
    return <p className="p-5 text-[12.5px] text-ink-faint">Loading…</p>;
  }

  const cfg = payload.config;
  const presetLabel = payload.presets.find((p) => p.id === cfg?.preset)?.label ?? "the provider";
  const failedTest = cfg?.lastTest && (!cfg.lastTest.ok || !cfg.lastTest.tools) ? cfg.lastTest : null;
  const notConnected = !cfg || !cfg.model || (cfg.needsKey && !cfg.hasKey);
  if (notConnected || failedTest || connect) {
    const notice =
      connect?.notice ??
      (failedTest
        ? failedTest.ok
          ? `${failedTest.model} answered but didn't call tools — the agent needs tool calling. Pick another model.`
          : explainFailure(failedTest.error ?? "The model didn't answer", presetLabel, cfg?.baseUrl ?? "").text
        : null);
    return (
      <div className="min-h-0 flex-1 overflow-y-auto">
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
      </div>
    );
  }
  const model = cfg!; // connected: preset + model (+ key) present, last test (if any) passed

  async function runTest() {
    setTesting(true);
    try {
      await fetchJson("/api/ai/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    } catch {
      /* the result is recorded server-side either way */
    } finally {
      setTesting(false);
      loadConfig();
    }
  }

  function applyStarter(text: string) {
    setDraft(text);
    // select the folder placeholder so typing replaces it
    requestAnimationFrame(() => {
      const ta = draftRef.current;
      if (!ta) return;
      ta.focus();
      const i = text.indexOf(FOLDER_TOKEN);
      if (i >= 0) ta.setSelectionRange(i, i + FOLDER_TOKEN.length);
    });
  }

  const turnUndoable = !busy && !!lastTurn && canUndoTurn(lastTurn);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
        <span className={cx("led", "on")} />
        <button
          type="button"
          onClick={() => setConnect({})}
          disabled={busy}
          className="min-w-0 flex-1 truncate text-left font-mono text-[11px] text-ink-dim hover:text-lime disabled:hover:text-ink-dim"
          title="Switch model"
        >
          {model.model}
          {!model.vision && (
            <span
              className="text-ink-faint"
              title="Can't see images: no reference screenshots, and it checks layouts from geometry instead of looking. Works from transcripts and layer data."
            >
              {" "}· text-only
            </span>
          )}
        </button>
        {turnUndoable && (
          <button
            type="button"
            onClick={onUndoTurn}
            title="Undo everything the agent changed in its last turn"
            className="flex items-center gap-1 text-[11.5px] text-ink-faint transition-colors hover:text-ink"
          >
            <RotateCcw size={11} /> Undo turn
          </button>
        )}
        {history.length > 0 && !busy && (
          <button
            type="button"
            aria-label="Clear chat"
            title="Clear chat (the canvas is kept)"
            onClick={async () => {
              await fetch(`/api/projects/${projectId}/agent`, { method: "DELETE" });
              setHistory([]);
              setLastTurn(null);
            }}
            className="flex h-6 w-6 items-center justify-center rounded text-ink-faint hover:text-danger"
          >
            <Trash2 size={12} />
          </button>
        )}
      </div>

      {!model.lastTest && (
        <div className="flex items-center gap-2 border-b border-line bg-panel/60 px-4 py-2 text-[11.5px] text-ink-faint">
          <span className="flex-1">Not tested yet — check it can call tools and see images.</span>
          <button type="button" onClick={runTest} disabled={testing} className="flex items-center gap-1 text-lime hover:underline disabled:opacity-60">
            {testing && <Loader2 size={11} className="animate-spin" />} Test (under 1¢)
          </button>
        </div>
      )}

      <div ref={scrollRef} className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4" aria-live="polite">
        {history.length === 0 && live.length === 0 && (
          <div className="flex flex-col gap-3">
            <p className="font-serif text-[18px] italic leading-snug text-ink-dim">What are we making?</p>
            <p className="text-[12px] leading-relaxed text-ink-faint">
              Point me at a footage folder, attach a reference image, or ask for changes to this canvas. I&rsquo;ll ask
              before big decisions and show a storyboard before cutting.
            </p>
            {STARTERS.filter((s) => !s.vision || model.vision).map((s) => (
              <button
                key={s.text}
                type="button"
                onClick={() => applyStarter(s.text)}
                className="rounded-md border border-line px-3 py-2 text-left text-[12px] leading-snug text-ink-dim transition-colors hover:border-lime/60 hover:text-ink"
              >
                {s.text}
              </button>
            ))}
            <p className="text-[11px] leading-relaxed text-ink-faint">
              Folders: an absolute path or <code className="font-mono">~/…</code> on this computer. Footage is read in place, never copied.
            </p>
            {payload.transcription && (
              <p className="font-mono text-[10.5px] text-ink-faint">
                Transcripts: {payload.transcription.engine === "none" ? "not available — see Settings → AI model" : payload.transcription.detail}
              </p>
            )}
            {model.preset === "groq" && (
              <p className="rounded-md border border-line px-3 py-2 text-[11px] leading-relaxed text-ink-faint">
                Groq&rsquo;s free tier limits tokens per minute. Long builds may pause for rate limits (the agent waits and
                retries once). A paid tier works better for full video builds.
              </p>
            )}
          </div>
        )}

        {history.map((s, idx) => {
          const m = s.message;
          if (m.role === "tool") return null;
          if (m.role === "user") {
            return (
              <div key={`${s.seq}-${idx}`} className="flex flex-col items-end gap-1.5">
                {m.content.map((p, i) =>
                  p.type === "text" ? (
                    <p key={i} className="max-w-[90%] rounded-lg bg-line/70 px-3 py-2 text-[13px] leading-relaxed text-ink whitespace-pre-wrap">
                      {p.text}
                    </p>
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={i} src={`/api/assets/${p.hash}`} alt="attachment" className="max-h-40 rounded-md border border-line" />
                  )
                )}
              </div>
            );
          }
          return (
            <div key={`${s.seq}-${idx}`} className="flex flex-col gap-2.5">
              {m.content.map((p, i) => (p.type === "text" ? <Prose key={i} text={p.text} /> : null))}
              {(m.toolCalls ?? []).map((c) => {
                const r = results.get(c.id);
                if (c.name === "ask_user") {
                  return (
                    <AskCard
                      key={c.id}
                      call={c}
                      answered={r?.content.replace(/^User answers: /, "")}
                      disabled={busy}
                      onSubmit={(answer) => resume(c.id, { answer })}
                    />
                  );
                }
                if (c.name === "propose_storyboard") {
                  return (
                    <StoryboardCard
                      key={c.id}
                      call={c}
                      result={r?.content}
                      disabled={busy}
                      onDecide={(approved, note) => resume(c.id, { approved, note })}
                    />
                  );
                }
                if (CONFIRM_TOOLS.has(c.name) && !r) {
                  return (
                    <ConfirmCard key={c.id} call={c} disabled={busy} onDecide={(approved) => resume(c.id, { approved })} />
                  );
                }
                return <ToolRow key={c.id} name={c.name} args={c.args} result={r} />;
              })}
            </div>
          );
        })}

        {live.map((e, i) => {
          if (e.type === "text") return <Prose key={`l${i}`} text={e.text} />;
          if (e.type === "tool_start") {
            const r = results.get(e.id);
            return <ToolRow key={`l${i}`} name={e.name} args={e.args} result={r} running={!r} />;
          }
          return null;
        })}

        {busy && (
          <p className="micro flex items-center gap-2 text-lime">
            <span className="led on blink" /> Working
          </p>
        )}
        {error && (
          <div className="flex flex-col gap-2">
            <InlineError onDismiss={() => setError(null)} className="whitespace-normal">
              {errorCode === "rate_limit"
                ? `${presetLabel} rate limit hit. ${error}`
                : errorCode === "context"
                  ? `This turn is too big for ${model.model}'s limits.`
                  : error}
            </InlineError>
            {!busy && (errorCode === "rate_limit" || errorCode === "connection" || errorCode === "other") && (
              <button
                type="button"
                onClick={() => send({ kind: "message", text: "continue" })}
                className="self-start text-[12px] text-lime hover:underline"
              >
                Resume
              </button>
            )}
            {!busy && errorCode === "context" && (
              <div className="flex gap-3 text-[12px]">
                <button
                  type="button"
                  onClick={async () => {
                    await fetch(`/api/projects/${projectId}/agent`, { method: "DELETE" });
                    setHistory([]);
                    setLastTurn(null);
                    setError(null);
                  }}
                  className="text-lime hover:underline"
                >
                  Clear chat (canvas kept)
                </button>
                <button type="button" onClick={() => setConnect({})} className="text-ink-dim hover:underline">
                  Switch model
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* composer */}
      <div
        className="border-t border-line p-3"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files);
        }}
      >
        {attachments.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {attachments.map((a, i) => (
              <span key={i} className="flex items-center gap-1 rounded-full border border-line px-2 py-0.5 text-[11px] text-ink-dim">
                {a.name}
                <button type="button" aria-label={`Remove ${a.name}`} onClick={() => setAttachments((x) => x.filter((_, j) => j !== i))}>
                  <X size={10} />
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="flex items-end gap-2 rounded-lg border border-line bg-panel/60 px-2.5 py-2 focus-within:border-lime/60">
          <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => e.target.files && addFiles(e.target.files)} />
          <button
            type="button"
            aria-label="Attach an image"
            title={model.vision ? "Attach a reference image" : "This model can't see images"}
            disabled={!model.vision}
            onClick={() => fileRef.current?.click()}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-ink-faint transition-colors hover:text-ink disabled:opacity-30"
          >
            <ImagePlus size={14} />
          </button>
          <textarea
            ref={draftRef}
            value={draft}
            rows={Math.min(6, Math.max(1, draft.split("\n").length))}
            onChange={(e) => setDraft(e.target.value)}
            onPaste={(e) => {
              const files = Array.from(e.clipboardData.files ?? []);
              if (files.length && model.vision) {
                e.preventDefault();
                addFiles(files);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            aria-label="Message the studio agent"
            placeholder={busy ? "Working…" : "Ask the agent…"}
            className="max-h-40 min-w-0 flex-1 resize-none bg-transparent py-1 text-[13px] leading-relaxed text-ink outline-none placeholder:text-ink-faint"
          />
          {busy ? (
            <button
              type="button"
              aria-label="Stop the agent"
              onClick={() => abortRef.current?.abort()}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-line-strong text-ink hover:border-danger hover:text-danger"
            >
              <Square size={10} fill="currentColor" />
            </button>
          ) : (
            <button
              type="button"
              aria-label="Send"
              disabled={!draft.trim() && !attachments.length}
              onClick={submit}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-lime text-black transition-opacity disabled:opacity-30"
            >
              <ArrowUp size={14} />
            </button>
          )}
        </div>
        <p className="mt-1.5 px-1 font-mono text-[10px] text-ink-faint">↵ send · ⇧↵ new line · paste or drop images</p>
      </div>
    </div>
  );
}

export { INTERACTIVE };
