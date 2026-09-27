import "server-only";
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { storeAsset } from "../assets";
import { cachedTranscript, getClip, resolveFolder } from "./footage";

// Cut an edit from raw footage: a sequence of picture shots over a sequence of
// sound pieces (usually the speaker's words), joined with short dissolves,
// cropped to a target window, voice cleaned + loudness-normalized. Produces
// Loso assets, so the result drops straight into a Compositor layer.

const run = promisify(execFile);

export interface AudioPiece {
  clip: string;
  from: number;
  to: number;
}
export interface Shot {
  clip: string;
  start: number;
  dur: number;
  /** vertical crop centre 0 (top) … 1 (bottom); default 0.45 */
  focus?: number;
}
export interface CutInput {
  folder: string;
  audio: AudioPiece[];
  shots: Shot[];
  window: { width: number; height: number };
  durationSec: number;
  crossfade?: number;
  fps?: number;
  /** Also make a blurred, darkened full-frame copy for behind a card. */
  background?: { width: number; height: number } | null;
  /** Snap audio cut points to word boundaries (needs a cached transcript). */
  snapToWords?: boolean;
}
export interface CutResult {
  editHash: string;
  bgHash: string | null;
  durationSec: number;
  audio: AudioPiece[]; // after snapping
  notes: string[];
}

const AUDIO_XF = 0.08;

function snap(folderAbs: string, p: AudioPiece, notes: string[]): AudioPiece {
  const tx = cachedTranscript(folderAbs, p.clip);
  if (!tx?.words?.length) return p;
  const starts = tx.words.map((w) => w.start);
  const ends = tx.words.map((w) => w.end);
  const near = (arr: number[], t: number) =>
    arr.reduce((best, x) => (Math.abs(x - t) < Math.abs(best - t) ? x : best), arr[0]);
  const s = near(starts, p.from);
  const e = near(ends, p.to);
  const out = {
    clip: p.clip,
    from: Math.abs(s - p.from) <= 0.6 ? Math.max(0, s - 0.08) : p.from,
    to: Math.abs(e - p.to) <= 0.6 ? e + 0.12 : p.to,
  };
  if (out.to <= out.from) return p;
  if (Math.abs(out.from - p.from) > 0.02 || Math.abs(out.to - p.to) > 0.02) {
    notes.push(
      `snapped ${p.clip} ${p.from.toFixed(2)}–${p.to.toFixed(2)} → ${out.from.toFixed(2)}–${out.to.toFixed(2)} (word boundaries)`
    );
  }
  return out;
}

