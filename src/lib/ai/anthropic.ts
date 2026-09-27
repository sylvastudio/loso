// Anthropic Messages API adapter (raw fetch, no SDK).
// POST {base}/v1/messages with x-api-key + anthropic-version headers.

import type { AiConfig, ChatAdapter, ChatMessage, ChatResponse, ImagePart, ToolCall } from "./types";
import { ProviderError, providerFetch, trimSlash } from "./http";
import { stripSchemaMeta } from "./openai";

const VERSION = "2023-06-01";
const LABEL = "Anthropic";

type TextBlock = { type: "text"; text: string };
type ImageBlock = { type: "image"; source: { type: "base64"; media_type: string; data: string } };
type ToolUseBlock = { type: "tool_use"; id: string; name: string; input: Record<string, unknown> };
type ToolResultBlock = {
  type: "tool_result";
  tool_use_id: string;
  content: Array<TextBlock | ImageBlock>;
  is_error?: boolean;
};
// thinking / redacted_thinking blocks are opaque: echoed back verbatim.
type OpaqueBlock = { type: "thinking" | "redacted_thinking"; [k: string]: unknown };
type Block = TextBlock | ImageBlock | ToolUseBlock | ToolResultBlock | OpaqueBlock;

// Models that think by default return thinking blocks before tool_use; they
// must be sent back unchanged with that assistant turn. They ride on the first
// ToolCall's providerMeta, with this in-memory map as a fallback.
const thinkingCache = new Map<string, OpaqueBlock[]>();
function rememberThinking(id: string, blocks: OpaqueBlock[]) {
  thinkingCache.set(id, blocks);
  if (thinkingCache.size > 200) thinkingCache.delete(thinkingCache.keys().next().value!);
}
interface AMessage {
  role: "user" | "assistant";
  content: Block[];
}

function base(cfg: AiConfig) {
  return trimSlash(cfg.baseUrl || "https://api.anthropic.com").replace(/\/v1$/, "");
}

function headers(cfg: AiConfig): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "x-api-key": cfg.apiKey ?? "",
    "anthropic-version": VERSION,
  };
}

function image(img: ImagePart): ImageBlock {
  return { type: "image", source: { type: "base64", media_type: img.mime, data: img.data } };
}

const omitted = (n: number): TextBlock => ({ type: "text", text: `[${n} image(s) omitted — this model has no vision]` });

export function toAnthropicMessages(messages: ChatMessage[], vision: boolean): AMessage[] {
  const out: AMessage[] = [];
  // Consecutive same-role turns are merged: all tool results from one assistant
  // turn land in a single user message (and a following user message joins it).
  const push = (role: AMessage["role"], blocks: Block[]) => {
    if (!blocks.length) blocks = [{ type: "text", text: "(empty)" }];
    const last = out[out.length - 1];
    if (last && last.role === role) {
      // tool_result blocks must lead the user message; keep them first.
      last.content.push(...blocks);
    } else out.push({ role, content: blocks });
  };

  for (const m of messages) {
    if (m.role === "user") {
      const blocks: Block[] = [];
      let dropped = 0;
      for (const p of m.content) {
        if (p.type === "text") {
          if (p.text) blocks.push({ type: "text", text: p.text });
        } else if (vision) blocks.push(image(p));
        else dropped++;
      }
      if (dropped) blocks.push(omitted(dropped));
      push("user", blocks);
    } else if (m.role === "assistant") {
      const blocks: Block[] = [];
      const first = m.toolCalls?.[0];
      const thinking =
        (Array.isArray(first?.providerMeta?.anthropicThinking)
          ? (first!.providerMeta!.anthropicThinking as OpaqueBlock[])
          : undefined) ?? (first ? thinkingCache.get(first.id) : undefined);
      if (thinking) blocks.push(...thinking);
      for (const p of m.content) if (p.type === "text" && p.text) blocks.push({ type: "text", text: p.text });
      for (const tc of m.toolCalls ?? []) {
        blocks.push({ type: "tool_use", id: tc.id, name: tc.name, input: tc.args ?? {} });
      }
      push("assistant", blocks);
    } else {
      const content: Array<TextBlock | ImageBlock> = [];
      content.push({ type: "text", text: m.content || (m.isError ? "Error" : "(no output)") });
      if (m.images?.length) {
        if (vision) content.push(...m.images.map(image));
        else content.push(omitted(m.images.length));
      }
      const block: ToolResultBlock = { type: "tool_result", tool_use_id: m.toolCallId, content };
      if (m.isError) block.is_error = true;
      push("user", [block]);
    }
  }
  // The API requires the first message to be from the user.
  if (out[0]?.role === "assistant") out.unshift({ role: "user", content: [{ type: "text", text: "(continue)" }] });
  return out;
}

