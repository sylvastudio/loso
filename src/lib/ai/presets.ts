// Friendly provider presets over the three adapter kinds. Client-safe (no
// server imports) so the Settings panel can render the same list.

import type { ProviderKind, ProviderPresetId } from "./types";

export interface ProviderPreset {
  id: ProviderPresetId;
  label: string;
  kind: ProviderKind;
  baseUrl: string;
  needsKey: boolean;
  keyHint: string;
  docsUrl: string;
  /** true = this provider's /audio/transcriptions returns word-level timings. */
  sttWordTimings: boolean;
  sttModel?: string;
  /** Base URL is meant to be edited (local servers, custom gateways). */
  editableBaseUrl: boolean;
}

export const PRESETS: ProviderPreset[] = [
  {
    id: "openai",
    label: "OpenAI",
    kind: "openai",
    baseUrl: "https://api.openai.com/v1",
    needsKey: true,
    keyHint: "sk-…",
    docsUrl: "https://platform.openai.com/api-keys",
    sttWordTimings: true,
    sttModel: "whisper-1",
    editableBaseUrl: false,
  },
  {
    id: "anthropic",
    label: "Anthropic (Claude)",
    kind: "anthropic",
    baseUrl: "https://api.anthropic.com",
    needsKey: true,
    keyHint: "sk-ant-…",
    docsUrl: "https://console.anthropic.com/settings/keys",
    sttWordTimings: false,
    editableBaseUrl: false,
  },
  {
    id: "gemini",
    label: "Google Gemini",
    kind: "gemini",
    baseUrl: "https://generativelanguage.googleapis.com",
    needsKey: true,
    keyHint: "AIza…",
    docsUrl: "https://aistudio.google.com/app/apikey",
    sttWordTimings: false,
    editableBaseUrl: false,
  },
  {
    id: "xai",
    label: "xAI (Grok)",
    kind: "openai",
    baseUrl: "https://api.x.ai/v1",
    needsKey: true,
    keyHint: "xai-…",
    docsUrl: "https://console.x.ai",
    sttWordTimings: false,
    editableBaseUrl: false,
  },
  {
    id: "groq",
    label: "Groq",
    kind: "openai",
    baseUrl: "https://api.groq.com/openai/v1",
    needsKey: true,
    keyHint: "gsk_…",
    docsUrl: "https://console.groq.com/keys",
    sttWordTimings: true,
    sttModel: "whisper-large-v3-turbo",
    editableBaseUrl: false,
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    kind: "openai",
    baseUrl: "https://openrouter.ai/api/v1",
    needsKey: true,
    keyHint: "sk-or-…",
    docsUrl: "https://openrouter.ai/keys",
    sttWordTimings: false,
    editableBaseUrl: false,
  },
  {
    id: "ollama",
    label: "Ollama (local)",
    kind: "openai",
    baseUrl: "http://localhost:11434/v1",
    needsKey: false,
    keyHint: "no key needed",
    docsUrl: "https://ollama.com/download",
    sttWordTimings: false,
    editableBaseUrl: true,
  },
  {
    id: "lmstudio",
    label: "LM Studio (local)",
    kind: "openai",
    baseUrl: "http://localhost:1234/v1",
    needsKey: false,
    keyHint: "no key needed",
    docsUrl: "https://lmstudio.ai",
    sttWordTimings: false,
    editableBaseUrl: true,
  },
  {
    id: "custom",
    label: "Custom (OpenAI-compatible)",
    kind: "openai",
    baseUrl: "",
    needsKey: false,
    keyHint: "optional — whatever your server expects",
    docsUrl: "https://platform.openai.com/docs/api-reference/chat",
    sttWordTimings: false,
    editableBaseUrl: true,
  },
];

export function getPreset(id: string | null | undefined): ProviderPreset | undefined {
  return PRESETS.find((p) => p.id === id);
}
