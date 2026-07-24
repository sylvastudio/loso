export type ProviderId = "elevenlabs" | "groq" | "anthropic" | "pexels" | "serpapi";

export interface ProviderInfo {
  id: ProviderId;
  label: string;
  role: string;
  unlocks: string;
  degraded: string;
  placeholder: string;
  docsUrl: string;
  optional: boolean;
}

export const PROVIDERS: ProviderInfo[] = [
  {
    id: "elevenlabs",
    label: "ElevenLabs",
    role: "Voiceover (TTS)",
    unlocks: "Script → expressive voiceover audio",
    degraded: "Voice generation disabled — projects can be drafted but not voiced.",
    placeholder: "sk_…",
    docsUrl: "https://elevenlabs.io/app/settings/api-keys",
    optional: false,
  },
  {
    id: "groq",
    label: "Groq",
    role: "Transcription (Whisper) + LLM fallback",
    unlocks: "Word-level timestamps that drive captions and shot timing",
    degraded: "No word-synced captions — the pipeline stops after voiceover.",
    placeholder: "gsk_…",
    docsUrl: "https://console.groq.com/keys",
    optional: false,
  },
  {
    id: "anthropic",
    label: "Anthropic",
    role: "Shot-list LLM (primary)",
    unlocks: "AI shot list: script → concrete, varied visual beats",
    degraded: "Falls back to a rule-based shot list — visuals will be more literal.",
    placeholder: "sk-ant-…",
    docsUrl: "https://console.anthropic.com/settings/keys",
    optional: false,
  },
  {
    id: "pexels",
    label: "Pexels",
    role: "Stock photography",
    unlocks: "Auto-sourced editorial images for every shot",
    degraded: "Shots start empty — images must be uploaded manually.",
    placeholder: "563492ad…",
    docsUrl: "https://www.pexels.com/api/",
    optional: false,
  },
  {
    id: "serpapi",
    label: "SerpApi",
    role: "Image-search fallback",
    unlocks: "Named people, logos, and places via Google Images",
    degraded: "Named-subject shots fall back to generic stock results.",
    placeholder: "64-char hex…",
    docsUrl: "https://serpapi.com/manage-api-key",
    optional: true,
  },
];

export function maskKey(key: string): string {
  if (key.length <= 8) return "••••••••";
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
}
