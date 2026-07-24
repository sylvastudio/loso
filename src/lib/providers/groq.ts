import type { Word } from "@/lib/captions";

const ENDPOINT = "https://api.groq.com/openai/v1/audio/transcriptions";

export interface Transcription {
  text: string;
  durationSec: number;
  words: Word[];
}

export async function transcribe(
  apiKey: string,
  audio: Buffer,
  filename: string
): Promise<Transcription> {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(audio)], { type: "audio/mpeg" }), filename);
  form.append("model", "whisper-large-v3-turbo");
  form.append("response_format", "verbose_json");
  form.append("timestamp_granularities[]", "word");
  form.append("timestamp_granularities[]", "segment");

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body?.error?.message ?? JSON.stringify(body).slice(0, 300);
    } catch {}
    throw new Error(`Groq transcription failed (${res.status}): ${detail}`);
  }
  const data = await res.json();
  const words: Word[] = (data.words ?? []).map(
    (w: { word: string; start: number; end: number }) => ({
      word: w.word.trim(),
      start: w.start,
      end: w.end,
    })
  );
  return { text: data.text ?? "", durationSec: data.duration ?? (words.at(-1)?.end ?? 0), words };
}
