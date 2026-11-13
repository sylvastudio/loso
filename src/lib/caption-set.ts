import type { CompositorDoc, Layer, TextLayer } from "@/lib/compositor";

// ---------- "Words on screen": captions as one set ----------
// Captions are ordinary text layers (the renderer doesn't know about them).
// A layer is a caption when it carries role "caption", or when it is a legacy
// text layer named "Caption N" (what add_captions wrote before the marker).
// Everything here is pure: each operation takes a doc and returns a new one,
// so the editor can run it through its undo history.

const LEGACY_NAME = /^Caption \d+$/;

// Not a type guard on purpose: callers branch on it without narrowing the
// "not a caption" side down to non-text layers.
export function isCaption(l: Layer): boolean {
  return l.type === "text" && (l.role === "caption" || LEGACY_NAME.test(l.name ?? ""));
}
const captionLayer = (l: Layer): l is TextLayer => isCaption(l);

/** All captions in time order (ties: lower layer first). */
export function captionsOf(doc: CompositorDoc): TextLayer[] {
  return doc.layers.filter(captionLayer).sort((a, b) => a.from - b.from || a.z - b.z);
}

export const MAX_LINE = 40;

/** Seconds as "0:04.4". */
export function clockTime(frames: number, fps: number): string {
  const t = Math.max(0, frames / fps);
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  const tenths = Math.floor(s * 10 + 1e-6) / 10;
  return `${m}:${tenths.toFixed(1).padStart(4, "0")}`;
}

/** Spoken form for screen readers: "4.4 seconds". */
export function spokenTime(frames: number, fps: number): string {
  return `${(Math.round((frames / fps) * 10) / 10).toString()} seconds`;
}

let seq = 0;
function newCaptionId(taken: Set<string>): string {
  let id: string;
  do {
    seq += 1;
    id = `cap-${Date.now().toString(36)}-${seq}`;
  } while (taken.has(id));
  taken.add(id);
  return id;
}

/** Shortest line, so a caption can always be seen and grabbed. */
export function minFrames(fps: number) {
  return Math.max(1, Math.round(fps * 0.2));
}

/**
 * Put a new set of captions back into the doc. Non-captions keep their place;
 * the captions go where the first one used to be. Every caption gets the
 * marker, and default names are renumbered in time order.
 */
function withCaptions(doc: CompositorDoc, next: TextLayer[]): CompositorDoc {
  const sorted = [...next].sort((a, b) => a.from - b.from || a.z - b.z);
  const named = sorted.map((c, i): TextLayer => {
    const name = !c.name || LEGACY_NAME.test(c.name) ? `Caption ${i + 1}` : c.name;
    return { ...c, role: "caption", name };
  });
  const at = doc.layers.findIndex(isCaption);
  const rest = doc.layers.filter((l) => !isCaption(l));
  const idx = at < 0 ? rest.length : doc.layers.slice(0, at).filter((l) => !isCaption(l)).length;
  return { ...doc, layers: [...rest.slice(0, idx), ...named, ...rest.slice(idx)] };
}

/** The look new lines copy: the nearest caption, or the add_captions default. */
export function captionTemplate(
  doc: CompositorDoc,
  near?: number,
): Omit<TextLayer, "id" | "text" | "from" | "durationInFrames"> {
  const caps = captionsOf(doc);
  const src = near === undefined ? caps[0] : ([...caps].reverse().find((c) => c.from <= near) ?? caps[0]);
  if (src) {
    const { id: _id, text: _t, from: _f, durationInFrames: _d, ...look } = src;
    void _id;
    void _t;
    void _f;
    void _d;
    return { ...look, role: "caption" };
  }
  const { width: W, height: H } = doc.output;
  const z = doc.layers.length ? Math.max(...doc.layers.map((l) => l.z)) + 1 : 0;
  return {
    type: "text",
    role: "caption",
    name: "Caption 1",
    x: Math.round(W * 0.11),
    y: Math.round(H * 0.73),
    width: Math.round(W * 0.78),
    height: 92,
    rotation: 0,
    opacity: 1,
    z,
    radius: 0,
    borderWidth: 0,
    borderColor: "#ffffff",
    anim: { preset: "fade", delay: 0, duration: 4 },
    fontFamily: "Inter",
    fontSize: 36,
    color: "#ffffff",
    fontWeight: 700,
    italic: false,
    align: "center",
    backgroundColor: "rgba(8,8,10,0.62)",
  };
}

