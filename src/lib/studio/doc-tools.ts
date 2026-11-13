// The studio agent's composition tools as pure functions (doc in → doc out),
// shared by the server toolbox (tools.ts: SQLite projects, MCP) and the
// in-browser agent (lib/local/agent). Client-safe: no node imports.

import { compositorDocSchema, layerSchema, type CompositorDoc, type Layer } from "../compositor";
import { isCaption } from "../caption-set";
import { FONT_CHOICES } from "../fonts";
import type { ToolInfo } from "./contract";

// ---------- helpers ----------

export const num = (v: unknown, d?: number) => (typeof v === "number" && Number.isFinite(v) ? v : Number(v ?? d));
export const str = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));

export function newId(type: string, taken: Set<string>) {
  let id = "";
  do id = `${type}-${Math.random().toString(36).slice(2, 7)}`;
  while (taken.has(id));
  return id;
}

/** Fill sensible defaults so a model only has to say what matters. */
export function completeLayer(raw: Record<string, unknown>, doc: CompositorDoc, taken: Set<string>): Layer {
  const type = str(raw.type) as Layer["type"];
  if (!["video", "image", "audio", "text"].includes(type)) {
    throw new Error(`layer.type must be video | image | audio | text (got "${raw.type}")`);
  }
  const { width: W, height: H, durationInFrames: N, fps } = doc.output;
  const fromSec = raw.fromSec !== undefined ? num(raw.fromSec) : undefined;
  const durSec = raw.durationSec !== undefined ? num(raw.durationSec) : undefined;
  const candidate: Record<string, unknown> = {
    x: 0, y: 0, width: W, height: H, rotation: 0, opacity: 1,
    z: doc.layers.length ? Math.max(...doc.layers.map((l) => l.z)) + 1 : 0,
    from: fromSec !== undefined ? Math.round(fromSec * fps) : 0,
    durationInFrames: durSec !== undefined ? Math.round(durSec * fps) : N,
    radius: 0, borderWidth: 0, borderColor: "#ffffff",
    ...(type === "text"
      ? { text: "Text", fontFamily: "Inter", fontSize: Math.round(W * 0.06), color: "#ffffff", fontWeight: 700,
          italic: false, align: "center", backgroundColor: null, height: Math.round(H * 0.1) }
      : {}),
    ...(type === "video" || type === "audio" ? { trimStart: 0, trimEnd: null, volume: 1 } : {}),
    ...(type === "video" || type === "image" ? { objectFit: "cover" } : {}),
    ...raw,
    id: typeof raw.id === "string" && raw.id && !taken.has(raw.id) ? raw.id : newId(type, taken),
  };
  delete candidate.fromSec;
  delete candidate.durationSec;
  if (typeof candidate.trimStartSec === "number") {
    candidate.trimStart = Math.round((candidate.trimStartSec as number) * fps);
    delete candidate.trimStartSec;
  }
  const parsed = layerSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new Error(
      `invalid ${type} layer: ` + parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
    );
  }
  taken.add(parsed.data.id);
  return parsed.data;
}

/** Compact, model-friendly view of the composition (seconds, not frames). */
export function describeDoc(doc: CompositorDoc): string {
  const { width, height, fps, durationInFrames, background } = doc.output;
  const s = (f: number) => Math.round((f / fps) * 100) / 100;
  const layers = [...doc.layers]
    .sort((a, b) => a.z - b.z)
    .map((l) => {
      const o: Record<string, unknown> = {
        id: l.id, type: l.type, ...(l.name ? { name: l.name } : {}), ...(l.slot ? { slot: l.slot } : {}),
        ...(isCaption(l) ? { role: "caption" } : {}),
        x: l.x, y: l.y, width: l.width, height: l.height, z: l.z,
        fromSec: s(l.from), durationSec: s(l.durationInFrames),
      };
      if (l.opacity !== 1) o.opacity = l.opacity;
      if (l.rotation) o.rotation = l.rotation;
      if (l.radius) o.radius = l.radius;
      if (l.anim && l.anim.preset !== "none") o.anim = l.anim;
      if (l.type === "text") Object.assign(o, { text: l.text, fontFamily: l.fontFamily, fontSize: l.fontSize,
        fontWeight: l.fontWeight, color: l.color, align: l.align, backgroundColor: l.backgroundColor });
      else o.assetHash = l.assetHash;
      if (l.type === "video" || l.type === "audio") {
        o.volume = l.volume;
        if (l.trimStart) o.trimStartSec = s(l.trimStart);
      }
      return o;
    });
  return JSON.stringify({ output: { width, height, fps, durationSec: s(durationInFrames), background }, layers });
}

// ---------- schemas (JSON Schema subset every provider accepts) ----------

export const S = {
  str: (description: string) => ({ type: "string", description }),
  num: (description: string) => ({ type: "number", description }),
  obj: (properties: Record<string, unknown>, required: string[] = [], description?: string) => ({
    type: "object", properties, required, ...(description ? { description } : {}),
  }),
  arr: (items: unknown, description?: string) => ({ type: "array", items, ...(description ? { description } : {}) }),
};

