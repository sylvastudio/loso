const BASE = "https://api.elevenlabs.io";

export interface Voice {
  voiceId: string;
  name: string;
  category: string;
  previewUrl: string | null;
  labels: Record<string, string>;
}

export interface VoiceSettings {
  stability: number;
  similarity: number;
  style: number;
  speed: number;
}

export const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
  stability: 0.5,
  similarity: 0.75,
  style: 0.3,
  speed: 1.0,
};

class ProviderError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function readError(res: Response): Promise<string> {
  try {
    const body = await res.json();
    return body?.detail?.message ?? body?.detail ?? JSON.stringify(body).slice(0, 300);
  } catch {
    return res.statusText;
  }
}

export async function listVoices(apiKey: string): Promise<Voice[]> {
  const res = await fetch(`${BASE}/v1/voices`, { headers: { "xi-api-key": apiKey } });
  if (!res.ok) throw new ProviderError(res.status, await readError(res));
  const data = await res.json();
  return (data.voices ?? []).map(
    (v: {
      voice_id: string;
      name: string;
      category?: string;
      preview_url?: string;
      labels?: Record<string, string>;
    }) => ({
      voiceId: v.voice_id,
      name: v.name,
      category: v.category ?? "custom",
      previewUrl: v.preview_url ?? null,
      labels: v.labels ?? {},
    })
  );
}

export async function synthesize(
  apiKey: string,
  opts: { voiceId: string; text: string; modelId: string; settings: VoiceSettings }
): Promise<Buffer> {
  const res = await fetch(
    `${BASE}/v1/text-to-speech/${opts.voiceId}?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        text: opts.text,
        model_id: opts.modelId,
        // We normalize numbers/money ourselves (lib/normalize.ts) for an exact
        // billed-character count; don't let the provider re-normalize.
        apply_text_normalization: "off",
        voice_settings: {
          stability: opts.settings.stability,
          similarity_boost: opts.settings.similarity,
          style: opts.settings.style,
          speed: opts.settings.speed,
        },
      }),
    }
  );
  if (!res.ok) throw new ProviderError(res.status, await readError(res));
  return Buffer.from(await res.arrayBuffer());
}