// ---------- one line ----------

export function setLineText(doc: CompositorDoc, id: string, text: string): CompositorDoc {
  return { ...doc, layers: doc.layers.map((l) => (l.id === id && l.type === "text" ? { ...l, text } : l)) };
}

/**
 * Enter in the middle of a line: the words after the cursor become a new line,
 * and the time is shared out by how many letters each half has.
 */
export function splitLine(doc: CompositorDoc, id: string, at: number): { doc: CompositorDoc; newId: string } | null {
  const caps = captionsOf(doc);
  const c = caps.find((x) => x.id === id);
  if (!c) return null;
  const left = c.text.slice(0, at).trimEnd();
  const right = c.text.slice(at).trimStart();
  const min = minFrames(doc.output.fps);
  if (c.durationInFrames < min * 2) return null;
  const share = left.length + right.length ? left.length / (left.length + right.length) : 0.5;
  const cut = Math.min(
    c.from + c.durationInFrames - min,
    Math.max(c.from + min, c.from + Math.round(c.durationInFrames * share)),
  );
  const taken = new Set(doc.layers.map((l) => l.id));
  const newId = newCaptionId(taken);
  const first: TextLayer = { ...c, text: left, durationInFrames: cut - c.from };
  const second: TextLayer = {
    ...c,
    id: newId,
    name: undefined,
    text: right,
    from: cut,
    durationInFrames: c.from + c.durationInFrames - cut,
  };
  return {
    doc: withCaptions(
      doc,
      caps.flatMap((x) => (x.id === id ? [first, second] : [x])),
    ),
    newId,
  };
}

/** Backspace at the start of a line: join it onto the line before. */
export function mergeWithPrevious(
  doc: CompositorDoc,
  id: string,
): { doc: CompositorDoc; intoId: string; caret: number } | null {
  const caps = captionsOf(doc);
  const i = caps.findIndex((x) => x.id === id);
  if (i <= 0) return null;
  const prev = caps[i - 1];
  const cur = caps[i];
  const glue = prev.text && cur.text && !/\s$/.test(prev.text) ? " " : "";
  const merged: TextLayer = {
    ...prev,
    text: prev.text + glue + cur.text,
    durationInFrames: Math.max(prev.from + prev.durationInFrames, cur.from + cur.durationInFrames) - prev.from,
  };
  return {
    doc: withCaptions(
      doc,
      caps.filter((x) => x.id !== id).map((x) => (x.id === prev.id ? merged : x)),
    ),
    intoId: prev.id,
    caret: prev.text.length + glue.length,
  };
}

/** How far a line may go without overlapping its neighbours or leaving the video. */
export function lineBounds(doc: CompositorDoc, id: string): { lo: number; hi: number } {
  const caps = captionsOf(doc);
  const i = caps.findIndex((x) => x.id === id);
  const prev = caps[i - 1];
  const next = caps[i + 1];
  const lo = prev ? prev.from + prev.durationInFrames : 0;
  const hi = next
    ? next.from
    : Math.max(doc.output.durationInFrames, (caps[i]?.from ?? 0) + (caps[i]?.durationInFrames ?? 0));
  return { lo, hi };
}

/**
 * Set a line's start and end (frames). Clamped so it never overlaps the line
 * before or after and never gets shorter than 0.2s.
 */
export function retimeLine(doc: CompositorDoc, id: string, from: number, to: number): CompositorDoc {
  const c = doc.layers.find((l) => l.id === id);
  if (!c) return doc;
  const { lo, hi } = lineBounds(doc, id);
  const min = minFrames(doc.output.fps);
  let a = Math.round(from);
  let b = Math.round(to);
  const moving = b - a === c.durationInFrames;
  if (moving) {
    // Moving the whole line keeps its length.
    const len = Math.min(c.durationInFrames, Math.max(min, hi - lo));
    a = Math.min(Math.max(a, lo), hi - len);
    b = a + len;
  } else {
    a = Math.min(Math.max(a, lo), b - min);
    b = Math.max(Math.min(b, hi), a + min);
    a = Math.max(a, lo);
  }
  if (b - a < 1) return doc;
  if (a === c.from && b - a === c.durationInFrames) return doc;
  return {
    ...doc,
    layers: doc.layers.map((l) => (l.id === id ? ({ ...l, from: a, durationInFrames: b - a } as Layer) : l)),
  };
}

