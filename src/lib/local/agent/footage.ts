// The in-browser agent's eyes and ears on the project folder: clip facts,
// contact sheets and single frames (decoded with Mediabunny/WebCodecs), and
// transcripts with word timings (in-browser Whisper), cached per file.
// Everything works on File objects from the folder handle — never on paths
// outside the folder.

import { ALL_FORMATS, BlobSource, CanvasSink, Input } from "mediabunny";
import { fileAt, listMedia, type MediaKind } from "../folder";
import { idbGet, idbPut } from "../db";
import { transcribeLocal, type LocalWord } from "../transcribe";

export interface ClipInfo {
  clip: string; // path inside the folder — also the assetHash for layers
  kind: MediaKind;
  durationSec?: number;
  size?: string;
  hasAudio?: boolean;
}

async function withInput<T>(file: Blob, fn: (input: Input) => Promise<T>): Promise<T> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    return await fn(input);
  } finally {
    input.dispose();
  }
}

export async function scanFolder(dir: FileSystemDirectoryHandle): Promise<ClipInfo[]> {
  const entries = await listMedia(dir);
  const out: ClipInfo[] = [];
  for (const e of entries) {
    const info: ClipInfo = { clip: e.path, kind: e.kind };
    if (e.kind !== "image") {
      try {
        const file = await e.handle.getFile();
        await withInput(file, async (input) => {
          info.durationSec = Math.round((await input.computeDuration()) * 10) / 10;
          const v = await input.getPrimaryVideoTrack();
          if (v) info.size = `${v.displayWidth}×${v.displayHeight}`;
          info.hasAudio = !!(await input.getPrimaryAudioTrack());
        });
      } catch {
        /* unreadable clip: list it without facts */
      }
    }
    out.push(info);
  }
  return out;
}

async function clipFile(dir: FileSystemDirectoryHandle, clip: string): Promise<File> {
  try {
    return await (await fileAt(dir, clip)).getFile();
  } catch {
    throw new Error(`No file "${clip}" in the project folder — use a path from footage_scan.`);
  }
}

async function toJpegBase64(canvas: OffscreenCanvas, quality = 0.8): Promise<string> {
  const blob = await canvas.convertToBlob({ type: "image/jpeg", quality });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** Evenly spaced frames, 6 per row, as one JPEG. */
export async function contactSheet(dir: FileSystemDirectoryHandle, clip: string) {
  const file = await clipFile(dir, clip);
  return withInput(file, async (input) => {
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new Error(`${clip} has no picture.`);
    const dur = await input.computeDuration();
    const count = Math.max(6, Math.min(36, Math.round(dur / 2)));
    const interval = dur / count;
    const cols = 6;
    const w = 240;
    const h = Math.round((w * track.displayHeight) / Math.max(1, track.displayWidth));
    const sink = new CanvasSink(track, { width: w, height: h, fit: "contain" });
    const times = Array.from({ length: count }, (_, k) => Math.min(dur - 0.05, k * interval + 0.01));
    const rows = Math.ceil(count / cols);
    const sheet = new OffscreenCanvas(cols * w, rows * h);
    const ctx = sheet.getContext("2d")!;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, sheet.width, sheet.height);
    let k = 0;
    for await (const frame of sink.canvasesAtTimestamps(times)) {
      if (frame) ctx.drawImage(frame.canvas as CanvasImageSource, (k % cols) * w, Math.floor(k / cols) * h, w, h);
      k++;
    }
    return { data: await toJpegBase64(sheet, 0.72), count, intervalSec: Math.round(interval * 100) / 100 };
  });
}

export async function frameAt(dir: FileSystemDirectoryHandle, clip: string, timeSec: number) {
  const file = await clipFile(dir, clip);
  return withInput(file, async (input) => {
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new Error(`${clip} has no picture.`);
    const frame = await new CanvasSink(track, { width: 960 }).getCanvas(Math.max(0, timeSec));
    if (!frame) throw new Error(`No frame at ${timeSec}s in ${clip}.`);
    const c = new OffscreenCanvas(frame.canvas.width, frame.canvas.height);
    c.getContext("2d")!.drawImage(frame.canvas as CanvasImageSource, 0, 0);
    return toJpegBase64(c);
  });
}

// ---------- transcripts ----------

export interface Sentence {
  start: number;
  end: number;
  text: string;
}

export interface ClipTranscript {
  words: LocalWord[];
  sentences: Sentence[];
  fromSec: number;
  toSec: number;
}

/** Group words into sentences: end punctuation, a long pause, or ~20 words. */
export function sentencesOf(words: LocalWord[]): Sentence[] {
  const out: Sentence[] = [];
  let cur: LocalWord[] = [];
  const flush = () => {
    if (!cur.length) return;
    out.push({ start: cur[0].start, end: cur[cur.length - 1].end, text: cur.map((w) => w.word).join(" ").replace(/\s+([,.!?;:])/g, "$1") });
    cur = [];
  };
  words.forEach((w, i) => {
    const prev = words[i - 1];
    if (prev && cur.length && w.start - prev.end > 0.8) flush();
    cur.push(w);
    if (/[.!?]["”’]?$/.test(w.word) || cur.length >= 20) flush();
  });
  flush();
  return out;
}

/** Longest stretch transcribed in one go (decoded audio is held in memory). */
export const MAX_TRANSCRIBE_SEC = 600;

export async function transcriptOf(
  dir: FileSystemDirectoryHandle,
  clip: string,
  opts: { fromSec?: number; toSec?: number; onStatus?: (s: string) => void } = {}
): Promise<ClipTranscript> {
  const file = await clipFile(dir, clip);
  const fromSec = Math.max(0, opts.fromSec ?? 0);
  const toSec = Math.max(fromSec + 1, Math.min(opts.toSec ?? fromSec + MAX_TRANSCRIBE_SEC, fromSec + MAX_TRANSCRIBE_SEC));
  const key = `${clip}|${file.size}|${file.lastModified}|${Math.round(fromSec)}-${Math.round(toSec)}`;
  const cached = await idbGet<ClipTranscript>("transcripts", key).catch(() => undefined);
  if (cached) return cached;
  const t = await transcribeLocal(file, { startSec: fromSec, maxSec: toSec - fromSec, onStatus: opts.onStatus });
  const words = t.words.map((w) => ({ ...w, start: w.start + fromSec, end: w.end + fromSec }));
  const out: ClipTranscript = { words, sentences: sentencesOf(words), fromSec, toSec: fromSec + t.audioSec };
  await idbPut("transcripts", key, out).catch(() => {});
  return out;
}
