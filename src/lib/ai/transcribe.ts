// Word-timed transcription with three engines:
//   provider — the configured AI preset's /audio/transcriptions (OpenAI, Groq)
//   groq     — the Groq key from Settings → API Keys
//   local    — mlx_whisper (Apple Silicon) or openai-whisper on this machine
import "server-only";
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { getApiKey } from "@/lib/repo";
import { getAiConfig } from "./index";
import { getPreset } from "./presets";
import { providerFetch, trimSlash } from "./http";
import type { Transcript, TranscriptSegment, WordTiming } from "./types";

const run = promisify(execFile);

const MAX_UPLOAD = 24 * 1024 * 1024; // OpenAI/Groq cap is 25MB; keep headroom
const CHUNK_SEC = 20 * 60;

// ---------- tool discovery ----------

function extraBinDirs(): string[] {
  const dirs = ["/opt/homebrew/bin", "/usr/local/bin"];
  const pyRoot = path.join(os.homedir(), "Library", "Python");
  try {
    for (const v of fs.readdirSync(pyRoot)) dirs.push(path.join(pyRoot, v, "bin"));
  } catch {}
  dirs.push(path.join(os.homedir(), ".local", "bin"));
  return dirs;
}

/** PATH with Homebrew + user Python bins appended (dev servers often lack them). */
function childEnv(): NodeJS.ProcessEnv {
  const parts = (process.env.PATH ?? "").split(":").filter(Boolean);
  for (const d of extraBinDirs()) if (!parts.includes(d)) parts.push(d);
  return { ...process.env, PATH: parts.join(":") };
}

function which(bin: string): string | null {
  const PATH = childEnv().PATH ?? "";
  for (const dir of PATH.split(":")) {
    const p = path.join(dir, bin);
    try {
      fs.accessSync(p, fs.constants.X_OK);
      return p;
    } catch {}
  }
  return null;
}

function ffmpegBin(): string {
  const p = which("ffmpeg");
  if (!p) throw new Error("ffmpeg isn't installed — `brew install ffmpeg`, then try again.");
  return p;
}

async function probeDuration(file: string): Promise<number> {
  const ffprobe = which("ffprobe");
  if (!ffprobe) return 0;
  try {
    const { stdout } = await run(
      ffprobe,
      ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file],
      { env: childEnv() }
    );
    const d = parseFloat(stdout.trim());
    return Number.isFinite(d) ? d : 0;
  } catch {
    return 0;
  }
}

/** Mono 16 kHz audio extract (mp3 for uploads, wav for local engines). */
async function extractAudio(
  file: string,
  out: string,
  opts: { start?: number; duration?: number; bitrate?: string } = {}
) {
  const args = ["-hide_banner", "-loglevel", "error", "-y"];
  if (opts.start) args.push("-ss", String(opts.start));
  args.push("-i", file);
  if (opts.duration) args.push("-t", String(opts.duration));
  args.push("-vn", "-ac", "1", "-ar", "16000");
  if (out.endsWith(".mp3")) args.push("-c:a", "libmp3lame", "-b:a", opts.bitrate ?? "48k");
  args.push(out);
  try {
    await run(ffmpegBin(), args, { env: childEnv(), maxBuffer: 16 * 1024 * 1024, timeout: 15 * 60_000 });
  } catch (e) {
    const err = e as Error & { stderr?: string };
    const detail = (err.stderr || err.message).trim().split("\n").slice(-2).join(" ");
    throw new Error(`Couldn't extract audio from ${path.basename(file)}: ${detail}`);
  }
}

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "loso-stt-"));
}

// ---------- normalization ----------

function cleanWords(words: Array<{ word?: string; start?: number; end?: number }>, offset = 0): WordTiming[] {
  return words
    .map((w) => ({ word: (w.word ?? "").trim(), start: (w.start ?? 0) + offset, end: (w.end ?? 0) + offset }))
    .filter((w) => w.word);
}

function cleanSegments(segs: Array<{ start?: number; end?: number; text?: string }>, offset = 0): TranscriptSegment[] {
  return segs
    .map((s) => ({ start: (s.start ?? 0) + offset, end: (s.end ?? 0) + offset, text: (s.text ?? "").trim() }))
    .filter((s) => s.text);
}

function segmentsFromWords(words: WordTiming[]): TranscriptSegment[] {
  // Fallback when an engine returns words only: split on pauses / sentence ends.
  const segs: TranscriptSegment[] = [];
  let cur: WordTiming[] = [];
  const close = () => {
    if (!cur.length) return;
    segs.push({ start: cur[0].start, end: cur[cur.length - 1].end, text: cur.map((w) => w.word).join(" ") });
    cur = [];
  };
  for (const w of words) {
    const prev = cur[cur.length - 1];
    if (prev && (w.start - prev.end > 0.8 || /[.?!]$/.test(prev.word))) close();
    cur.push(w);
  }
  close();
  return segs;
}

