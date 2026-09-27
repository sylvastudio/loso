// Provider-neutral chat + tool-calling contract. Every model adapter
// (OpenAI-compatible, Anthropic, Gemini) maps to and from these shapes, so the
// agent loop and tools never know which vendor is behind them.

export type ProviderKind = "openai" | "anthropic" | "gemini";

/** A preset is a friendly name over an adapter kind + default base URL. */
export type ProviderPresetId =
  | "openai"
  | "xai"
  | "groq"
  | "openrouter"
  | "ollama"
  | "lmstudio"
  | "custom"
  | "anthropic"
  | "gemini";

export interface AiConfig {
  preset: ProviderPresetId;
  kind: ProviderKind;
  baseUrl: string; // e.g. https://api.openai.com/v1 — unused for anthropic/gemini defaults
  model: string;
  /** Never sent to the browser; the config API returns `hasKey` + masked instead. */
  apiKey: string | null;
  /** Capabilities, from the Settings "Test" button (user can override). */
  vision: boolean;
  tools: boolean;
  /** Transcription: "provider" uses the preset's STT when it has word timings. */
  transcription: "provider" | "local" | "groq";
}

export interface ImagePart {
  type: "image";
  mime: string; // image/png | image/jpeg
  data: string; // base64 (no data: prefix)
}
export interface TextPart {
  type: "text";
  text: string;
}
export type ContentPart = TextPart | ImagePart;

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
  /**
   * Opaque provider data that must be echoed back with this call on the next
   * turn (e.g. Gemini's `thoughtSignature`). Keep it when storing history.
   */
  providerMeta?: Record<string, unknown>;
}

export type ChatMessage =
  | { role: "user"; content: ContentPart[] }
  | { role: "assistant"; content: ContentPart[]; toolCalls?: ToolCall[] }
  | {
      role: "tool";
      toolCallId: string;
      name: string;
      /** Text result; images (snapshots, contact sheets) ride along in `images`. */
      content: string;
      images?: ImagePart[];
      isError?: boolean;
    };

/** JSON-Schema subset every provider accepts (object/string/number/integer/boolean/array/enum). */
export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ChatRequest {
  system: string;
  messages: ChatMessage[];
  tools: ToolDef[];
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
}

export interface ChatResponse {
  text: string;
  toolCalls: ToolCall[];
  stopReason: "end" | "tool_calls" | "length" | "other";
}

export interface ChatAdapter {
  chat(cfg: AiConfig, req: ChatRequest): Promise<ChatResponse>;
  /** Model ids the key can use (for the Settings model picker). */
  listModels(cfg: AiConfig): Promise<string[]>;
}

export interface WordTiming {
  word: string;
  start: number;
  end: number;
}
export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}
export interface Transcript {
  text: string;
  durationSec: number;
  words: WordTiming[];
  segments: TranscriptSegment[];
  /** Which engine produced it, for display. */
  engine: string;
}
