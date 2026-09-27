// Google Gemini generateContent adapter (v1beta REST, raw fetch).

import type { AiConfig, ChatAdapter, ChatMessage, ChatResponse, ImagePart, ToolCall } from "./types";
import { providerFetch, trimSlash } from "./http";

const LABEL = "Gemini";

type Part =
  | { text: string; thoughtSignature?: string }
  | { inlineData: { mimeType: string; data: string } }
  | { functionCall: { name: string; args: Record<string, unknown>; id?: string }; thoughtSignature?: string }
  | { functionResponse: { name: string; response: Record<string, unknown>; id?: string } };

interface Content {
  role: "user" | "model";
  parts: Part[];
}

function base(cfg: AiConfig) {
  return trimSlash(cfg.baseUrl || "https://generativelanguage.googleapis.com").replace(/\/v1(beta)?$/, "");
}

function modelPath(model: string) {
  return model.startsWith("models/") ? model : `models/${model}`;
}

function headers(cfg: AiConfig): Record<string, string> {
  return { "Content-Type": "application/json", "x-goog-api-key": cfg.apiKey ?? "" };
}

// Gemini returns a thoughtSignature on function-call parts (2.5+/3.x thinking
// models) that must be sent back on the next turn. It rides on
// ToolCall.providerMeta; this in-memory map is a fallback for callers that
// drop providerMeta when storing history.
const signatureCache = new Map<string, string>();
function rememberSignature(id: string, sig: string) {
  signatureCache.set(id, sig);
  if (signatureCache.size > 500) signatureCache.delete(signatureCache.keys().next().value!);
}

const inline = (img: ImagePart): Part => ({ inlineData: { mimeType: img.mime, data: img.data } });
const omitted = (n: number): Part => ({ text: `[${n} image(s) omitted — this model has no vision]` });

export function toGeminiContents(messages: ChatMessage[], vision: boolean): Content[] {
  const out: Content[] = [];
  const push = (role: Content["role"], parts: Part[]) => {
    if (!parts.length) parts = [{ text: "(empty)" }];
    const last = out[out.length - 1];
    if (last && last.role === role) last.parts.push(...parts);
    else out.push({ role, parts });
  };

  // Images from a run of tool results go after all functionResponse parts of
  // that user turn.
  let pendingImages: Part[] = [];
  const flush = () => {
    if (!pendingImages.length) return;
    const last = out[out.length - 1];
    if (last?.role === "user") last.parts.push(...pendingImages);
    else out.push({ role: "user", parts: pendingImages });
    pendingImages = [];
  };

  for (const m of messages) {
    if (m.role !== "tool") flush();
    if (m.role === "user") {
      const parts: Part[] = [];
      let dropped = 0;
      for (const p of m.content) {
        if (p.type === "text") {
          if (p.text) parts.push({ text: p.text });
        } else if (vision) parts.push(inline(p));
        else dropped++;
      }
      if (dropped) parts.push(omitted(dropped));
      push("user", parts);
    } else if (m.role === "assistant") {
      const parts: Part[] = [];
      for (const p of m.content) if (p.type === "text" && p.text) parts.push({ text: p.text });
      for (const tc of m.toolCalls ?? []) {
        const sig =
          (typeof tc.providerMeta?.thoughtSignature === "string" ? tc.providerMeta.thoughtSignature : undefined) ??
          signatureCache.get(tc.id);
        const fc: Part = { functionCall: { name: tc.name, args: tc.args ?? {} } };
        if (sig) (fc as { thoughtSignature?: string }).thoughtSignature = sig;
        parts.push(fc);
      }
      push("model", parts);
    } else {
      const text = m.content || (m.isError ? "Error" : "(no output)");
      push("user", [
        {
          functionResponse: {
            name: m.name,
            response: m.isError ? { error: text } : { result: text },
          },
        },
      ]);
      if (m.images?.length) {
        if (vision) pendingImages.push({ text: `Images returned by tool ${m.name}:` }, ...m.images.map(inline));
        else pendingImages.push(omitted(m.images.length));
      }
    }
  }
  flush();
  if (out[0]?.role === "model") out.unshift({ role: "user", parts: [{ text: "(continue)" }] });
  return out;
}

const KEEP = new Set(["type", "description", "properties", "required", "items", "enum", "nullable", "format"]);

