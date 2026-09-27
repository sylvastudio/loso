import "server-only";
import { compositorDocSchema, type CompositorDoc, type Layer } from "../compositor";
import { getTemplate, listTemplates, saveTemplate, type Template } from "./store";

// ---------- built-in: the poster card (from the Sunday Galore session) ----------

const POSTER_ID = "builtin-poster-card";

function posterDoc(): CompositorDoc {
  const N = 900;
  const base = (id: string, name: string, x: number, y: number, w: number, h: number, z: number, slot?: string) => ({
    id, name, slot, x, y, width: w, height: h, rotation: 0, opacity: 1, z, from: 0,
    durationInFrames: N, radius: 0, borderWidth: 0, borderColor: "#ffffff",
  });
  const text = (
    id: string, name: string, t: string, x: number, y: number, w: number, h: number, z: number,
    size: number, align: "left" | "center" | "right", slot?: string,
    anim?: { preset: "fade" | "rise"; delay: number; duration: number }, bg: string | null = null
  ) => ({
    ...base(id, name, x, y, w, h, z, slot), type: "text" as const, text: t, fontFamily: "Inter",
    fontSize: size, color: "#0b0b0c", fontWeight: 700, italic: false, align, backgroundColor: bg, anim,
  });
  const layers = [
    { ...base("bg", "Background (blurred)", 0, 0, 1080, 1920, 0, "background"), type: "video", assetHash: "PLACEHOLDER",
      trimStart: 0, trimEnd: null, volume: 0, objectFit: "cover" },
    text("card", "Poster card", "", 84, 300, 912, 1300, 1, 10, "left", undefined, { preset: "rise", delay: 0, duration: 18 }, "#f3f2ee"),
    text("tl", "Label · left", "PROJECT NAME", 120, 326, 440, 44, 2, 22, "left", "label_left", { preset: "fade", delay: 8, duration: 16 }),
    text("tr", "Label · right", "ORGANISATION", 520, 326, 440, 44, 2, 22, "right", "label_right", { preset: "fade", delay: 8, duration: 16 }),
    text("date", "Date", "27 — SEPTEMBER", 210, 438, 660, 62, 2, 50, "left", "date", { preset: "rise", delay: 10, duration: 16 }),
    text("title", "Title", "SUNDAY", 90, 492, 900, 232, 2, 200, "center", "title", { preset: "rise", delay: 12, duration: 20 }),
    { ...base("main", "Main video", 105, 700, 870, 820, 3, "video"), type: "video", assetHash: "PLACEHOLDER",
      trimStart: 0, trimEnd: null, volume: 1, objectFit: "cover", anim: { preset: "fade", delay: 6, duration: 14 } },
    text("badges", "Badge row", "(LOGO)     ▮▮▮▮▮ DVI HD     2026     STEREO     ™", 105, 1536, 870, 48, 2, 21, "center", "badges", { preset: "fade", delay: 14, duration: 16 }),
  ];
  return compositorDocSchema.parse({
    output: { width: 1080, height: 1920, fps: 30, durationInFrames: N, background: "#0a0a0b" },
    layers,
  });
}

export function ensureBuiltinTemplates() {
  if (!getTemplate(POSTER_ID)) {
    saveTemplate({
      id: POSTER_ID,
      name: "Poster card",
      description:
        "White poster card over a blurred copy of the footage: two corner labels, a date line, a huge one-word title, " +
        "an 870×820 video window (captions go inside its lower edge, y≈1404) and a badge row. 1080×1920, 30s. " +
        "Slots: label_left, label_right, date, title, badges (text); video (main edit, 870×820); background (blurred copy, 1080×1920).",
      doc: posterDoc(),
      builtin: true,
    });
  }
}

export function allTemplates(): Template[] {
  ensureBuiltinTemplates();
  return listTemplates();
}

/**
 * Fill a template's slots and return a new doc. Text slots take strings;
 * media slots take asset hashes. Unfilled media slots are removed so the doc
 * never references a missing asset; unfilled text slots keep their example.
 * `durationSec` stretches every full-length layer to the new length.
 */
export function applyTemplate(
  t: Template,
  fills: Record<string, string>,
  opts: { durationSec?: number } = {}
): CompositorDoc {
  const doc = structuredClone(t.doc);
  const oldN = doc.output.durationInFrames;
  const newN = opts.durationSec ? Math.round(opts.durationSec * doc.output.fps) : oldN;
  doc.output.durationInFrames = newN;
  const layers: Layer[] = [];
  for (const l of doc.layers) {
    const fill = l.slot ? fills[l.slot] : undefined;
    const isMedia = l.type !== "text";
    if (isMedia && l.assetHash === "PLACEHOLDER" && !fill) continue;
    let next: Layer = l;
    if (fill !== undefined) {
      next = l.type === "text" ? fitText({ ...l, text: fill }, l.fontSize) : { ...l, assetHash: fill };
    }
    if (next.from === 0 && next.durationInFrames === oldN) next = { ...next, durationInFrames: newN };
    layers.push(next);
  }
  doc.layers = layers;
  return doc;
}

// Approximate advance widths (em) for Inter 700 capitals/digits — calibrated
// so "SUNDAY" ≈ 4.3em (measured 4.23em in the real font). Lowercase and other
// characters use averages. Slightly generous on purpose: better a touch small
// than a title that wraps.
const CAP_EM: Record<string, number> = {
  A: 0.73, B: 0.7, C: 0.74, D: 0.76, E: 0.62, F: 0.6, G: 0.77, H: 0.77, I: 0.3, J: 0.56, K: 0.72,
  L: 0.58, M: 0.92, N: 0.77, O: 0.79, P: 0.67, Q: 0.79, R: 0.69, S: 0.66, T: 0.66, U: 0.75, V: 0.71,
  W: 1.0, X: 0.7, Y: 0.68, Z: 0.65, " ": 0.26, "—": 0.9, "-": 0.4, ".": 0.28, ",": 0.28, "’": 0.25, "'": 0.25,
};
function estimateWidth(text: string, fontSize: number): number {
  const longest = text.split("\n").reduce((a, b) => (b.length > a.length ? b : a), "");
  let em = 0;
  for (const ch of longest) em += CAP_EM[ch] ?? (/[0-9]/.test(ch) ? 0.64 : /[a-z]/.test(ch) ? 0.56 : 0.62);
  return em * fontSize;
}

/** Shrink a text layer's font until its longest line fits the box width (never grows past `maxSize`). */
function fitText<T extends Extract<Layer, { type: "text" }>>(l: T, maxSize: number): T {
  const lines = l.text.split("\n").length;
  const singleLineBox = l.height < maxSize * 1.15 * (lines + 1);
  if (!singleLineBox) return l; // a paragraph box — let it wrap
  const w = estimateWidth(l.text, maxSize);
  const room = l.width * 0.96;
  if (w <= room) return { ...l, fontSize: maxSize };
  return { ...l, fontSize: Math.max(8, Math.floor((maxSize * room) / w)) };
}

/** Save a composition as a template. `slots` maps layerId → slot name (merged with slots already set). */
export function templateFromDoc(
  doc: CompositorDoc,
  input: { name: string; description?: string; slots?: Record<string, string>; id?: string }
): Template {
  const copy = structuredClone(doc);
  copy.layers = copy.layers.map((l) =>
    input.slots && input.slots[l.id] ? { ...l, slot: input.slots[l.id] } : l
  );
  return saveTemplate({ id: input.id, name: input.name, description: input.description, doc: copy });
}
