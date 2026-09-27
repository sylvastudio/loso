import "server-only";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createProject, getProject, listProjects, updateProject } from "../repo";
import { storeAsset } from "../assets";
import { renderCompositor } from "../render";
import { compositorDocSchema, layerSchema, type CompositorDoc, type Layer } from "../compositor";
import { FONT_CHOICES } from "../brand";
import type { ToolCallResult, ToolInfo } from "./contract";
import { contactSheet, frameAt, resolveFolder, sceneChanges, scanFolder, transcriptOf } from "./footage";
import { cutSequence } from "./cut";
import { snapshotFrame } from "./snapshot";
import { allTemplates, applyTemplate, templateFromDoc } from "./templates";
import { deleteTemplate, getTemplate } from "./store";

// The studio toolbox. One registry serves the in-app agent, the HTTP tool API
// and the MCP server. Tools that change the composition write the project in
// the DB and return the new doc so an open editor can adopt it live.

export interface ToolCtx {
  projectId?: string;
  baseUrl: string; // origin of this Loso server (render + snapshots fetch assets over http)
  vision: boolean; // may this tool return images?
}

export interface ToolOutput {
  text: string;
  images?: Array<{ mime: string; data: string }>;
  doc?: CompositorDoc; // present when the composition changed
  isError?: boolean;
}

interface ToolSpec extends ToolInfo {
  run(ctx: ToolCtx, args: Record<string, unknown>): Promise<ToolOutput>;
}

// ---------- helpers ----------

const num = (v: unknown, d?: number) => (typeof v === "number" && Number.isFinite(v) ? v : Number(v ?? d));
const str = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));

function loadDoc(ctx: ToolCtx): CompositorDoc {
  if (!ctx.projectId) throw new Error("This tool needs a projectId");
  const p = getProject(ctx.projectId);
  if (!p) throw new Error(`Project ${ctx.projectId} not found`);
  const parsed = compositorDocSchema.safeParse(p.settings.compositor ?? {});
  return parsed.success ? parsed.data : compositorDocSchema.parse({});
}

function saveDoc(ctx: ToolCtx, doc: CompositorDoc): CompositorDoc {
  const clean = compositorDocSchema.parse(doc);
  updateProject(ctx.projectId!, { settings: { kind: "compositor", compositor: clean } as never });
  return clean;
}

function newId(type: string, taken: Set<string>) {
  let id = "";
  do id = `${type}-${Math.random().toString(36).slice(2, 7)}`;
  while (taken.has(id));
  return id;
}

/** Fill sensible defaults so a model only has to say what matters. */
function completeLayer(raw: Record<string, unknown>, doc: CompositorDoc, taken: Set<string>): Layer {
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
    ...(type === "video" || type === "audio" ? { trimStart: 0, trimEnd: null, volume: type === "video" ? 1 : 1 } : {}),
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
      if (l.type === "video" || l.type === "audio") o.volume = l.volume;
      return o;
    });
  return JSON.stringify({ output: { width, height, fps, durationSec: s(durationInFrames), background }, layers });
}

const jpeg = (buf: Buffer) => ({ mime: "image/jpeg", data: buf.toString("base64") });

// ---------- schemas (JSON Schema subset every provider accepts) ----------

const S = {
  str: (description: string) => ({ type: "string", description }),
  num: (description: string) => ({ type: "number", description }),
  obj: (properties: Record<string, unknown>, required: string[] = [], description?: string) => ({
    type: "object", properties, required, ...(description ? { description } : {}),
  }),
  arr: (items: unknown, description?: string) => ({ type: "array", items, ...(description ? { description } : {}) }),
};
const FOLDER = S.str("footage folder path (absolute or ~/…)");
const CLIP = S.str("clip id from footage_scan");

// Compact on purpose: this schema is sent with every agent step, and small
// providers (e.g. Groq's free tier, ~8k tokens/min) can't afford verbose schemas.
const N = { type: "number" };
const T = { type: "string" };
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