/** Reduce a JSON Schema to Gemini's OpenAPI subset. */
export function sanitizeSchema(schema: unknown): Record<string, unknown> | undefined {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return undefined;
  const src = schema as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  // Collapse anyOf/oneOf [X, null] → X + nullable.
  const union = (src.anyOf ?? src.oneOf) as unknown[] | undefined;
  if (Array.isArray(union) && !src.type) {
    const nonNull = union.filter((s) => !(s && typeof s === "object" && (s as { type?: unknown }).type === "null"));
    const inner = sanitizeSchema(nonNull[0]) ?? { type: "string" };
    if (nonNull.length < union.length) inner.nullable = true;
    if (typeof src.description === "string" && !inner.description) inner.description = src.description;
    return inner;
  }

  for (const [k, v] of Object.entries(src)) {
    if (!KEEP.has(k)) continue;
    if (k === "type") {
      if (Array.isArray(v)) {
        const types = v.filter((t) => t !== "null");
        out.type = String(types[0] ?? "string").toUpperCase();
        if (types.length < v.length) out.nullable = true;
      } else if (typeof v === "string") out.type = v.toUpperCase();
    } else if (k === "properties" && v && typeof v === "object") {
      const props: Record<string, unknown> = {};
      for (const [pk, pv] of Object.entries(v as Record<string, unknown>)) {
        const s = sanitizeSchema(pv);
        if (s) props[pk] = s;
      }
      if (Object.keys(props).length) out.properties = props;
    } else if (k === "items") {
      const s = sanitizeSchema(v);
      if (s) out.items = s;
    } else if (k === "enum" && Array.isArray(v)) {
      out.enum = v.map(String);
      if (!out.type) out.type = "STRING";
    } else if (k === "format") {
      // Gemini only accepts a few formats; drop the rest.
      if (v === "enum" || v === "date-time") out.format = v;
    } else if (k === "required" && Array.isArray(v)) {
      out.required = v;
    } else {
      out[k] = v;
    }
  }
  if (out.enum) out.type = "STRING";
  if (out.type === "INTEGER" && out.enum) out.type = "STRING";
  // required may only name properties that survived.
  if (Array.isArray(out.required)) {
    const props = (out.properties ?? {}) as Record<string, unknown>;
    const req = (out.required as unknown[]).filter((r) => typeof r === "string" && r in props);
    if (req.length) out.required = req;
    else delete out.required;
  }
  if (out.type === "ARRAY" && !out.items) out.items = { type: "STRING" };
  return out;
}

let idSeq = 0;

export const geminiAdapter: ChatAdapter = {
  async chat(cfg, req): Promise<ChatResponse> {
    const body: Record<string, unknown> = {
      contents: toGeminiContents(req.messages, cfg.vision),
      generationConfig: {
        maxOutputTokens: req.maxTokens ?? 8192,
        ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
      },
    };
    if (req.system) body.systemInstruction = { parts: [{ text: req.system }] };
    if (req.tools.length) {
      body.tools = [
        {
          functionDeclarations: req.tools.map((t) => {
            const params = sanitizeSchema(t.parameters);
            const decl: Record<string, unknown> = { name: t.name, description: t.description };
            // A parameterless OBJECT schema is rejected; omit it instead.
            if (params && params.properties) decl.parameters = params;
            return decl;
          }),
        },
      ];
    }
    const data = (await providerFetch(LABEL, `${base(cfg)}/v1beta/${modelPath(cfg.model)}:generateContent`, {
      method: "POST",
      headers: headers(cfg),
      body: JSON.stringify(body),
      signal: req.signal,
    })) as {
      candidates?: Array<{
        finishReason?: string;
        content?: { parts?: Array<Record<string, unknown>> };
      }>;
      promptFeedback?: { blockReason?: string };
    };
    const cand = data.candidates?.[0];
    if (!cand) {
      const reason = data.promptFeedback?.blockReason;
      throw new Error(reason ? `Gemini blocked the prompt (${reason})` : "Gemini returned no candidates");
    }
    let text = "";
    const toolCalls: ToolCall[] = [];
    const turn = (idSeq++).toString(36);
    let i = 0;
    for (const part of cand.content?.parts ?? []) {
      if (part.thought === true) continue; // thought summaries aren't answer text
      if (typeof part.text === "string") text += part.text;
      const fc = part.functionCall as { name?: string; args?: unknown; id?: string } | undefined;
      if (fc?.name) {
        const id = fc.id || `gm_${turn}_${i}_${fc.name}`;
        i++;
        const call: ToolCall = {
          id,
          name: fc.name,
          args: fc.args && typeof fc.args === "object" && !Array.isArray(fc.args) ? (fc.args as Record<string, unknown>) : {},
        };
        if (typeof part.thoughtSignature === "string") {
          call.providerMeta = { thoughtSignature: part.thoughtSignature };
          rememberSignature(id, part.thoughtSignature);
        }
        toolCalls.push(call);
      }
    }
    const fr = cand.finishReason;
    const stopReason: ChatResponse["stopReason"] = toolCalls.length
      ? "tool_calls"
      : fr === "STOP" || !fr
        ? "end"
        : fr === "MAX_TOKENS"
          ? "length"
          : "other";
    if (!text && !toolCalls.length && fr && fr !== "STOP") text = `(Gemini stopped: ${fr})`;
    return { text, toolCalls, stopReason };
  },

  async listModels(cfg) {
    const ids: string[] = [];
    let pageToken: string | undefined;
    for (let page = 0; page < 10; page++) {
      const qs = new URLSearchParams({ pageSize: "1000" });
      if (pageToken) qs.set("pageToken", pageToken);
      const data = (await providerFetch(
        LABEL,
        `${base(cfg)}/v1beta/models?${qs}`,
        { method: "GET", headers: headers(cfg) },
        20_000
      )) as { models?: Array<{ name?: string; supportedGenerationMethods?: string[] }>; nextPageToken?: string };
      for (const m of data.models ?? []) {
        if (m.name && (m.supportedGenerationMethods ?? []).includes("generateContent")) {
          ids.push(m.name.replace(/^models\//, ""));
        }
      }
      if (!data.nextPageToken) break;
      pageToken = data.nextPageToken;
    }
    return ids;
  },
};
