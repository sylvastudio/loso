import "server-only";
import crypto from "node:crypto";
import fs from "node:fs";
import { chat, getAiConfig, NO_MODEL_MESSAGE } from "../ai";
import { classifyAgentError, type AgentErrorCode } from "../ai/errors";
import type { ChatMessage, ContentPart, ImagePart, ToolCall, ToolDef } from "../ai/types";
import { storeAsset, assetPath } from "../assets";
import { getAsset } from "../repo";
import type { CompositorDoc } from "../compositor";
import { appendAgentMessage, listAgentMessages } from "./store";
import { getTool, runTool, toolInfos, type ToolOutput } from "./tools";
import { buildSystemPrompt } from "./prompt";

// The in-app studio agent: a tool-calling loop over the user's own model.
// State lives entirely in the stored chat history, so the loop can pause for
// the user (questions, storyboard approval, confirming a cut/render) and pick
// up again on the next request.

export type AgentEvent =
  | { type: "turn"; turn: string }
  | { type: "text"; text: string }
  | { type: "tool_start"; id: string; name: string; args: Record<string, unknown> }
  | { type: "tool_end"; id: string; name: string; ok: boolean; summary: string; images: string[] }
  | { type: "doc"; doc: CompositorDoc; turn: string }
  | { type: "waiting"; id: string; name: string; args: Record<string, unknown> }
  | { type: "done" }
  | { type: "error"; message: string; code?: AgentErrorCode; retryAfterSec?: number };

export type { AgentErrorCode };
const classify = classifyAgentError;

/**
 * chat() that rides out per-minute rate limits: up to 3 retries, waiting what
 * the provider asks for (plus a margin), at most ~90s in total.
 */
async function chatWithRetry(req: Parameters<typeof chat>[0], emit: (e: AgentEvent) => void) {
  let waited = 0;
  for (let attempt = 0; ; attempt++) {
    try {
      return await chat(req);
    } catch (e) {
      const c = classify(e);
      if (c.code !== "rate_limit" || req.signal?.aborted || attempt >= 3 || waited >= 90) throw e;
      const wait = Math.min(45, Math.max(3, Math.ceil((c.retryAfterSec ?? 10) + 2 + attempt * 5)));
      waited += wait;
      emit({ type: "text", text: `(Rate limit — waiting ${wait}s, then continuing…)` });
      await new Promise((r) => setTimeout(r, wait * 1000));
    }
  }
}

export type AgentInput =
  | { kind: "message"; text: string; images?: Array<{ mime: string; data: string }> }
  | { kind: "resume"; toolCallId: string; approved?: boolean; answer?: unknown; note?: string };

// Stored form: images are asset references, never base64.
type StoredImage = { type: "image"; mime: string; hash: string };
type StoredPart = { type: "text"; text: string } | StoredImage;
export type StoredChatMessage =
  | { role: "user"; content: StoredPart[] }
  | { role: "assistant"; content: StoredPart[]; toolCalls?: ToolCall[] }
  | { role: "tool"; toolCallId: string; name: string; content: string; images?: StoredImage[]; isError?: boolean };

const MAX_STEPS = 40;
const KEEP_IMAGE_MESSAGES = 3;
const locks = new Set<string>();

function storeImage(img: { mime: string; data: string }, kind: string): StoredImage {
  const meta = storeAsset(Buffer.from(img.data, "base64"), img.mime, `${kind}.jpg`, kind);
  return { type: "image", mime: img.mime, hash: meta.hash };
}

function loadImage(img: StoredImage): ImagePart | null {
  const meta = getAsset(img.hash);
  if (!meta) return null;
  const p = assetPath(meta.hash, meta.ext);
  if (!fs.existsSync(p)) return null;
  return { type: "image", mime: img.mime, data: fs.readFileSync(p).toString("base64") };
}

/** Stored → provider-neutral messages. Only the last few image-bearing messages keep their pixels. */
function hydrate(stored: StoredChatMessage[], vision: boolean): ChatMessage[] {
  let msgs = stored;
  // Keep the context bounded: drop old turns, cutting at a user message so
  // tool calls always stay paired with their results.
  if (msgs.length > 90) {
    const cut = msgs.findIndex((m, i) => i >= msgs.length - 70 && m.role === "user");
    if (cut > 0) msgs = msgs.slice(cut);
  }
  const imageIdx = msgs
    .map((m, i) => ((m.role === "tool" ? m.images?.length : m.content.some((c) => c.type === "image")) ? i : -1))
    .filter((i) => i >= 0);
  const keep = new Set(imageIdx.slice(-KEEP_IMAGE_MESSAGES));
  const part = (p: StoredPart, i: number): ContentPart =>
    p.type === "text"
      ? p
      : vision && keep.has(i)
        ? (loadImage(p) ?? { type: "text", text: "[image unavailable]" })
        : { type: "text", text: "[earlier image omitted]" };
  return msgs.map((m, i): ChatMessage => {
    if (m.role === "tool") {
      const images = vision && keep.has(i) ? (m.images ?? []).map(loadImage).filter((x): x is ImagePart => !!x) : [];
      const omitted = (m.images?.length ?? 0) > 0 && !images.length ? " [image omitted]" : "";
      return { role: "tool", toolCallId: m.toolCallId, name: m.name, content: m.content + omitted, images, isError: m.isError };
    }
    if (m.role === "user") return { role: "user", content: m.content.map((p) => part(p, i)) };
    return { role: "assistant", content: m.content.map((p) => part(p, i)), toolCalls: m.toolCalls };
  });
}

function systemPrompt(vision: boolean): string {
  return buildSystemPrompt({ vision, mode: "server" });
}