// ---------- the registry ----------

const TOOLS: ToolSpec[] = [
  // --- projects
  {
    name: "list_projects",
    description: "List Loso projects (id, title, kind).",
    parameters: S.obj({}),
    needsProject: false,
    async run() {
      const ps = listProjects().map((p) => ({ id: p.id, title: p.title, kind: p.settings.kind ?? "ai-short" }));
      return { text: JSON.stringify(ps) };
    },
  },
  {
    name: "create_project",
    description: "Create an empty Compositor project and return its id.",
    parameters: S.obj({ title: S.str("project title") }, ["title"]),
    needsProject: false,
    async run(_ctx, a) {
      const p = createProject({
        title: str(a.title) || "Untitled",
        script: "",
        settings: { kind: "compositor", compositor: compositorDocSchema.parse({}) } as never,
      });
      return { text: JSON.stringify({ id: p.id, title: p.title }) };
    },
  },

  // --- canvas
  {
    name: "get_composition",
    description:
      "Read the current composition: output size/fps/duration and every layer (times in seconds). Call this before editing.",
    parameters: S.obj({}),
    needsProject: true,
    async run(ctx) {
      return { text: describeDoc(loadDoc(ctx)) };
    },
  },
  {
    name: "set_output",
    description: "Set canvas size, fps, total duration (seconds) and background colour.",
    parameters: S.obj({
      width: S.num("px, even"), height: S.num("px, even"), fps: S.num("frames per second"),
      durationSec: S.num("total length in seconds"), background: S.str("#hex"),
    }),
    needsProject: true,
    async run(ctx, a) {
      const doc = loadDoc(ctx);
      const o = { ...doc.output };
      if (a.width !== undefined) o.width = Math.round(num(a.width) / 2) * 2;
      if (a.height !== undefined) o.height = Math.round(num(a.height) / 2) * 2;
      if (a.fps !== undefined) o.fps = num(a.fps);
      if (a.durationSec !== undefined) o.durationInFrames = Math.max(1, Math.round(num(a.durationSec) * o.fps));
      if (a.background !== undefined) o.background = str(a.background);
      const saved = saveDoc(ctx, { ...doc, output: o });
      return { text: `output → ${o.width}×${o.height} @${o.fps}fps, ${(o.durationInFrames / o.fps).toFixed(2)}s`, doc: saved };
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
    async run(ctx, a) {
      const doc = loadDoc(ctx);
      const taken = new Set(doc.layers.map((l) => l.id));
      const raw = Array.isArray(a.layers) ? (a.layers as Record<string, unknown>[]) : [];
      if (!raw.length) throw new Error("layers must be a non-empty array");
      const added = raw.map((r) => completeLayer(r, { ...doc, layers: doc.layers }, taken));
      const saved = saveDoc(ctx, { ...doc, layers: [...doc.layers, ...added] });
      return { text: `added ${added.map((l) => `${l.id}${l.name ? ` (${l.name})` : ""}`).join(", ")}`, doc: saved };
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
    async run(ctx, a) {
      const doc = loadDoc(ctx);
      const ups = Array.isArray(a.updates) ? (a.updates as Record<string, unknown>[]) : [];
      const { fps } = doc.output;
      const missing: string[] = [];
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
      for (const u of ups) if (!doc.layers.some((l) => l.id === u.id)) missing.push(str(u.id));
      const saved = saveDoc(ctx, { ...doc, layers });
      return {
        text: `updated ${ups.length - missing.length} layer(s)` + (missing.length ? `; unknown ids: ${missing.join(", ")}` : ""),
        doc: saved,
      };
    },
  },
  {
    name: "remove_layers",
    description: "Remove layers by id, or everything with all=true.",
    parameters: S.obj({ ids: S.arr(S.str("layer id")), all: { type: "boolean" } }),
    needsProject: true,
    async run(ctx, a) {
      const doc = loadDoc(ctx);
      const ids = new Set(Array.isArray(a.ids) ? (a.ids as string[]) : []);
      const layers = a.all === true ? [] : doc.layers.filter((l) => !ids.has(l.id));
      const saved = saveDoc(ctx, { ...doc, layers });
      return { text: `removed ${doc.layers.length - layers.length} layer(s)`, doc: saved };
    },
  },
  {
    name: "add_captions",
    description:
      "Add timed captions (one short line each, ≤ ~40 chars, from→to seconds). `box` places them all " +
      "(default: a band near the bottom); white Inter 700 on a dark translucent box.",
    parameters: S.obj(
      {
        captions: S.arr(S.obj({ from: N, to: N, text: T }, ["from", "to", "text"])),
        box: S.obj({ x: N, y: N, width: N, height: N }),
        fontSize: N,
        replaceExisting: { type: "boolean", description: "remove existing 'Caption …' layers first" },
      },
      ["captions"]
    ),
    needsProject: true,
    async run(ctx, a) {
      const doc = loadDoc(ctx);
      const { width: W, height: H, fps } = doc.output;
      const box = (a.box as Record<string, number>) ?? { x: Math.round(W * 0.11), y: Math.round(H * 0.73), width: Math.round(W * 0.78), height: 92 };
      const base = a.replaceExisting ? doc.layers.filter((l) => !/^Caption \d+/.test(l.name ?? "")) : doc.layers;
      const z = base.length ? Math.max(...base.map((l) => l.z)) + 1 : 0;
      const caps = (Array.isArray(a.captions) ? a.captions : []) as Array<{ from: number; to: number; text: string }>;
      const taken = new Set(base.map((l) => l.id));
      const added = caps.map((c, i) =>
        completeLayer(
          {
            type: "text", name: `Caption ${i + 1}`, text: c.text, ...box, z,
            fromSec: num(c.from), durationSec: Math.max(1 / fps, num(c.to) - num(c.from)),
            fontFamily: "Inter", fontSize: num(a.fontSize, 36), fontWeight: 700, color: "#ffffff",
            align: "center", backgroundColor: "rgba(8,8,10,0.62)", anim: { preset: "fade", delay: 0, duration: 4 },
          },
          doc,
          taken
        )
      );
      const saved = saveDoc(ctx, { ...doc, layers: [...base, ...added] });
      return { text: `added ${added.length} captions`, doc: saved };
    },
  },
  {
    name: "snapshot",
    description:
      "Render one frame of the composition exactly as it will export, to check layout (overlaps, text wrapping, " +
      "crops). Always check after building or changing a layout.",
    parameters: S.obj({ timeSec: S.num("time to show, seconds") }, ["timeSec"]),
    needsProject: true,
    async run(ctx, a) {
      const doc = loadDoc(ctx);
      if (!ctx.vision) {
        return { text: "This model can't see images, so here is the layout instead:\n" + describeDoc(doc) };
      }
      const buf = await snapshotFrame(doc, num(a.timeSec, 0), ctx.baseUrl);
      return { text: `frame at ${num(a.timeSec, 0)}s (${doc.output.width}×${doc.output.height}, shown at half size)`, images: [jpeg(buf)] };
    },
  },

  // --- templates
  {
    name: "list_templates",
    description: "List saved templates with their slots (the parts a new video fills in).",
    parameters: S.obj({}),
    needsProject: false,
    async run() {
      const ts = allTemplates().map((t) => ({
        id: t.id, name: t.name, description: t.description, builtin: t.builtin,
        size: `${t.doc.output.width}×${t.doc.output.height}`,
        slots: t.slots.map((s) => ({ name: s.name, kind: s.kind, example: s.example })),
      }));
      return { text: JSON.stringify(ts) };
    },
  },
  {
    name: "apply_template",
    description:
      "Replace the composition with a template, filling its slots. Text slots take text; video/image/audio slots take " +
      "an assetHash (e.g. from footage_cut). Unfilled media slots are dropped.",
    parameters: S.obj(
      {
        templateId: S.str("from list_templates"),
        fills: { type: "object", description: "slot name → text or assetHash" },
        durationSec: S.num("stretch full-length layers to this length"),
      },
      ["templateId"]
    ),
    needsProject: true,
    async run(ctx, a) {
      allTemplates();
      const t = getTemplate(str(a.templateId));
      if (!t) throw new Error(`template ${a.templateId} not found`);
      const doc = applyTemplate(t, (a.fills as Record<string, string>) ?? {}, {
        durationSec: a.durationSec !== undefined ? num(a.durationSec) : undefined,
      });
      const saved = saveDoc(ctx, doc);
      return { text: `applied "${t.name}" (${saved.layers.length} layers)`, doc: saved };
    },
  },
  {
    name: "save_template",
    description:
      "Save the current composition as a reusable template. `slots` marks which layers change per video " +
      "(layerId → slot name, e.g. {\"title-ab12\":\"title\",\"main\":\"video\"}). Other layers stay fixed design.",
    parameters: S.obj(
      { name: S.str("template name"), description: S.str("what it looks like and how to fill it"), slots: { type: "object", description: "layerId → slot name" } },
      ["name"]
    ),
    needsProject: true,
    async run(ctx, a) {
      const t = templateFromDoc(loadDoc(ctx), {
        name: str(a.name), description: str(a.description), slots: (a.slots as Record<string, string>) ?? {},
      });
      return { text: `saved template ${t.id} "${t.name}" with slots: ${t.slots.map((s) => s.name).join(", ") || "none"}` };
    },
  },
  {
    name: "delete_template",
    description: "Delete a user template (built-ins can't be deleted).",
    parameters: S.obj({ templateId: S.str("template id") }, ["templateId"]),
    needsProject: false,
    async run(_ctx, a) {
      deleteTemplate(str(a.templateId));
      return { text: "deleted" };
    },
  },

  // --- footage
  {
    name: "footage_scan",
    description: "List the video clips in a folder with duration, display size and whether they have audio.",
    parameters: S.obj({ folder: FOLDER }, ["folder"]),
    needsProject: false,
    async run(_ctx, a) {
      const clips = await scanFolder(str(a.folder));
      if (!clips.length) return { text: "No video clips (.mov/.mp4/.m4v/.mkv/.webm) found in that folder." };
      return {
        text: JSON.stringify(
          clips.map((c) => ({ clip: c.clip, durationSec: Math.round(c.durationSec * 10) / 10, size: `${c.width}×${c.height}`, fps: c.fps, hasAudio: c.hasAudio }))
        ),
      };
    },
  },
  {
    name: "footage_contact_sheet",
    description:
      "See a whole clip at a glance: one image of evenly spaced frames (6 per row, left→right, top→bottom). " +
      "For text-only models this returns scene-change times instead.",
    parameters: S.obj({ folder: FOLDER, clip: CLIP }, ["folder", "clip"]),
    needsProject: false,
    async run(ctx, a) {
      if (!ctx.vision) {
        const cuts = await sceneChanges(str(a.folder), str(a.clip));
        return { text: `Scene changes (s): ${cuts.join(", ") || "none — one continuous shot"}` };
      }
      const s = await contactSheet(str(a.folder), str(a.clip));
      return {
        text: `${s.clip.clip}: ${s.count} frames, one every ${s.intervalSec}s — frame k (0-based, reading order) is at ${s.intervalSec}·k seconds.`,
        images: [jpeg(fs.readFileSync(s.file))],
      };
    },
  },
  {
    name: "footage_frame",
    description: "Look closely at one moment of a clip (e.g. to check a shot's first frame isn't a blurry whip-pan).",
    parameters: S.obj({ folder: FOLDER, clip: CLIP, timeSec: S.num("seconds into the clip") }, ["folder", "clip", "timeSec"]),
    needsProject: false,
    async run(ctx, a) {
      if (!ctx.vision) return { text: "This model can't see images; use footage_contact_sheet scene times instead." };
      const f = await frameAt(str(a.folder), str(a.clip), num(a.timeSec, 0));
      return { text: `${a.clip} @ ${a.timeSec}s`, images: [jpeg(fs.readFileSync(f))] };
    },
  },
  {
    name: "footage_transcribe",
    description:
      "Transcribe a clip's speech (cached). Returns sentences with start–end seconds. Room audio transcripts are " +
      "rough — treat names and short words with care.",
    parameters: S.obj({ folder: FOLDER, clip: CLIP }, ["folder", "clip"]),
    needsProject: false,
    async run(_ctx, a) {
      const t = await transcriptOf(str(a.folder), str(a.clip));
      const lines = t.segments.map((s) => `${s.start.toFixed(2)}-${s.end.toFixed(2)}  ${s.text.trim()}`);
      return { text: `${a.clip} (${t.engine}, ${t.durationSec.toFixed(1)}s)\n${lines.join("\n") || "(no speech found)"}` };
    },
  },
  {
    name: "footage_words",
    description: "Word-by-word timings for part of a clip — use these to cut exactly between sentences.",
    parameters: S.obj({ folder: FOLDER, clip: CLIP, from: S.num("seconds"), to: S.num("seconds") }, ["folder", "clip", "from", "to"]),
    needsProject: false,
    async run(_ctx, a) {
      const t = await transcriptOf(str(a.folder), str(a.clip));
      const ws = t.words.filter((w) => w.start >= num(a.from) && w.start <= num(a.to));
      return { text: ws.map((w) => `${w.start.toFixed(2)}-${w.end.toFixed(2)} ${w.word}`).join("\n") || "(no words in range)" };
    },
  },
  {
    name: "footage_cut",
    description:
      "Cut an edit: `audio` pieces play in order (the words heard), `shots` play over them in order (dur values " +
      "sum to durationSec), with short dissolves, each cropped to `window` (the video box size in your layout). " +
      "focus = vertical crop centre 0–1 (aim at faces). Lip-sync = same clip+time as the audio then. Audio cuts " +
      "snap to word boundaries. Returns editAssetHash (+ backgroundAssetHash if `background` size given).",
    parameters: S.obj(
      {
        folder: FOLDER,
        audio: S.arr(S.obj({ clip: T, from: N, to: N }, ["clip", "from", "to"])),
        shots: S.arr(S.obj({ clip: T, start: N, dur: N, focus: N }, ["clip", "start", "dur"])),
        window: S.obj({ width: N, height: N }, ["width", "height"]),
        durationSec: N,
        crossfade: N,
        background: S.obj({ width: N, height: N }, ["width", "height"]),
      },
      ["folder", "audio", "shots", "window", "durationSec"]
    ),
    needsProject: false,
    confirm: true,
    async run(_ctx, a) {
      const r = await cutSequence({
        folder: str(a.folder),
        audio: (a.audio as never[]) ?? [],
        shots: (a.shots as never[]) ?? [],
        window: a.window as { width: number; height: number },
        durationSec: num(a.durationSec),
        crossfade: a.crossfade !== undefined ? num(a.crossfade) : undefined,
        background: (a.background as { width: number; height: number }) ?? null,
      });
      return {
        text: JSON.stringify({ editAssetHash: r.editHash, backgroundAssetHash: r.bgHash, durationSec: r.durationSec, notes: r.notes }),
      };
    },
  },
  {
    name: "import_file",
    description: "Import a local image, audio (e.g. a music bed) or video file into Loso and get its assetHash.",
    parameters: S.obj({ path: S.str("absolute path or ~/…") }, ["path"]),
    needsProject: false,
    async run(_ctx, a) {
      const p0 = str(a.path);
      const p = p0.startsWith("~") ? path.join(os.homedir(), p0.slice(1)) : p0;
      if (!fs.existsSync(p)) throw new Error(`file not found: ${p0}`);
      const size = fs.statSync(p).size;
      if (size > 500 * 1024 * 1024) throw new Error("file is over 500 MB");
      const ext = path.extname(p).slice(1).toLowerCase();
      const mime =
        ({ png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", svg: "image/svg+xml",
           mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4", mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm" } as Record<string, string>)[ext];
      if (!mime) throw new Error(`unsupported file type .${ext}`);
      const meta = storeAsset(fs.readFileSync(p), mime, path.basename(p), "studio-import");
      return { text: JSON.stringify({ assetHash: meta.hash, mime }) };
    },
  },
  {
    name: "render_video",
    description: "Export the composition to an MP4 (H.264 + audio). Takes about a minute for 30s.",
    parameters: S.obj({}),
    needsProject: true,
    confirm: true,
    async run(ctx) {
      const doc = loadDoc(ctx);
      if (!doc.layers.length) throw new Error("nothing to render — the composition has no layers");
      await renderCompositor(ctx.projectId!, doc, ctx.baseUrl);
      const renderedAt = Date.now();
      const p = getProject(ctx.projectId!)!;
      updateProject(ctx.projectId!, { artifacts: { ...p.artifacts, render: { url: `/api/renders/${ctx.projectId}`, renderedAt } } });
      return { text: `rendered → ${ctx.baseUrl}/api/renders/${ctx.projectId}?v=${renderedAt} (file: data/renders/${ctx.projectId}.mp4)` };
    },
  },

  // --- in-app only: talking to the user
  {
    name: "ask_user",
    description:
      "Ask the user 1–4 questions before making decisions that are theirs (text on the design, sound, style, which " +
      "moments matter). Each question can offer options; the user may also type their own answer. Waits for answers.",
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
    async run() {
      throw new Error("ask_user is handled by the chat UI");
    },
  },
  {
    name: "propose_storyboard",
    description:
      "Show the user the planned edit as a storyboard before cutting: each beat = timeline span, what is heard " +
      "(quote), what is seen (clip + time), and caption. The user approves or asks for changes. Waits for the answer.",
    parameters: S.obj(
      {
        folder: FOLDER,
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
    async run() {
      throw new Error("propose_storyboard is handled by the chat UI");
    },
  },
];

export function toolInfos(opts: { includeInteractive: boolean }): ToolInfo[] {
  return TOOLS.filter((t) => opts.includeInteractive || !t.interactive).map(
    ({ name, description, parameters, needsProject, interactive, confirm }) => ({
      name, description, parameters, needsProject, interactive, confirm,
    })
  );
}

export function getTool(name: string): ToolSpec | undefined {
  return TOOLS.find((t) => t.name === name);
}

export async function runTool(name: string, ctx: ToolCtx, args: Record<string, unknown>): Promise<ToolOutput> {
  const t = getTool(name);
  if (!t) return { text: `Unknown tool "${name}"`, isError: true };
  if (t.needsProject && !ctx.projectId) return { text: `${name} needs a projectId`, isError: true };
  if (args && "__raw" in args) {
    return { text: `Your arguments for ${name} weren't valid JSON: ${str(args.__raw).slice(0, 200)}`, isError: true };
  }
  try {
    return await t.run(ctx, args ?? {});
  } catch (e) {
    return { text: `${name} failed: ${(e as Error).message}`, isError: true };
  }
}

export function toContract(out: ToolOutput): ToolCallResult {
  return {
    content: [
      { type: "text", text: out.text },
      ...(out.images ?? []).map((i) => ({ type: "image" as const, mimeType: i.mime, data: i.data })),
    ],
    isError: out.isError,
  };
}

export { resolveFolder };