export function nudgeLine(
  doc: CompositorDoc,
  id: string,
  edge: "start" | "end" | "both",
  delta: number,
): CompositorDoc {
  const c = doc.layers.find((l) => l.id === id);
  if (!c) return doc;
  const end = c.from + c.durationInFrames;
  if (edge === "start") return retimeLine(doc, id, c.from + delta, end);
  if (edge === "end") return retimeLine(doc, id, c.from, end + delta);
  return retimeLine(doc, id, c.from + delta, end + delta);
}

/** A new line at the playhead, in the gap there. null when there's no room. */
export function addLineAt(
  doc: CompositorDoc,
  frame: number,
  text = "New words",
): { doc: CompositorDoc; newId: string } | null {
  const { fps, durationInFrames: total } = doc.output;
  const caps = captionsOf(doc);
  const min = minFrames(fps);
  let start = Math.max(0, Math.round(frame));
  const inside = caps.find((c) => start >= c.from && start < c.from + c.durationInFrames);
  if (inside) start = inside.from + inside.durationInFrames;
  const next = caps.find((c) => c.from >= start);
  const room = (next ? next.from : total) - start;
  if (room < min) return null;
  const taken = new Set(doc.layers.map((l) => l.id));
  const newId = newCaptionId(taken);
  const line: TextLayer = {
    ...captionTemplate(doc, start),
    id: newId,
    name: undefined,
    text,
    from: start,
    durationInFrames: Math.min(room, Math.round(fps * 2)),
  } as TextLayer;
  return { doc: withCaptions(doc, [...caps, line]), newId };
}

export function removeLine(doc: CompositorDoc, id: string): CompositorDoc {
  const caps = captionsOf(doc).filter((c) => c.id !== id);
  return withCaptions(doc, caps);
}

// ---------- the whole set ----------

export type CaptionLook = Partial<
  Pick<
    TextLayer,
    | "fontFamily"
    | "fontSize"
    | "color"
    | "backgroundColor"
    | "fontWeight"
    | "italic"
    | "y"
    | "x"
    | "width"
    | "height"
    | "anim"
  >
>;

export function styleAll(doc: CompositorDoc, look: CaptionLook): CompositorDoc {
  const caps = captionsOf(doc);
  if (!caps.length) return doc;
  return withCaptions(
    doc,
    caps.map((c) => ({ ...c, ...look })),
  );
}

export const POSITIONS = ["top", "middle", "bottom"] as const;
export type CaptionPosition = (typeof POSITIONS)[number];

export function positionY(doc: CompositorDoc, where: CaptionPosition, boxHeight: number): number {
  const H = doc.output.height;
  if (where === "top") return Math.round(H * 0.1);
  if (where === "middle") return Math.round((H - boxHeight) / 2);
  return Math.round(H * 0.82 - boxHeight);
}

/** Move every line earlier (negative) or later. Never before the start or past the end. */
export function shiftAll(doc: CompositorDoc, delta: number): { doc: CompositorDoc; applied: number } {
  const caps = captionsOf(doc);
  if (!caps.length || !delta) return { doc, applied: 0 };
  const lastEnd = Math.max(...caps.map((c) => c.from + c.durationInFrames));
  const room = Math.max(0, doc.output.durationInFrames - lastEnd);
  const applied = Math.min(Math.max(Math.round(delta), -caps[0].from), room);
  if (!applied) return { doc, applied: 0 };
  return {
    doc: withCaptions(
      doc,
      caps.map((c) => ({ ...c, from: c.from + applied })),
    ),
    applied,
  };
}

/** Break text into pieces of at most `max` letters, at spaces, as even as it can. */
export function chunkText(text: string, max = MAX_LINE): string[] {
  const t = text.trim().replace(/\s+/g, " ");
  if (t.length <= max) return [t];
  const words = t.split(" ");
  const k = Math.ceil(t.length / max);
  const target = Math.ceil(t.length / k);
  const out: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    const pause = /[,.:;?!”"]$/.test(cur) && cur.length >= target * 0.7;
    if (cur && (next.length > max || pause || (cur.length >= target && out.length < k - 1))) {
      out.push(cur);
      cur = w;
    } else {
      cur = next;
    }
  }
  if (cur) out.push(cur);
  return out;
}

