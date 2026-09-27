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
  /** false = the pipeline stage that uses this key hasn't shipped yet. */
  live: boolean;
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
    live: true,
  },
  {
    id: "groq",
    label: "Groq",
    role: "Transcription (Whisper) + LLM fallback",
    unlocks: "Word-level timestamps that drive word-synced captions",
    degraded: "No word-synced captions — the pipeline stops after voiceover.",
    placeholder: "gsk_…",
    docsUrl: "https://console.groq.com/keys",
    optional: false,
    live: true,
  },
  {
    id: "anthropic",
    label: "Anthropic",
    role: "Shot-list LLM (primary)",
    unlocks: "AI shot list: script → concrete, varied visual beats (coming soon)",
    degraded: "Not used yet — the AI shot list ships in a coming update. Save a key now and it will be ready.",
    placeholder: "sk-ant-…",
    docsUrl: "https://console.anthropic.com/settings/keys",
    optional: false,
    live: false,
  },
  {
    id: "pexels",
    label: "Pexels",
    role: "Stock photography",
    unlocks: "Auto-sourced stock images for each shot (coming soon)",
    degraded: "Not used yet — stock visuals ship in a coming update. Save a key now and it will be ready.",
    placeholder: "563492ad…",
    docsUrl: "https://www.pexels.com/api/",
    optional: false,
    live: false,
  },
  {
    id: "serpapi",
    label: "SerpApi",
    role: "Image-search fallback",
    unlocks: "Named people, logos, and places via Google Images",
    degraded: "Not used yet — image-search fallback ships with stock visuals.",
    placeholder: "64-char hex…",
    docsUrl: "https://serpapi.com/manage-api-key",
    optional: true,
    live: false,
  },
];

export function maskKey(key: string): string {
  if (key.length <= 8) return "••••••••";
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
}

/** Keys the working pipeline actually needs today. */
export const LIVE_REQUIRED = PROVIDERS.filter((p) => p.live && !p.optional);