// ---------- cloud (OpenAI-compatible /audio/transcriptions) ----------

interface CloudTarget {
  label: string;
  url: string;
  apiKey: string;
  model: string;
}

async function transcribeCloudOnce(
  target: CloudTarget,
  audioPath: string,
  language: string | undefined
): Promise<{ text: string; duration: number; words: WordTiming[]; segments: TranscriptSegment[] }> {
  const buf = fs.readFileSync(audioPath);
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(buf)], { type: "audio/mpeg" }), "audio.mp3");
  form.append("model", target.model);
  form.append("response_format", "verbose_json");
  form.append("timestamp_granularities[]", "word");
  form.append("timestamp_granularities[]", "segment");
  if (language) form.append("language", language);
  const data = (await providerFetch(
    `${target.label} transcription`,
    target.url,
    { method: "POST", headers: { Authorization: `Bearer ${target.apiKey}` }, body: form },
    10 * 60_000
  )) as {
    text?: string;
    duration?: number;
    words?: Array<{ word?: string; start?: number; end?: number }>;
    segments?: Array<{ start?: number; end?: number; text?: string }>;
  };
  const words = cleanWords(data.words ?? []);
  return {
    text: (data.text ?? "").trim(),
    duration: data.duration ?? words.at(-1)?.end ?? 0,
    words,
    segments: cleanSegments(data.segments ?? []),
  };
}