export function longLines(doc: CompositorDoc, max = MAX_LINE): TextLayer[] {
  return captionsOf(doc).filter((c) => c.text.trim().length > max);
}

/** "Make them shorter": split every long line, sharing its time by letters. */
export function shortenAll(doc: CompositorDoc, max = MAX_LINE): { doc: CompositorDoc; split: number } {
  const caps = captionsOf(doc);
  const taken = new Set(doc.layers.map((l) => l.id));
  let split = 0;
  const out = caps.flatMap((c) => {
    const parts = chunkText(c.text, max);
    if (parts.length < 2) return [c];
    split += 1;
    const letters = parts.reduce((n, p) => n + p.length, 0);
    let at = c.from;
    return parts.map((p, i): TextLayer => {
      const end =
        i === parts.length - 1
          ? c.from + c.durationInFrames
          : at + Math.max(1, Math.round((c.durationInFrames * p.length) / letters));
      const piece: TextLayer = {
        ...c,
        id: i === 0 ? c.id : newCaptionId(taken),
        name: i === 0 ? c.name : undefined,
        text: p,
        from: at,
        durationInFrames: Math.max(1, end - at),
      };
      at = end;
      return piece;
    });
  });
  return split ? { doc: withCaptions(doc, out), split } : { doc, split: 0 };
}

/** Mark legacy "Caption N" layers with the role, without changing anything else. */
export function markCaptions(doc: CompositorDoc): CompositorDoc {
  return doc.layers.some((l) => isCaption(l) && l.role !== "caption") ? withCaptions(doc, captionsOf(doc)) : doc;
}

// ---------- .srt files ----------

function srtTime(frames: number, fps: number): string {
  const ms = Math.round((frames / fps) * 1000);
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const r = ms % 1000;
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${p(h)}:${p(m)}:${p(s)},${p(r, 3)}`;
}

export function toSrt(doc: CompositorDoc): string {
  const { fps } = doc.output;
  return (
    captionsOf(doc)
      .map((c, i) => `${i + 1}\n${srtTime(c.from, fps)} --> ${srtTime(c.from + c.durationInFrames, fps)}\n${c.text}\n`)
      .join("\n") + "\n"
  );
}

export interface Cue {
  from: number; // seconds
  to: number;
  text: string;
}

function parseClock(s: string): number | null {
  const m = s.trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:[,.](\d{1,3}))?$/);
  if (!m) return null;
  const [, h, mm, ss, ms] = m;
  return Number(h ?? 0) * 3600 + Number(mm) * 60 + Number(ss) + (ms ? Number(ms.padEnd(3, "0")) / 1000 : 0);
}

/** Reads .srt (and simple .vtt). Lines inside one cue are joined with a space. */
export function parseSrt(text: string): Cue[] {
  const blocks = text
    .replace(/\r/g, "")
    .replace(/^﻿/, "")
    .split(/\n\s*\n/);
  const cues: Cue[] = [];
  for (const b of blocks) {
    const lines = b
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    const ti = lines.findIndex((l) => l.includes("-->"));
    if (ti < 0) continue;
    const [a, z] = lines[ti].split("-->");
    const from = parseClock(a);
    const to = parseClock((z ?? "").trim().split(/\s+/)[0] ?? "");
    if (from === null || to === null || to <= from) continue;
    const words = lines
      .slice(ti + 1)
      .join(" ")
      .replace(/<[^>]+>/g, "")
      .replace(/\{\\[^}]*\}/g, "")
      .trim();
    if (words) cues.push({ from, to, text: words });
  }
  return cues.sort((x, y) => x.from - y.from);
}

/** Replace the words on screen with cues from a file, keeping the current look. */
export function replaceWithCues(doc: CompositorDoc, cues: Cue[]): CompositorDoc {
  const { fps } = doc.output;
  const look = captionTemplate(doc);
  const taken = new Set(doc.layers.filter((l) => !isCaption(l)).map((l) => l.id));
  const lines = cues.map(
    (c): TextLayer =>
      ({
        ...look,
        id: newCaptionId(taken),
        name: undefined,
        text: c.text,
        from: Math.round(c.from * fps),
        durationInFrames: Math.max(1, Math.round((c.to - c.from) * fps)),
      }) as TextLayer,
  );
  return withCaptions(doc, lines);
}
