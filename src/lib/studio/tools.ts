import "server-only";
import fs from "node:fs";
import path from "node:path";
import { createProject, getProject, listProjects, updateProject } from "../repo";
import { storeAsset } from "../assets";
import { renderCompositor } from "../render";
import { compositorDocSchema, type CompositorDoc } from "../compositor";
import { DOC_TOOLS, S, N, T, describeDoc, interactiveTools, num, str } from "./doc-tools";
import type { ToolCallResult, ToolInfo } from "./contract";
import { contactSheet, frameAt, resolveFolder, sceneChanges, scanFolder, transcriptOf, userPath } from "./footage";
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

function loadDoc(ctx: ToolCtx): CompositorDoc {
  if (!ctx.projectId) throw new Error("This tool needs a projectId");
  const p = getProject(ctx.projectId);
  if (!p) throw new Error(`Project ${ctx.projectId} not found`);
  if (p.settings.kind !== "compositor") throw new Error(`Project ${ctx.projectId} is an old-style project Loso no longer edits`);
  const parsed = compositorDocSchema.safeParse(p.settings.compositor ?? {});
  return parsed.success ? parsed.data : compositorDocSchema.parse({});
}

function saveDoc(ctx: ToolCtx, doc: CompositorDoc): CompositorDoc {
  const clean = compositorDocSchema.parse(doc);
  updateProject(ctx.projectId!, { settings: { kind: "compositor", compositor: clean } as never });
  return clean;
}

const jpeg = (buf: Buffer) => ({ mime: "image/jpeg", data: buf.toString("base64") });

const FOLDER = S.str("footage folder path (absolute or ~/…)");
const CLIP = S.str("clip id from footage_scan");

// ---------- the registry ----------

const TOOLS: ToolSpec[] = [
  // --- projects
  {
    name: "list_projects",
    description: "List Loso projects (id, title).",
    parameters: S.obj({}),
    needsProject: false,
    async run() {
      const ps = listProjects().map((p) => ({ id: p.id, title: p.title }));
      return { text: JSON.stringify(ps) };
    },
  },
  {
    name: "create_project",
    description: "Create an empty Compositor project and return its id.",
    parameters: S.obj({ title: S.str("project title") }, ["title"]),
    needsProject: false,
    async run(_ctx, a) {
      const p = createProject({ title: str(a.title) || "Untitled" });
      return { text: JSON.stringify({ id: p.id, title: p.title }) };
    },
  },

  // --- canvas
  // composition edits (pure, shared with the in-browser agent)
  ...DOC_TOOLS.map(
    (t): ToolSpec => ({
      name: t.name, description: t.description, parameters: t.parameters, needsProject: t.needsProject,
      async run(ctx, a) {
        const out = t.apply(loadDoc(ctx), a);
        return out.doc ? { text: out.text, doc: saveDoc(ctx, out.doc) } : { text: out.text };
      },
    })
  ),
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
    confirm: true,
    async run(_ctx, a) {
      const p0 = str(a.path);
      const p = userPath(p0);
      const size = fs.statSync(p).size;
      if (size > 500 * 1024 * 1024) throw new Error("file is over 500 MB");
      const ext = path.extname(p).slice(1).toLowerCase();
      const mime =
        ({ png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif",
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

  // --- in-app only: talking to the user (handled by the chat UI)
  ...interactiveTools(FOLDER).map(
    (t): ToolSpec => ({
      ...t,
      async run() {
        throw new Error(`${t.name} is handled by the chat UI`);
      },
    })
  ),
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
