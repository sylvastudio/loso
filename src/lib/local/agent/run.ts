// The studio agent, running in this browser tab: the same tool-calling loop
// as the server agent (lib/studio/agent.ts), talking to the chosen provider
// (Claude, OpenAI, Grok, Groq, Gemini, OpenRouter) directly with the user's
// own key. Every model call's token count goes to the local usage log. State lives in the stored chat, so the loop can pause
// for the user (questions, storyboard approval, confirming an export) and
// pick up on the next call.

import { classifyAgentError } from "../../ai/errors";
import type { AiConfig, ChatMessage, ChatRequest, ContentPart, ImagePart, ToolCall } from "../../ai/types";
import type { CompositorDoc } from "../../compositor";
import { buildSystemPrompt } from "../../studio/prompt";
import { adapterFor, localAiConfig } from "../ai";
import { getBudget, monthSpend, recordUsage } from "../usage";
import { appendChat, loadChat, type LocalChatMessage, type LocalImage, type LocalPart, type LocalStored } from "./history";
import { browserToolInfos, getBrowserTool, runBrowserTool, type BrowserToolCtx } from "./tools";
import { logEvent } from "../../log";

export type LocalAgentEvent =
  | { type: "turn"; turn: string }
  | { type: "text"; text: string }
  | { type: "tool_start"; id: string; name: string; args: Record<string, unknown> }
  | { type: "tool_end"; id: string; name: string; ok: boolean; summary: string; images: string[] }
  | { type: "doc"; doc: CompositorDoc; turn: string }
  | { type: "waiting"; id: string; name: string; args: Record<string, unknown> }
  | { type: "progress"; text: string }
  | { type: "done" }
  | { type: "error"; message: string; code?: string; retryAfterSec?: number };

export type LocalAgentInput =
  | { kind: "message"; text: string; images?: Array<{ mime: string; data: string }> }
  | { kind: "resume"; toolCallId: string; approved?: boolean; answer?: unknown; note?: string };

export const NO_KEY_MESSAGE = "No AI key yet — paste one to let Loso think.";

const MAX_STEPS = 40;
// The whole reply. Claude streams, so a quiet provider fails sooner (90s,
// lib/ai/http.ts); this only stops one that never finishes.
const REPLY_TIMEOUT_MS = 600_000;
const KEEP_IMAGE_MESSAGES = 3;
const running = new Set<string>();

const newTurn = () => crypto.randomUUID().slice(0, 8);
const dataUrl = (img: { mime: string; data?: string }) => (img.data ? `data:${img.mime};base64,${img.data}` : "");
const asImage = (img: { mime: string; data: string }): LocalImage => ({ type: "image", mime: img.mime, hash: crypto.randomUUID().slice(0, 12), data: img.data });

/** Stored → provider-neutral messages. Only the last few image-bearing messages keep their pixels. */
function hydrate(stored: LocalStored[], vision: boolean): ChatMessage[] {
  let msgs = stored.map((s) => s.message);
  if (msgs.length > 90) {
    const cut = msgs.findIndex((m, i) => i >= msgs.length - 70 && m.role === "user");
    if (cut > 0) msgs = msgs.slice(cut);
  }
  const imageIdx = msgs
    .map((m, i) => ((m.role === "tool" ? m.images?.length : m.content.some((c) => c.type === "image")) ? i : -1))
    .filter((i) => i >= 0);
  const keep = new Set(imageIdx.slice(-KEEP_IMAGE_MESSAGES));
  const img = (p: LocalImage): ImagePart | null => (p.data ? { type: "image", mime: p.mime, data: p.data } : null);
  const part = (p: LocalPart, i: number): ContentPart =>
    p.type === "text"
      ? p
      : vision && keep.has(i)
        ? (img(p) ?? { type: "text", text: "[image unavailable]" })
        : { type: "text", text: "[earlier image omitted]" };
  return msgs.map((m, i): ChatMessage => {
    if (m.role === "tool") {
      const images = vision && keep.has(i) ? (m.images ?? []).map(img).filter((x): x is ImagePart => !!x) : [];
      const omitted = (m.images?.length ?? 0) > 0 && !images.length ? " [image omitted]" : "";
      return { role: "tool", toolCallId: m.toolCallId, name: m.name, content: m.content + omitted, images, isError: m.isError };
    }
    if (m.role === "user") return { role: "user", content: m.content.map((p) => part(p, i)) };
    return { role: "assistant", content: m.content.map((p) => part(p, i)), toolCalls: m.toolCalls };
  });
}