function unresolved(stored: StoredChatMessage[]): { assistantIndex: number; calls: ToolCall[] } | null {
  for (let i = stored.length - 1; i >= 0; i--) {
    const m = stored[i];
    if (m.role === "assistant") {
      if (!m.toolCalls?.length) return null;
      const done = new Set(
        stored.slice(i + 1).filter((x): x is Extract<StoredChatMessage, { role: "tool" }> => x.role === "tool").map((x) => x.toolCallId)
      );
      const calls = m.toolCalls.filter((c) => !done.has(c.id));
      return calls.length ? { assistantIndex: i, calls } : null;
    }
    if (m.role === "user") return null;
  }
  return null;
}

export async function runAgent(
  projectId: string,
  input: AgentInput,
  opts: { baseUrl: string; emit: (e: AgentEvent) => void; signal: AbortSignal }
) {
  const { emit, signal, baseUrl } = opts;
  const cfg = getAiConfig();
  if (!cfg || !cfg.model) {
    emit({ type: "error", message: NO_MODEL_MESSAGE, code: "no_model" });
    return;
  }
  if (locks.has(projectId)) {
    emit({ type: "error", message: "The agent is already working on this project." });
    return;
  }
  locks.add(projectId);
  const history = () => listAgentMessages(projectId).map((m) => m.message as StoredChatMessage);
  const lastTurn = listAgentMessages(projectId).at(-1)?.turn;
  const turn = input.kind === "message" || !lastTurn ? crypto.randomBytes(4).toString("hex") : lastTurn;
  const save = (m: StoredChatMessage) => appendAgentMessage(projectId, turn, m);
  const ctx = { projectId, baseUrl, vision: cfg.vision };
  emit({ type: "turn", turn });

  const execute = async (call: ToolCall): Promise<"paused" | "ok"> => {
    const spec = getTool(call.name);
    if (spec?.interactive || spec?.confirm) {
      emit({ type: "waiting", id: call.id, name: call.name, args: call.args });
      return "paused";
    }
    await runAndStore(call);
    return "ok";
  };

  const runAndStore = async (call: ToolCall) => {
    emit({ type: "tool_start", id: call.id, name: call.name, args: call.args });
    const out: ToolOutput = await runTool(call.name, ctx, call.args);
    const images = (out.images ?? []).map((img) => storeImage(img, "agent-view"));
    save({ role: "tool", toolCallId: call.id, name: call.name, content: out.text, images, isError: out.isError });
    emit({
      type: "tool_end", id: call.id, name: call.name, ok: !out.isError,
      summary: out.text.slice(0, 280), images: images.map((i) => `/api/assets/${i.hash}`),
    });
    if (out.doc) emit({ type: "doc", doc: out.doc, turn });
  };

  try {
    // 1. record the user's input
    if (input.kind === "message") {
      const pending = unresolved(history());
      // A new message while something is waiting cancels those calls.
      for (const c of pending?.calls ?? []) {
        save({ role: "tool", toolCallId: c.id, name: c.name, content: "Skipped — the user sent a new message instead.", isError: true });
      }
      const parts: StoredPart[] = [];
      if (input.text.trim()) parts.push({ type: "text", text: input.text.trim() });
      for (const img of input.images ?? []) parts.push(storeImage(img, "agent-upload"));
      if (!parts.length) throw new Error("Empty message");
      save({ role: "user", content: parts });
    } else {
      const pending = unresolved(history());
      const call = pending?.calls.find((c) => c.id === input.toolCallId);
      if (!call) throw new Error("Nothing is waiting for that answer any more.");
      const spec = getTool(call.name);
      if (call.name === "ask_user") {
        save({ role: "tool", toolCallId: call.id, name: call.name, content: `User answers: ${JSON.stringify(input.answer ?? {})}` });
      } else if (call.name === "propose_storyboard") {
        save({
          role: "tool", toolCallId: call.id, name: call.name,
          content: input.approved
            ? `User approved the storyboard.${input.note ? ` Note: ${input.note}` : ""}`
            : `User wants changes before cutting: ${input.note || "(no details)"}`,
        });
      } else if (spec?.confirm) {
        if (input.approved) await runAndStore(call);
        else save({ role: "tool", toolCallId: call.id, name: call.name, content: `User declined running ${call.name}.${input.note ? ` Note: ${input.note}` : ""}`, isError: true });
      }
      // finish the rest of that assistant message's calls
      for (const c of unresolved(history())?.calls ?? []) {
        if (signal.aborted) return;
        if ((await execute(c)) === "paused") return;
      }
    }

    // 2. the model loop
    const tools: ToolDef[] = toolInfos({ includeInteractive: true }).map(({ name, description, parameters }) => ({ name, description, parameters }));
    for (let step = 0; step < MAX_STEPS; step++) {
      if (signal.aborted) return;
      const res = await chatWithRetry(
        { system: systemPrompt(cfg.vision), messages: hydrate(history(), cfg.vision), tools, signal },
        emit
      );
      save({ role: "assistant", content: res.text ? [{ type: "text", text: res.text }] : [], toolCalls: res.toolCalls.length ? res.toolCalls : undefined });
      if (res.text) emit({ type: "text", text: res.text });
      if (!res.toolCalls.length) break;
      for (const call of res.toolCalls) {
        if (signal.aborted) return;
        if ((await execute(call)) === "paused") return;
      }
      if (step === MAX_STEPS - 1) emit({ type: "text", text: "(Stopped after many steps — say “continue” to keep going.)" });
    }
  } catch (e) {
    if (!signal.aborted) emit({ type: "error", message: (e as Error).message, ...classify(e) });
  } finally {
    locks.delete(projectId);
    emit({ type: "done" });
  }
}