// Compact on purpose: this schema is sent with every agent step, and small
// providers (e.g. Groq's free tier, ~8k tokens/min) can't afford verbose schemas.
export const N = { type: "number" };
export const T = { type: "string" };
const LAYER_FIELDS = S.obj(
  {
    type: { type: "string", enum: ["video", "image", "audio", "text"] },
    id: T, name: T, slot: T,
    x: N, y: N, width: N, height: N, z: N, fromSec: N, durationSec: N,
    opacity: N, rotation: N, radius: N, borderWidth: N, borderColor: T,
    assetHash: T, objectFit: { type: "string", enum: ["cover", "contain"] }, volume: N, trimStartSec: N,
    text: T, fontFamily: { type: "string", enum: [...FONT_CHOICES] }, fontSize: N,
    fontWeight: { type: "number", enum: [400, 700] }, color: T, italic: { type: "boolean" },
    align: { type: "string", enum: ["left", "center", "right"] }, backgroundColor: T,
    anim: S.obj({ preset: { type: "string", enum: ["none", "fade", "rise", "scale", "hero"] }, delay: N, duration: N }, ["preset"]),
  },
  ["type"]
);
const LAYER_HELP =
  "Fields: px geometry (x,y,width,height; origin top-left), z (higher on top), fromSec/durationSec, " +
  "opacity 0–1, colors as #hex or rgba(), assetHash for media, anim delay/duration in frames.";

// ---------- composition tools ----------

export interface DocToolSpec extends ToolInfo {
  /** Pure: the doc to change → a message, plus the new doc when it changed. */
  apply(doc: CompositorDoc, args: Record<string, unknown>): { text: string; doc?: CompositorDoc };
}

/** Validate a doc a tool produced (defaults filled, bad shapes rejected). */
export const cleanDoc = (doc: CompositorDoc) => compositorDocSchema.parse(doc);