function unresolved(stored: LocalStored[]): ToolCall[] | null {
  for (let i = stored.length - 1; i >= 0; i--) {
    const m = stored[i].message;
    if (m.role === "assistant") {
      if (!m.toolCalls?.length) return null;
      const done = new Set(
        stored.slice(i + 1).map((s) => s.message).filter((x): x is Extract<LocalChatMessage, { role: "tool" }> => x.role === "tool").map((x) => x.toolCallId)
      );
      const calls = m.toolCalls.filter((c) => !done.has(c.id));
      return calls.length ? calls : null;
    }
    if (m.role === "user") return null;
  }
  return null;
}

/** chat() that rides out per-minute rate limits: up to 3 retries, at most ~90s waiting. */
async function chatWithRetry(cfg: AiConfig, req: ChatRequest, emit: (e: LocalAgentEvent) => void) {
  let waited = 0;
  for (let attempt = 0; ; attempt++) {
    // A reply that never comes must not leave the dock spinning.
    const timeout = AbortSignal.timeout(REPLY_TIMEOUT_MS);
    const signal = req.signal ? AbortSignal.any([req.signal, timeout]) : timeout;
    const started = Date.now();
    try {
      const res = await adapterFor(cfg.kind).chat(cfg, { ...req, signal });
      const sec = Math.round((Date.now() - started) / 1000);
      if (sec >= 60) logEvent("warn", `agent:${cfg.model}`, `slow reply: ${sec}s, ${res.usage?.input ?? "?"} tokens in, ${res.usage?.output ?? "?"} out`);
      return res;
    } catch (e) {
      if (timeout.aborted && !req.signal?.aborted) throw new Error("The AI was still going after 10 minutes, so Loso stopped. Try again, or ask for a smaller change.");
      if (/no reply for \d+s/.test((e as Error).message)) throw new Error("The AI went quiet for 90 seconds. Try again; if it keeps happening, start a new chat (Clear chat).");
      const c = classifyAgentError(e);
      if (c.code !== "rate_limit" || req.signal?.aborted || attempt >= 3 || waited >= 90) throw e;
      const wait = Math.min(45, Math.max(3, Math.ceil((c.retryAfterSec ?? 10) + 2 + attempt * 5)));
      waited += wait;
      emit({ type: "text", text: `(Claude is busy — waiting ${wait}s, then carrying on…)` });
      await new Promise((r) => setTimeout(r, wait * 1000));
    }
  }
}

/** Only when the user turned on "stop at my monthly limit": refuse to start another model call past it. */
async function checkBudget() {
  const b = await getBudget();
  if (!b.stopAtLimit || b.monthlyUsd === null) return;
  const spent = await monthSpend();
  if (spent.cost >= b.monthlyUsd) {
    const usd = (n: number) => n.toLocaleString(undefined, { style: "currency", currency: "USD" });
    throw new Error(
      `Loso stopped because this month's estimate (${usd(spent.cost)}) reached the limit you set (${usd(b.monthlyUsd)}). ` +
        "You can raise it or turn the stop off in Settings → AI → Usage."
    );
  }
}

export interface LocalAgentEnv {
  projectId: string;
  dir: FileSystemDirectoryHandle;
  getDoc(): CompositorDoc;
  render(): Promise<string>;
}