export const anthropicAdapter: ChatAdapter = {
  async chat(cfg, req): Promise<ChatResponse> {
    const body: Record<string, unknown> = {
      model: cfg.model,
      max_tokens: req.maxTokens ?? 16000,
      messages: toAnthropicMessages(req.messages, cfg.vision),
    };
    if (req.system) body.system = req.system;
    if (req.temperature !== undefined) body.temperature = req.temperature;
    if (req.tools.length) {
      body.tools = req.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: stripSchemaMeta(t.parameters),
      }));
    }
    const send = () =>
      providerFetch(LABEL, `${base(cfg)}/v1/messages`, {
        method: "POST",
        headers: headers(cfg),
        body: JSON.stringify(body),
        signal: req.signal,
      });
    let raw: unknown;
    try {
      raw = await send();
    } catch (e) {
      // Newer Claude models reject sampling params; retry once without.
      if (e instanceof ProviderError && e.status === 400 && /temperature/i.test(e.message) && "temperature" in body) {
        delete body.temperature;
        raw = await send();
      } else throw e;
    }
    const data = raw as {
      content?: Array<{ type: string; text?: string; id?: string; name?: string; input?: unknown }>;
      stop_reason?: string;
    };
    let text = "";
    const toolCalls: ToolCall[] = [];
    const thinking: OpaqueBlock[] = [];
    for (const b of data.content ?? []) {
      if (b.type === "thinking" || b.type === "redacted_thinking") thinking.push(b as OpaqueBlock);
      else if (b.type === "text" && b.text) text += b.text;
      else if (b.type === "tool_use" && b.id && b.name) {
        const input = b.input;
        toolCalls.push({
          id: b.id,
          name: b.name,
          args: input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : {},
        });
      }
    }
    if (thinking.length && toolCalls.length) {
      toolCalls[0].providerMeta = { anthropicThinking: thinking };
      rememberThinking(toolCalls[0].id, thinking);
    }
    const sr = data.stop_reason;
    const stopReason: ChatResponse["stopReason"] =
      sr === "tool_use" || toolCalls.length
        ? "tool_calls"
        : sr === "end_turn" || sr === "stop_sequence"
          ? "end"
          : sr === "max_tokens"
            ? "length"
            : "other";
    if (sr === "refusal" && !text) text = "(The model declined this request.)";
    return { text, toolCalls, stopReason };
  },

  async listModels(cfg) {
    const ids: string[] = [];
    let after: string | null = null;
    for (let page = 0; page < 10; page++) {
      const qs = new URLSearchParams({ limit: "1000" });
      if (after) qs.set("after_id", after);
      const data = (await providerFetch(
        LABEL,
        `${base(cfg)}/v1/models?${qs}`,
        { method: "GET", headers: headers(cfg) },
        20_000
      )) as { data?: Array<{ id?: string }>; has_more?: boolean; last_id?: string | null };
      for (const m of data.data ?? []) if (m.id) ids.push(m.id);
      if (!data.has_more || !data.last_id) break;
      after = data.last_id;
    }
    return ids; // API returns newest first — keep that order.
  },
};