export const DOC_TOOLS: DocToolSpec[] = [
  {
    name: "get_composition",
    description:
      "Read the current composition: output size/fps/duration and every layer (times in seconds). Call this before editing.",
    parameters: S.obj({}),
    needsProject: true,
    apply: (doc) => ({ text: describeDoc(doc) }),
  },
  {
    name: "set_output",
    description: "Set canvas size, fps, total duration (seconds) and background colour.",
    parameters: S.obj({
      width: S.num("px, even"), height: S.num("px, even"), fps: S.num("frames per second"),
      durationSec: S.num("total length in seconds"), background: S.str("#hex"),
    }),
    needsProject: true,
    apply(doc, a) {
      const o = { ...doc.output };
      if (a.width !== undefined) o.width = Math.round(num(a.width) / 2) * 2;
      if (a.height !== undefined) o.height = Math.round(num(a.height) / 2) * 2;
      if (a.fps !== undefined) o.fps = num(a.fps);
      if (a.durationSec !== undefined) o.durationInFrames = Math.max(1, Math.round(num(a.durationSec) * o.fps));
      if (a.background !== undefined) o.background = str(a.background);
      return {
        text: `output → ${o.width}×${o.height} @${o.fps}fps, ${(o.durationInFrames / o.fps).toFixed(2)}s`,
        doc: { ...doc, output: o },
      };
    },
  },
  {
    name: "add_layers",
    description:
      "Add one or more layers. Only `type` is required — omitted fields get defaults (full-frame, full-length, " +
      "Inter 700 white text). A text layer with empty text + backgroundColor is a solid rectangle (cards, bars). " +
      "Returns the new ids. " + LAYER_HELP,
    parameters: S.obj({ layers: S.arr(LAYER_FIELDS) }, ["layers"]),
    needsProject: true,
    apply(doc, a) {
      const taken = new Set(doc.layers.map((l) => l.id));
      const raw = Array.isArray(a.layers) ? (a.layers as Record<string, unknown>[]) : [];
      if (!raw.length) throw new Error("layers must be a non-empty array");
      const added = raw.map((r) => completeLayer(r, doc, taken));
      return {
        text: `added ${added.map((l) => `${l.id}${l.name ? ` (${l.name})` : ""}`).join(", ")}`,
        doc: { ...doc, layers: [...doc.layers, ...added] },
      };
    },
  },
  {
    name: "update_layers",
    description: "Change fields on layers by id. Each update is {id, …any add_layers fields to change}.",
    parameters: S.obj(
      { updates: S.arr({ type: "object", properties: { id: T }, required: ["id"], description: "id + fields to change" }) },
      ["updates"]
    ),
    needsProject: true,
    apply(doc, a) {
      const ups = Array.isArray(a.updates) ? (a.updates as Record<string, unknown>[]) : [];
      const { fps } = doc.output;
      const layers = doc.layers.map((l) => {
        const u = ups.find((x) => x.id === l.id);
        if (!u) return l;
        const patch: Record<string, unknown> = { ...u };
        if (patch.fromSec !== undefined) patch.from = Math.round(num(patch.fromSec) * fps);
        if (patch.durationSec !== undefined) patch.durationInFrames = Math.round(num(patch.durationSec) * fps);
        if (patch.trimStartSec !== undefined) patch.trimStart = Math.round(num(patch.trimStartSec) * fps);
        delete patch.fromSec; delete patch.durationSec; delete patch.trimStartSec; delete patch.type;
        const next = layerSchema.safeParse({ ...l, ...patch });
        if (!next.success) {
          throw new Error(`invalid update for ${l.id}: ` + next.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
        }
        return next.data;
      });
      const missing = ups.filter((u) => !doc.layers.some((l) => l.id === u.id)).map((u) => str(u.id));
      return {
        text: `updated ${ups.length - missing.length} layer(s)` + (missing.length ? `; unknown ids: ${missing.join(", ")}` : ""),
        doc: { ...doc, layers },
      };
    },
  },
  {
    name: "remove_layers",
    description: "Remove layers by id, or everything with all=true.",
    parameters: S.obj({ ids: S.arr(S.str("layer id")), all: { type: "boolean" } }),
    needsProject: true,
    apply(doc, a) {
      const ids = new Set(Array.isArray(a.ids) ? (a.ids as string[]) : []);
      const layers = a.all === true ? [] : doc.layers.filter((l) => !ids.has(l.id));
      return { text: `removed ${doc.layers.length - layers.length} layer(s)`, doc: { ...doc, layers } };
    },
  },
  {
    name: "add_captions",
    description:
      "Add timed captions (one short line each, ≤ ~40 chars, from→to seconds). `box` places them all " +
      "(default: a band near the bottom); white Inter 700 on a dark translucent box. Each line is a text layer " +
      "marked role \"caption\"; together they are the video's \"Words on screen\" set, which the user edits as one " +
      "list. To restyle or retime captions, update every role:\"caption\" layer the same way.",
    parameters: S.obj(
      {
        captions: S.arr(S.obj({ from: N, to: N, text: T }, ["from", "to", "text"])),
        box: S.obj({ x: N, y: N, width: N, height: N }),
        fontSize: N,
        replaceExisting: { type: "boolean", description: "remove the existing captions (the words on screen) first" },
      },
      ["captions"]
    ),
    needsProject: true,
    apply(doc, a) {
      const { width: W, height: H, fps } = doc.output;
      const box = (a.box as Record<string, number>) ?? { x: Math.round(W * 0.11), y: Math.round(H * 0.73), width: Math.round(W * 0.78), height: 92 };
      const base = a.replaceExisting ? doc.layers.filter((l) => !isCaption(l)) : doc.layers;
      const z = base.length ? Math.max(...base.map((l) => l.z)) + 1 : 0;
      const caps = (Array.isArray(a.captions) ? a.captions : []) as Array<{ from: number; to: number; text: string }>;
      const taken = new Set(base.map((l) => l.id));
      const added = caps.map((c, i) =>
        completeLayer(
          {
            type: "text", role: "caption", name: `Caption ${i + 1}`, text: c.text, ...box, z,
            fromSec: num(c.from), durationSec: Math.max(1 / fps, num(c.to) - num(c.from)),
            fontFamily: "Inter", fontSize: num(a.fontSize, 36), fontWeight: 700, color: "#ffffff",
            align: "center", backgroundColor: "rgba(8,8,10,0.62)", anim: { preset: "fade", delay: 0, duration: 4 },
          },
          doc,
          taken
        )
      );
      return { text: `added ${added.length} captions`, doc: { ...doc, layers: [...base, ...added] } };
    },
  },
];

// ---------- talking to the user (in-app chat only) ----------

export function interactiveTools(folderParam: Record<string, unknown> | null): ToolInfo[] {
  return [
    {
      name: "ask_user",
      description:
        "Rarely needed: ask 1–3 questions only when you can't proceed sensibly without facts only the user knows (a " +
        "name, which file is which). Decide style, fonts, colours, timing and layout yourself instead. Always give 2–4 " +
        "options (your best guesses, recommendation first); the user can also type an answer or let you decide. " +
        "Waits for answers. Never ask questions in plain chat text — use this tool.",
      parameters: S.obj(
        {
          questions: S.arr(
            S.obj(
              { id: S.str("short key"), question: S.str("the question"), options: S.arr(S.str("an option"), "2–4 suggested answers; put your recommendation first") },
              ["id", "question"]
            )
          ),
        },
        ["questions"]
      ),
      needsProject: false,
      interactive: true,
    },
    {
      name: "propose_storyboard",
      description:
        "Show the user the planned edit as a storyboard before cutting: each beat = timeline span, what is heard " +
        "(quote), what is seen (clip + time), and caption. The user approves or asks for changes. Waits for the answer.",
      parameters: S.obj(
        {
          ...(folderParam ? { folder: folderParam } : {}),
          summary: S.str("one or two sentences: the story arc"),
          beats: S.arr(
            S.obj(
              { from: { type: "number" }, to: { type: "number" }, heard: { type: "string" }, clip: { type: "string" }, clipTime: { type: "number" }, caption: { type: "string" } },
              ["from", "to", "clip", "clipTime"]
            )
          ),
        },
        ["summary", "beats"]
      ),
      needsProject: false,
      interactive: true,
    },
  ];
}
