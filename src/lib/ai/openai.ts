// OpenAI-compatible Chat Completions adapter. Covers OpenAI, xAI, Groq,
// OpenRouter, Ollama, LM Studio and any custom OpenAI-compatible server.

import type { AiConfig, ChatAdapter, ChatMessage, ChatResponse, ContentPart, ImagePart, ToolCall } from "./types";
import { getPreset } from "./presets";
import { ProviderError, providerFetch, trimSlash } from "./http";

type OAContent = string | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }>;

interface OAMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: OAContent | null;
  tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
}

function label(cfg: AiConfig) {
  return getPreset(cfg.preset)?.label.replace(/ \(.*\)$/, "") ?? "Model";
}

function headers(cfg: AiConfig): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (cfg.apiKey) h.Authorization = `Bearer ${cfg.apiKey}`;
  if (cfg.preset === "openrouter") {
    h["HTTP-Referer"] = "http://localhost:3000";
    h["X-Title"] = "Loso";
  }
  return h;
}

function dataUrl(img: ImagePart) {
  return `data:${img.mime};base64,${img.data}`;
}

function mapParts(parts: ContentPart[], vision: boolean): OAContent {
  const out: Exclude<OAContent, string> = [];
  let dropped = 0;
  for (const p of parts) {
    if (p.type === "text") out.push({ type: "text", text: p.text });
    else if (vision) out.push({ type: "image_url", image_url: { url: dataUrl(p) } });
    else dropped++;
  }
  if (dropped) out.push({ type: "text", text: `[${dropped} image(s) omitted — this model has no vision]` });
  // Plain string when there's only text: the most widely accepted shape.
  if (out.every((p) => p.type === "text")) return out.map((p) => (p as { text: string }).text).join("\n\n");
  return out;
}

export function toOpenAIMessages(system: string, messages: ChatMessage[], vision: boolean): OAMessage[] {
  const out: OAMessage[] = [];
  if (system) out.push({ role: "system", content: system });
  // Images returned by tools must come after *all* tool messages of a turn
  // (tool messages have to directly follow the assistant tool_calls message).
  let pendingImages: Array<{ name: string; images: ImagePart[] }> = [];
  const flush = () => {
    if (!pendingImages.length) return;
    const content: Exclude<OAContent, string> = [];
    for (const { name, images } of pendingImages) {
      content.push({ type: "text", text: `Images returned by tool ${name}:` });
      for (const img of images) content.push({ type: "image_url", image_url: { url: dataUrl(img) } });
    }
    out.push({ role: "user", content });
    pendingImages = [];
  };

  for (const m of messages) {
    if (m.role !== "tool") flush();
    if (m.role === "user") {
      out.push({ role: "user", content: mapParts(m.content, vision) });
    } else if (m.role === "assistant") {
      const text = m.content.filter((p) => p.type === "text").map((p) => (p as { text: string }).text).join("\n\n");
      const msg: OAMessage = { role: "assistant", content: text || null };
      if (m.toolCalls?.length) {
        msg.tool_calls = m.toolCalls.map((tc) => ({
          id: tc.id,
          type: "function",
          function: { name: tc.name, arguments: JSON.stringify(tc.args ?? {}) },
        }));
      }
      if (msg.content === null && !msg.tool_calls) msg.content = "";
      out.push(msg);
    } else {
      let content = m.content || (m.isError ? "Error" : "(no output)");
      if (m.isError && !/^error/i.test(content)) content = `Error: ${content}`;
      if (m.images?.length && !vision) content += `\n[${m.images.length} image(s) omitted — this model has no vision]`;
      out.push({ role: "tool", tool_call_id: m.toolCallId, content });
      if (m.images?.length && vision) pendingImages.push({ name: m.name, images: m.images });
    }
  }
  flush();
  return out;
}

export function parseArgs(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw !== "string" || raw.trim() === "") return {};
  try {
    const v = JSON.parse(raw);
    if (v && typeof v === "object" && !Array.isArray(v)) return v;
    return { __raw: raw };
  } catch {
    return { __raw: raw };
  }
}

