import "server-only";
import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { DATA_DIR } from "../db";
import { transcribeFile } from "../ai/transcribe";
import type { Transcript } from "../ai/types";

// Footage is read in place from a folder on disk (4K phone clips are huge —
// never copy them). Derived files (contact sheets, frames, transcripts) are
// cached under data/work/<folder-hash>/.

const run = promisify(execFile);
const VIDEO_EXT = new Set([".mov", ".mp4", ".m4v", ".mkv", ".webm"]);

export interface Clip {
  clip: string; // basename without extension — the id tools use
  file: string;
  durationSec: number;
  width: number; // display size (rotation applied)
  height: number;
  fps: number;
  hasAudio: boolean;
}

export function resolveFolder(folder: string): string {
  const expanded = folder.startsWith("~") ? path.join(os.homedir(), folder.slice(1)) : folder;
  const abs = path.resolve(expanded);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) {
    throw new Error(`Folder not found: ${folder}`);
  }
  return abs;
}

function workDir(folderAbs: string, sub: string): string {
  const id = crypto.createHash("sha1").update(folderAbs).digest("hex").slice(0, 12);
  const dir = path.join(DATA_DIR, "work", id, sub);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function probe(file: string): Promise<Omit<Clip, "clip" | "file">> {
  const { stdout } = await run("ffprobe", [
    "-v", "error", "-print_format", "json", "-show_format", "-show_streams", file,
  ]);
  const j = JSON.parse(stdout);
  const v = j.streams.find((s: { codec_type: string }) => s.codec_type === "video");
  if (!v) throw new Error("no video stream");
  const rot = Math.abs(
    Number(
      v.side_data_list?.find((d: { rotation?: number }) => d.rotation !== undefined)?.rotation ??
        v.tags?.rotate ??
        0
    )
  );
  const swap = rot === 90 || rot === 270;
  const [n, d] = String(v.r_frame_rate ?? "30/1").split("/").map(Number);
  return {
    durationSec: Number(j.format.duration ?? v.duration ?? 0),
    width: swap ? v.height : v.width,
    height: swap ? v.width : v.height,
    fps: d ? Math.round((n / d) * 100) / 100 : 30,
    hasAudio: j.streams.some((s: { codec_type: string }) => s.codec_type === "audio"),
  };
}

const scanCache = new Map<string, { mtime: number; clips: Clip[] }>();

export async function scanFolder(folder: string): Promise<Clip[]> {
  const abs = resolveFolder(folder);
  const mtime = fs.statSync(abs).mtimeMs;
  const hit = scanCache.get(abs);
  if (hit && hit.mtime === mtime) return hit.clips;
  const files = fs
    .readdirSync(abs)
    .filter((f) => VIDEO_EXT.has(path.extname(f).toLowerCase()))
    .sort();
  const clips: Clip[] = [];
  for (const f of files) {
    const file = path.join(abs, f);
    try {
      clips.push({ clip: path.parse(f).name, file, ...(await probe(file)) });
    } catch {
      // unreadable file — skip it
    }
  }
  scanCache.set(abs, { mtime, clips });
  return clips;
}

export async function getClip(folder: string, clip: string): Promise<Clip> {
  const clips = await scanFolder(folder);
  const c = clips.find((x) => x.clip === clip || path.basename(x.file) === clip);
  if (!c) {
    throw new Error(`Clip "${clip}" not found. Available: ${clips.map((x) => x.clip).join(", ")}`);
  }
  return c;
}

/**
 * One image of evenly spaced frames, 6 columns, left→right then top→bottom.
 * The interval grows with clip length so a sheet never exceeds 36 frames.
 */
export async function contactSheet(folder: string, clip: string) {
  const c = await getClip(folder, clip);
  const interval = Math.max(2, Math.ceil(c.durationSec / 36));
  const count = Math.max(1, Math.floor(c.durationSec / interval));
  const cols = 6;
  const rows = Math.ceil(count / cols);
  const out = path.join(workDir(path.dirname(c.file), "sheets"), `${c.clip}-${interval}s.jpg`);
  if (!fs.existsSync(out)) {
    await run("ffmpeg", [
      "-v", "error", "-y", "-i", c.file,
      "-vf", `fps=1/${interval},scale=200:-2,tile=${cols}x${rows}:padding=4:color=white`,
      "-frames:v", "1", "-q:v", "4", out,
    ]);
  }
  return { file: out, intervalSec: interval, cols, rows, count, clip: c };
}

/** A single frame (display orientation) as JPEG. */
export async function frameAt(folder: string, clip: string, timeSec: number, width = 480) {
  const c = await getClip(folder, clip);
  const t = Math.max(0, Math.min(c.durationSec - 0.05, timeSec));
  const out = path.join(workDir(path.dirname(c.file), "frames"), `${c.clip}-${t.toFixed(2)}-${width}.jpg`);
  if (!fs.existsSync(out)) {
    await run("ffmpeg", [
      "-v", "error", "-y", "-ss", String(t), "-i", c.file,
      "-frames:v", "1", "-vf", `scale=${width}:-2`, "-q:v", "4", out,
    ]);
  }
  return out;
}

/** Scene-change timestamps — the text-only stand-in for a contact sheet. */
export async function sceneChanges(folder: string, clip: string): Promise<number[]> {
  const c = await getClip(folder, clip);
  const { stderr } = await run(
    "ffmpeg",
    ["-hide_banner", "-i", c.file, "-vf", "scale=320:-2,select='gt(scene,0.28)',showinfo", "-an", "-f", "null", "-"],
    { maxBuffer: 32 * 1024 * 1024 }
  );
  return [...stderr.matchAll(/pts_time:([\d.]+)/g)].map((m) => Math.round(Number(m[1]) * 100) / 100);
}

/** Word-timed transcript, cached per clip. */
export async function transcriptOf(folder: string, clip: string): Promise<Transcript> {
  const c = await getClip(folder, clip);
  if (!c.hasAudio) throw new Error(`${c.clip} has no audio track`);
  const cache = path.join(workDir(path.dirname(c.file), "tx"), `${c.clip}.json`);
  if (fs.existsSync(cache)) return JSON.parse(fs.readFileSync(cache, "utf8"));
  const t = await transcribeFile(c.file);
  fs.writeFileSync(cache, JSON.stringify(t));
  return t;
}

/** Cached transcript only — never triggers transcription. */
export function cachedTranscript(folderAbs: string, clip: string): Transcript | null {
  const cache = path.join(workDir(folderAbs, "tx"), `${clip}.json`);
  return fs.existsSync(cache) ? JSON.parse(fs.readFileSync(cache, "utf8")) : null;
}
