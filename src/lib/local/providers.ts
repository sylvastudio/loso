// The AI providers the browser-only app can talk to directly, with the user's
// own key. Each one was checked (2026-11-13) to answer CORS preflights from
// any origin and to accept the key in a header (Authorization: Bearer, or
// x-goog-api-key), with CORS headers on error replies too, so a wrong key
// shows as "key rejected" rather than a network error. Providers that don't
// allow browser apps aren't listed.

import type { ProviderKind, ProviderPresetId } from "../ai/types";

export type BrowserProviderId = Extract<ProviderPresetId, "anthropic" | "openai" | "xai" | "groq" | "gemini" | "openrouter">;

export interface BrowserProvider {
  id: BrowserProviderId;
  /** What people call it. */
  name: string;
  /** One line under the name in the picker. */
  blurb: string;
  kind: ProviderKind;
  baseUrl: string;
  keyHint: string;
  /** Rough shape of a key, to catch a paste of the wrong thing. */
  keyShape: RegExp;
  keysUrl: string;
  keysSite: string;
  /** Step 2 of "Where do I get one?". */
  createStep: string;
}

export const BROWSER_PROVIDERS: BrowserProvider[] = [
  {
    id: "anthropic",
    name: "Claude",
    blurb: "Best at editing videos.",
    kind: "anthropic",
    baseUrl: "https://api.anthropic.com",
    keyHint: "sk-ant-…",
    keyShape: /^sk-ant-/,
    keysUrl: "https://console.anthropic.com/settings/keys",
    keysSite: "Anthropic’s key page",
    createStep: "Press Create key. Tip: set a monthly spending limit for it.",
  },
  {
    id: "openai",
    name: "ChatGPT (OpenAI)",
    blurb: "Works well. Needs an OpenAI API account, which is separate from a ChatGPT subscription.",
    kind: "openai",
    baseUrl: "https://api.openai.com/v1",
    keyHint: "sk-…",
    keyShape: /^sk-/,
    keysUrl: "https://platform.openai.com/api-keys",
    keysSite: "OpenAI’s key page",
    createStep: "Press Create new secret key. Add a little credit under Billing first.",
  },
  {
    id: "xai",
    name: "Grok (xAI)",
    blurb: "Works well.",
    kind: "openai",
    baseUrl: "https://api.x.ai/v1",
    keyHint: "xai-…",
    keyShape: /^xai-/,
    keysUrl: "https://console.x.ai",
    keysSite: "the xAI console",
    createStep: "Open API Keys and press Create API key.",
  },
  {
    id: "groq",
    name: "Groq",
    blurb: "Fast and cheap. Its models are smaller, so big edits can go wrong.",
    kind: "openai",
    baseUrl: "https://api.groq.com/openai/v1",
    keyHint: "gsk_…",
    keyShape: /^gsk_/,
    keysUrl: "https://console.groq.com/keys",
    keysSite: "Groq’s key page",
    createStep: "Press Create API Key.",
  },
  {
    id: "gemini",
    name: "Gemini (Google)",
    blurb: "Works well. Sees pictures.",
    kind: "gemini",
    baseUrl: "https://generativelanguage.googleapis.com",
    keyHint: "AIza…",
    keyShape: /^AIza/,
    keysUrl: "https://aistudio.google.com/app/apikey",
    keysSite: "Google AI Studio",
    createStep: "Press Create API key.",
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    blurb: "Many models from different companies with one key.",
    kind: "openai",
    baseUrl: "https://openrouter.ai/api/v1",
    keyHint: "sk-or-…",
    keyShape: /^sk-or-/,
    keysUrl: "https://openrouter.ai/keys",
    keysSite: "OpenRouter’s key page",
    createStep: "Press Create Key. Add a little credit first.",
  },
];

export const DEFAULT_PROVIDER: BrowserProviderId = "anthropic";

export function browserProvider(id: string | null | undefined): BrowserProvider {
  return BROWSER_PROVIDERS.find((p) => p.id === id) ?? BROWSER_PROVIDERS[0];
}

/** The company name for messages ("Anthropic didn't accept this key"). */
export function companyOf(id: BrowserProviderId): string {
  return { anthropic: "Anthropic", openai: "OpenAI", xai: "xAI", groq: "Groq", gemini: "Google", openrouter: "OpenRouter" }[id];
}