async function transcribeCloud(target: CloudTarget, file: string, language?: string): Promise<Transcript> {
  const dir = tmpDir();
  try {
    const total = await probeDuration(file);
    const whole = path.join(dir, "audio.mp3");
    await extractAudio(file, whole);
    let parts: Array<{ path: string; offset: number }> = [{ path: whole, offset: 0 }];
    if (fs.statSync(whole).size > MAX_UPLOAD) {
      if (!total) throw new Error(`${path.basename(file)} is too long to upload in one piece and ffprobe is missing`);
      parts = [];
      for (let start = 0, i = 0; start < total; start += CHUNK_SEC, i++) {
        const p = path.join(dir, `chunk${i}.mp3`);
        await extractAudio(file, p, { start, duration: CHUNK_SEC, bitrate: "32k" });
        parts.push({ path: p, offset: start });
      }
    }
    const words: WordTiming[] = [];
    const segments: TranscriptSegment[] = [];
    const texts: string[] = [];
    let duration = 0;
    for (const part of parts) {
      const r = await transcribeCloudOnce(target, part.path, language);
      words.push(...r.words.map((w) => ({ ...w, start: w.start + part.offset, end: w.end + part.offset })));
      segments.push(...r.segments.map((s) => ({ ...s, start: s.start + part.offset, end: s.end + part.offset })));
      texts.push(r.text);
      duration = part.offset + r.duration;
    }
    return {
      text: texts.join(" ").trim(),
      durationSec: total || duration,
      words,
      segments: segments.length ? segments : segmentsFromWords(words),
      engine: `${target.label} · ${target.model}`,
    };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ---------- local whisper ----------

function hfCached(repo: string): boolean {
  const dir = path.join(os.homedir(), ".cache", "huggingface", "hub", `models--${repo.replace("/", "--")}`);
  return fs.existsSync(dir);
}

function mlxModel(): string {
  if (process.env.LOSO_WHISPER_MODEL) return process.env.LOSO_WHISPER_MODEL;
  const turbo = "mlx-community/whisper-large-v3-turbo";
  if (hfCached(turbo)) return turbo;
  if (hfCached("mlx-community/whisper-small-mlx")) return "mlx-community/whisper-small-mlx";
  return turbo;
}

function whisperModel(): string {
  if (process.env.LOSO_WHISPER_MODEL) return process.env.LOSO_WHISPER_MODEL;
  const cache = path.join(os.homedir(), ".cache", "whisper");
  if (fs.existsSync(path.join(cache, "large-v3-turbo.pt"))) return "turbo";
  if (fs.existsSync(path.join(cache, "small.pt"))) return "small";
  return "turbo";
}

export function localWhisperAvailable(): "mlx_whisper" | "whisper" | null {
  if (which("mlx_whisper")) return "mlx_whisper";
  if (which("whisper")) return "whisper";
  return null;
}

async function transcribeLocal(file: string, language?: string): Promise<Transcript> {
  const engine = localWhisperAvailable();
  if (!engine) throw new Error("no local whisper");
  const dir = tmpDir();
  try {
    const wav = path.join(dir, "audio.wav");
    await extractAudio(file, wav);
    const model = engine === "mlx_whisper" ? mlxModel() : whisperModel();
    const args =
      engine === "mlx_whisper"
        ? [wav, "--model", model, "--output-format", "json", "--output-dir", dir, "--output-name", "audio",
           "--word-timestamps", "True", "--verbose", "False"]
        : [wav, "--model", model, "--output_format", "json", "--output_dir", dir,
           "--word_timestamps", "True", "--verbose", "False", "--fp16", "False"];
    if (language) args.push("--language", language);
    try {
      await run(which(engine)!, args, { env: childEnv(), maxBuffer: 64 * 1024 * 1024, timeout: 60 * 60_000 });
    } catch (e) {
      const err = e as Error & { stderr?: string };
      const detail = (err.stderr || err.message).trim().split("\n").slice(-3).join(" ");
      throw new Error(`${engine} failed: ${detail}`);
    }
    const json = path.join(dir, "audio.json");
    if (!fs.existsSync(json)) throw new Error(`${engine} produced no JSON output`);
    const data = JSON.parse(fs.readFileSync(json, "utf8")) as {
      text?: string;
      segments?: Array<{ start?: number; end?: number; text?: string; words?: Array<{ word?: string; start?: number; end?: number }> }>;
    };
    const segs = data.segments ?? [];
    const words = cleanWords(segs.flatMap((s) => s.words ?? []));
    const duration = (await probeDuration(file)) || segs.at(-1)?.end || words.at(-1)?.end || 0;
    return {
      text: (data.text ?? "").trim(),
      durationSec: duration,
      words,
      segments: cleanSegments(segs),
      engine: `${engine} · ${model}`,
    };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ---------- engine choice ----------

const NOTHING_AVAILABLE =
  "No transcription engine available. Pick one: (1) set your AI model to OpenAI or Groq in Settings → AI model " +
  "(their Whisper returns word timings), (2) save a Groq key in Settings → API Keys and choose “Groq key”, or " +
  "(3) install local Whisper — `pip install mlx-whisper` on Apple Silicon, or `pip install openai-whisper`.";

function groqTarget(apiKey: string): CloudTarget {
  const preset = getPreset("groq")!;
  return {
    label: "Groq",
    url: `${preset.baseUrl}/audio/transcriptions`,
    apiKey,
    model: preset.sttModel!,
  };
}

export type TranscriptionEngine = "provider" | "groq" | "local" | "none";

/** Which engine transcribeFile would use right now (for display). */
export function resolveTranscriptionEngine(): { engine: TranscriptionEngine; detail: string } {
  const cfg = getAiConfig();
  const groqKey = getApiKey("groq");
  const local = localWhisperAvailable();
  const localOr = (why: string) =>
    local ? { engine: "local" as const, detail: `${local} on this Mac${why}` } : groqKey
      ? { engine: "groq" as const, detail: `Groq key${why}` }
      : { engine: "none" as const, detail: "nothing available" };

  if (!cfg) return groqKey ? { engine: "groq", detail: "Groq key (no AI model set)" } : localOr("");
  if (cfg.transcription === "groq") {
    return groqKey ? { engine: "groq", detail: "Groq key" } : localOr(" (no Groq key saved)");
  }
  if (cfg.transcription === "local") return local ? { engine: "local", detail: `${local} on this Mac` } : localOr(" (local Whisper not installed)");
  const preset = getPreset(cfg.preset);
  if (preset?.sttWordTimings && cfg.apiKey) return { engine: "provider", detail: `${preset.label} · ${preset.sttModel}` };
  return localOr(` (${preset?.label ?? "provider"} has no word-timed speech-to-text)`);
}

export async function transcribeFile(filePath: string, opts: { language?: string } = {}): Promise<Transcript> {
  if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`);
  const cfg = getAiConfig();
  const { engine } = resolveTranscriptionEngine();

  if (engine === "provider" && cfg) {
    const preset = getPreset(cfg.preset)!;
    return transcribeCloud(
      {
        label: preset.label,
        url: `${trimSlash(cfg.baseUrl || preset.baseUrl)}/audio/transcriptions`,
        apiKey: cfg.apiKey!,
        model: preset.sttModel!,
      },
      filePath,
      opts.language
    );
  }
  if (engine === "groq") return transcribeCloud(groqTarget(getApiKey("groq")!), filePath, opts.language);
  if (engine === "local") return transcribeLocal(filePath, opts.language);
  throw new Error(NOTHING_AVAILABLE);
}