export async function runLocalAgent(
  env: LocalAgentEnv,
  input: LocalAgentInput,
  opts: { emit: (e: LocalAgentEvent) => void; signal: AbortSignal }
) {
  const { emit, signal } = opts;
  const { projectId } = env;
  const cfg = await localAiConfig();
  if (!cfg) {
    emit({ type: "error", message: NO_KEY_MESSAGE, code: "no_model" });
    emit({ type: "done" });
    return;
  }
  if (running.has(projectId)) {
    emit({ type: "error", message: "Loso is already working on this video." });
    emit({ type: "done" });
    return;
  }
  running.add(projectId);

  let history = await loadChat(projectId);
  const lastTurn = history.at(-1)?.turn;
  const turn = input.kind === "message" || !lastTurn ? newTurn() : lastTurn;
  const save = async (...m: LocalChatMessage[]) => {
    history = await appendChat(projectId, turn, m);
  };
  // The agent works on its own copy, which the editor adopts live.
  let doc = env.getDoc();
  const ctx: BrowserToolCtx = {
    dir: env.dir,
    projectId,
    vision: cfg.vision,
    getDoc: () => doc,
    setDoc(next) {
      doc = next;
      emit({ type: "doc", doc: next, turn });
    },
    render: env.render,
    status: (text) => emit({ type: "progress", text }),
  };
  emit({ type: "turn", turn });

  const runAndStore = async (call: ToolCall) => {
    emit({ type: "tool_start", id: call.id, name: call.name, args: call.args });
    const out = await runBrowserTool(call.name, ctx, call.args);
    const images = (out.images ?? []).map(asImage);
    await save({ role: "tool", toolCallId: call.id, name: call.name, content: out.text, images, isError: out.isError });
    if (out.isError) logEvent("warn", `agent:${call.name}`, out.text);
    emit({ type: "tool_end", id: call.id, name: call.name, ok: !out.isError, summary: out.text.slice(0, 280), images: images.map(dataUrl) });
  };

  const execute = async (call: ToolCall): Promise<"paused" | "ok"> => {
    const spec = getBrowserTool(call.name);
    if (spec?.interactive || spec?.confirm) {
      emit({ type: "waiting", id: call.id, name: call.name, args: call.args });
      return "paused";
    }
    await runAndStore(call);
    return "ok";
  };

  try {
    // 1. record the user's input
    if (input.kind === "message") {
      const skipped = (unresolved(history) ?? []).map(
        (c): LocalChatMessage => ({ role: "tool", toolCallId: c.id, name: c.name, content: "Skipped — the user sent a new message instead.", isError: true })
      );
      const parts: LocalPart[] = [];
      if (input.text.trim()) parts.push({ type: "text", text: input.text.trim() });
      for (const img of input.images ?? []) parts.push(asImage(img));
      if (!parts.length) throw new Error("Empty message");
      await save(...skipped, { role: "user", content: parts });
    } else {
      const call = unresolved(history)?.find((c) => c.id === input.toolCallId);
      if (!call) throw new Error("Nothing is waiting for that answer any more.");
      const spec = getBrowserTool(call.name);
      if (call.name === "ask_user") {
        await save({ role: "tool", toolCallId: call.id, name: call.name, content: `User answers: ${JSON.stringify(input.answer ?? {})}` });
      } else if (call.name === "propose_storyboard") {
        await save({
          role: "tool", toolCallId: call.id, name: call.name,
          content: input.approved
            ? `User approved the storyboard.${input.note ? ` Note: ${input.note}` : ""}`
            : `User wants changes before cutting: ${input.note || "(no details)"}`,
        });
      } else if (spec?.confirm) {
        if (input.approved) await runAndStore(call);
        else await save({ role: "tool", toolCallId: call.id, name: call.name, content: `User declined running ${call.name}.${input.note ? ` Note: ${input.note}` : ""}`, isError: true });
      }
      for (const c of unresolved(history) ?? []) {
        if (signal.aborted) return;
        if ((await execute(c)) === "paused") return;
      }
    }

    // 2. the model loop
    const tools = browserToolInfos().map(({ name, description, parameters }) => ({ name, description, parameters }));
    const system = buildSystemPrompt({ vision: cfg.vision, mode: "browser" });
    for (let step = 0; step < MAX_STEPS; step++) {
      if (signal.aborted) return;
      await checkBudget();
      const res = await chatWithRetry(cfg, { system, messages: hydrate(history, cfg.vision), tools, signal }, emit);
      if (res.usage) await recordUsage({ ...res.usage, provider: cfg.preset, model: cfg.model, at: Date.now(), projectId, turn });
      await save({ role: "assistant", content: res.text ? [{ type: "text", text: res.text }] : [], toolCalls: res.toolCalls.length ? res.toolCalls : undefined });
      if (res.text) emit({ type: "text", text: res.text });
      if (!res.toolCalls.length) break;
      for (const call of res.toolCalls) {
        if (signal.aborted) return;
        if ((await execute(call)) === "paused") return;
      }
      if (step === MAX_STEPS - 1) emit({ type: "text", text: "(Stopped after many steps — say “continue” to keep going.)" });
    }
  } catch (e) {
    if (!signal.aborted) {
      logEvent("error", `agent:${cfg.kind}/${cfg.model}`, e);
      emit({ type: "error", message: (e as Error).message, ...classifyAgentError(e) });
    }
  } finally {
    running.delete(projectId);
    emit({ type: "done" });
  }
}