/** Drop the top-level $schema marker some servers choke on. */
export function stripSchemaMeta(schema: Record<string, unknown>): Record<string, unknown> {
  if (!schema || typeof schema !== "object") return { type: "object", properties: {} };
  const { $schema: _drop, ...rest } = schema;
  void _drop;
  return Object.keys(rest).length ? rest : { type: "object", properties: {} };
}

let idSeq = 0;

export const openaiAdapter: ChatAdapter = {
  async chat(cfg, req): Promise<ChatResponse> {
    const body: Record<string, unknown> = {
      model: cfg.model,
      messages: toOpenAIMessages(req.system, req.messages, cfg.vision),
    };
    // OpenAI's current models want max_completion_tokens; most compatible
    // servers still only know max_tokens.
    if (cfg.preset === "openai") body.max_completion_tokens = req.maxTokens ?? 4096;
    else body.max_tokens = req.maxTokens ?? 4096;
    if (req.temperature !== undefined) body.temperature = req.temperature;
    if (req.tools.length) {
      body.tools = req.tools.map((t) => ({
        type: "function",
        function: { name: t.name, description: t.description, parameters: stripSchemaMeta(t.parameters) },
      }));
    }
    const send = () =>
      providerFetch(label(cfg), `${trimSlash(cfg.baseUrl)}/chat/completions`, {
        method: "POST",
        headers: headers(cfg),
        body: JSON.stringify(body),
        signal: req.signal,
      });
    let raw: unknown;
    try {
      raw = await send();
    } catch (e) {
      // One adaptive retry for the two most common parameter mismatches.
      const m = e instanceof ProviderError && e.status === 400 ? e.message : "";
      if (/temperature/i.test(m) && "temperature" in body) {
        delete body.temperature;
      } else if (/max_tokens/.test(m) && "max_tokens" in body) {
        body.max_completion_tokens = body.max_tokens;
        delete body.max_tokens;
      } else if (/max_completion_tokens/.test(m) && "max_completion_tokens" in body) {
        body.max_tokens = body.max_completion_tokens;
        delete body.max_completion_tokens;
      } else throw e;
      raw = await send();
    }
    const data = raw as {
      choices?: Array<{
        finish_reason?: string;
        message?: {
          content?: string | Array<{ type?: string; text?: string }> | null;
          tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: unknown } }>;
        };
      }>;
    };
    const choice = data.choices?.[0];
    if (!choice) throw new Error(`${label(cfg)}: response had no choices`);
    const msg = choice.message ?? {};
    const text =
      typeof msg.content === "string"
        ? msg.content
        : Array.isArray(msg.content)
          ? msg.content.map((c) => c.text ?? "").join("")
          : "";
    const toolCalls: ToolCall[] = (msg.tool_calls ?? [])
      .filter((tc) => tc.function?.name)
      .map((tc) => ({
        id: tc.id || `call_${Date.now().toString(36)}_${idSeq++}`,
        name: tc.function!.name!,
        args: parseArgs(tc.function!.arguments),
      }));
    const fr = choice.finish_reason;
    const stopReason: ChatResponse["stopReason"] = toolCalls.length
      ? "tool_calls"
      : fr === "length"
        ? "length"
        : fr === "stop" || fr === "end_turn" || !fr
          ? "end"
          : fr === "tool_calls" || fr === "function_call"
            ? "tool_calls"
            : "other";
    return { text, toolCalls, stopReason };
  },

  async listModels(cfg) {
    const data = (await providerFetch(
      label(cfg),
      `${trimSlash(cfg.baseUrl)}/models`,
      { method: "GET", headers: headers(cfg) },
      20_000
    )) as { data?: Array<{ id?: string }>; models?: Array<{ id?: string; name?: string }> };
    const list = data.data ?? data.models ?? [];
    return [...new Set(list.map((m) => m.id ?? (m as { name?: string }).name ?? "").filter(Boolean))].sort();
  },
};