export async function cutSequence(input: CutInput): Promise<CutResult> {
  const folderAbs = resolveFolder(input.folder);
  const fps = input.fps ?? 30;
  const xf = input.crossfade ?? 0.2;
  const total = input.durationSec;
  const { width: ww, height: wh } = input.window;
  const notes: string[] = [];
  if (!input.shots.length) throw new Error("No shots given");
  if (ww % 2 || wh % 2) throw new Error("window width/height must be even numbers");

  const audio = input.snapToWords === false ? input.audio : input.audio.map((a) => snap(folderAbs, a, notes));
  const shotSum = input.shots.reduce((s, x) => s + x.dur, 0);
  const audioSum = audio.reduce((s, a) => s + (a.to - a.from), 0) - AUDIO_XF * Math.max(0, audio.length - 1);
  if (shotSum < total - 0.05) notes.push(`shots cover ${shotSum.toFixed(2)}s of ${total}s — the end will hold black`);
  if (audio.length && audioSum < total - 0.5) notes.push(`audio covers ${audioSum.toFixed(2)}s of ${total}s — the end will be silent`);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "loso-cut-"));
  try {
    // --- picture: each shot scaled to cover the window, cropped around `focus`
    for (const [i, s] of input.shots.entries()) {
      const c = await getClip(input.folder, s.clip);
      if (s.start + s.dur > c.durationSec + 0.05) {
        notes.push(`${s.clip} is only ${c.durationSec.toFixed(1)}s — shot ${i + 1} runs past its end`);
      }
      const focus = Math.min(1, Math.max(0, s.focus ?? 0.45));
      await run("ffmpeg", [
        "-v", "error", "-y", "-ss", String(s.start), "-t", String(s.dur + xf), "-i", c.file, "-an",
        "-vf",
        `scale=${ww}:${wh}:force_original_aspect_ratio=increase,` +
          `crop=${ww}:${wh}:(iw-${ww})/2:'min(max(0,ih*${focus}-${wh}/2),ih-${wh})',` +
          `fps=${fps},setsar=1,eq=contrast=1.04:saturation=1.06,format=yuv420p`,
        "-c:v", "libx264", "-crf", "17", "-preset", "medium", path.join(tmp, `v${i}.mp4`),
      ]);
    }
    // --- sound
    for (const [i, a] of audio.entries()) {
      const c = await getClip(input.folder, a.clip);
      await run("ffmpeg", [
        "-v", "error", "-y", "-ss", String(a.from), "-to", String(a.to), "-i", c.file,
        "-map", "0:a:0", "-ac", "2", "-ar", "48000", path.join(tmp, `a${i}.wav`),
      ]);
    }

    const n = input.shots.length;
    const m = audio.length;
    const fc: string[] = [];
    let prev = "[0:v]";
    let off = 0;
    for (let k = 0; k < n - 1; k++) {
      off += input.shots[k].dur;
      const out = k < n - 2 ? `[x${k}]` : "[vx]";
      fc.push(`${prev}[${k + 1}:v]xfade=transition=fade:duration=${xf}:offset=${off.toFixed(3)}${out}`);
      prev = out;
    }
    if (n === 1) fc.push("[0:v]null[vx]");
    fc.push(
      `[vx]tpad=stop_mode=clone:stop_duration=${total},trim=0:${total},setpts=PTS-STARTPTS,` +
        `fade=t=in:st=0:d=0.3,fade=t=out:st=${Math.max(0, total - 0.6)}:d=0.6[v]`
    );
    if (m > 0) {
      let ap = `[${n}:a]`;
      for (let k = 1; k < m; k++) {
        fc.push(`${ap}[${n + k}:a]acrossfade=d=${AUDIO_XF}[ac${k}]`);
        ap = `[ac${k}]`;
      }
      fc.push(
        `${ap}highpass=f=80,afftdn=nr=10:nf=-40,acompressor=threshold=-20dB:ratio=3:attack=5:release=120,` +
          `loudnorm=I=-14:TP=-1.5:LRA=9,apad=whole_dur=${total},atrim=0:${total},asetpts=PTS-STARTPTS,` +
          `afade=t=in:st=0:d=0.15,afade=t=out:st=${Math.max(0, total - 0.7)}:d=0.7[a]`
      );
    }
    const inputs: string[] = [];
    for (let i = 0; i < n; i++) inputs.push("-i", path.join(tmp, `v${i}.mp4`));
    for (let i = 0; i < m; i++) inputs.push("-i", path.join(tmp, `a${i}.wav`));
    const edit = path.join(tmp, "edit.mp4");
    await run(
      "ffmpeg",
      [
        "-v", "error", "-y", ...inputs, "-filter_complex", fc.join(";"),
        "-map", "[v]", ...(m > 0 ? ["-map", "[a]", "-c:a", "aac", "-b:a", "192k"] : []),
        "-c:v", "libx264", "-crf", "16", "-preset", "slow", "-pix_fmt", "yuv420p",
        "-movflags", "+faststart", edit,
      ],
      { maxBuffer: 16 * 1024 * 1024 }
    );
    const editHash = storeAsset(fs.readFileSync(edit), "video/mp4", "edit.mp4", "studio-cut").hash;

    let bgHash: string | null = null;
    if (input.background) {
      const { width: bw, height: bh } = input.background;
      const bg = path.join(tmp, "bg.mp4");
      await run("ffmpeg", [
        "-v", "error", "-y", "-i", edit, "-an",
        "-vf",
        `scale=${bw}:${bh}:force_original_aspect_ratio=increase,crop=${bw}:${bh},` +
          "boxblur=28:2,eq=brightness=-0.22:saturation=0.75,format=yuv420p",
        "-c:v", "libx264", "-crf", "24", "-movflags", "+faststart", bg,
      ]);
      bgHash = storeAsset(fs.readFileSync(bg), "video/mp4", "edit-bg.mp4", "studio-cut").hash;
    }
    return { editHash, bgHash, durationSec: total, audio, notes };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
