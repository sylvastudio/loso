"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import Link from "next/link";
import { Player } from "@remotion/player";
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignStartVertical,
  ArrowLeft,
  Download,
  Film,
  Image as ImageIcon,
  Loader2,
  Music,
  Redo2,
  Trash2,
  Type as TypeIcon,
  Undo2,
} from "lucide-react";
import { Button, Field, Select, cx } from "@/components/ui";
import { FontLoader } from "@/components/font-loader";
import { CompositorComposition } from "@/remotion/compositor";
import { FONT_CHOICES } from "@/lib/brand";
import {
  OUTPUT_PRESETS,
  compositorDocSchema,
  emptyCompositorDoc,
  resolveDocForBrowser,
  type Anim,
  type CompositorDoc,
  type Layer,
} from "@/lib/compositor";

interface ProjectShape {
  id: string;
  title: string;
  settings: { kind?: string; compositor?: CompositorDoc };
  artifacts: { render?: { url: string; renderedAt: number } };
}

const TYPE_ICON = { video: Film, image: ImageIcon, audio: Music, text: TypeIcon } as const;

let seq = 0;
function newId(prefix: string) {
  seq += 1;
  return `${prefix}-${Date.now().toString(36)}-${seq}`;
}

// ---------- small inspector controls ----------

function NumRow({
  label,
  value,
  onChange,
  step = 1,
  min,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
}) {
  return (
    <label className="flex items-center gap-2">
      <span className="micro w-[52px] shrink-0">{label}</span>
      <input
        type="number"
        value={Number.isFinite(value) ? value : 0}
        step={step}
        min={min}
        onChange={(e) => onChange(Number(e.target.value))}
        className="uline !py-1 text-[13px]"
      />
    </label>
  );
}

function SliderRow({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="micro w-[52px] shrink-0">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1"
      />
      <span className="w-8 text-right font-mono text-[11px] text-ink-dim">{value.toFixed(2)}</span>
    </div>
  );
}

// ---------- undo/redo history ----------
// Rapid edits (dragging, sliders) within COALESCE_MS collapse into a single
// undo step so one drag isn't dozens of entries; discrete edits each get one.

type DocUpdater = CompositorDoc | ((d: CompositorDoc) => CompositorDoc);
type History = { past: CompositorDoc[]; present: CompositorDoc; future: CompositorDoc[]; ts: number };
type HistoryAction = { type: "set"; updater: DocUpdater } | { type: "undo" } | { type: "redo" };

const COALESCE_MS = 450;
const HISTORY_LIMIT = 100;

function historyReducer(s: History, a: HistoryAction): History {
  switch (a.type) {
    case "undo": {
      if (!s.past.length) return s;
      const prev = s.past[s.past.length - 1];
      return { past: s.past.slice(0, -1), present: prev, future: [s.present, ...s.future], ts: 0 };
    }
    case "redo": {
      if (!s.future.length) return s;
      const next = s.future[0];
      return { past: [...s.past, s.present], present: next, future: s.future.slice(1), ts: 0 };
    }
    case "set": {
      const next =
        typeof a.updater === "function"
          ? (a.updater as (d: CompositorDoc) => CompositorDoc)(s.present)
          : a.updater;
      if (next === s.present) return s;
      const now = Date.now();
      if (s.ts !== 0 && now - s.ts < COALESCE_MS) {
        return { ...s, present: next, ts: now }; // coalesce into current step
      }
      return { past: [...s.past, s.present].slice(-HISTORY_LIMIT), present: next, future: [], ts: now };
    }
  }
}

// ---------- editor ----------

export function CompositorEditor({ project }: { project: ProjectShape }) {
  const [hist, dispatch] = useReducer(historyReducer, undefined, (): History => {
    const parsed = compositorDocSchema.safeParse(project.settings.compositor);
    return { past: [], present: parsed.success ? parsed.data : emptyCompositorDoc(), future: [], ts: 0 };
  });
  const doc = hist.present;
  const setDoc = useCallback((u: DocUpdater) => dispatch({ type: "set", updater: u }), []);
  const undo = useCallback(() => dispatch({ type: "undo" }), []);
  const redo = useCallback(() => dispatch({ type: "redo" }), []);
  const canUndo = hist.past.length > 0;
  const canRedo = hist.future.length > 0;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [stageBox, setStageBox] = useState({ w: 0, h: 0 });
  const [uploading, setUploading] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [renderUrl, setRenderUrl] = useState<string | null>(project.artifacts.render?.url ?? null);
  const [error, setError] = useState<string | null>(null);

  const stageRef = useRef<HTMLDivElement>(null);
  const firstRender = useRef(true);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingKind = useRef<"video" | "image" | "audio">("image");

  const { output, layers } = doc;
  const selected = layers.find((l) => l.id === selectedId) ?? null;

  // ---- persistence (debounced full-doc save) ----
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    const t = setTimeout(() => {
      fetch(`/api/projects/${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings: { kind: "compositor", compositor: doc } }),
      });
    }, 400);
    return () => clearTimeout(t);
  }, [doc, project.id]);

  // ---- keyboard: undo / redo ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (!meta || e.key.toLowerCase() !== "z") return;
      const t = e.target as HTMLElement | null;
      // let inputs/textareas keep native text undo
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  // ---- measure stage for scaling ----
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setStageBox({ w: el.clientWidth, h: el.clientHeight });
    });
    ro.observe(el);
    setStageBox({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const fit = useMemo(() => {
    if (!stageBox.w || !stageBox.h) return 0;
    return Math.min(stageBox.w / output.width, stageBox.h / output.height);
  }, [stageBox, output.width, output.height]);
  const dispW = output.width * fit;
  const dispH = output.height * fit;

  const resolved = useMemo(() => resolveDocForBrowser(doc), [doc]);

  // ---- doc mutations ----
  const setOutput = useCallback((patch: Partial<CompositorDoc["output"]>) => {
    setDoc((d) => ({ ...d, output: { ...d.output, ...patch } }));
  }, []);

  const patchLayer = useCallback((id: string, patch: Partial<Layer>) => {
    setDoc((d) => ({
      ...d,
      layers: d.layers.map((l) => (l.id === id ? ({ ...l, ...patch } as Layer) : l)),
    }));
  }, []);

  const addLayer = useCallback(
    (layer: Layer) => {
      setDoc((d) => ({ ...d, layers: [...d.layers, layer] }));
      setSelectedId(layer.id);
    },
    []
  );

  const removeLayer = useCallback((id: string) => {
    setDoc((d) => ({ ...d, layers: d.layers.filter((l) => l.id !== id) }));
    setSelectedId((s) => (s === id ? null : s));
  }, []);

  const reorder = useCallback((id: string, dir: 1 | -1) => {
    setDoc((d) => {
      const sorted = [...d.layers].sort((a, b) => a.z - b.z);
      const idx = sorted.findIndex((l) => l.id === id);
      const swap = idx + dir;
      if (swap < 0 || swap >= sorted.length) return d;
      const zi = sorted[idx].z;
      sorted[idx] = { ...sorted[idx], z: sorted[swap].z };
      sorted[swap] = { ...sorted[swap], z: zi };
      return { ...d, layers: sorted };
    });
  }, []);

  const nextZ = () => (layers.length ? Math.max(...layers.map((l) => l.z)) + 1 : 0);

  // ---- adding layers ----
  function addText() {
    addLayer({
      id: newId("text"),
      type: "text",
      x: Math.round(output.width * 0.1),
      y: Math.round(output.height * 0.42),
      width: Math.round(output.width * 0.8),
      height: Math.round(output.height * 0.16),
      rotation: 0,
      opacity: 1,
      z: nextZ(),
      from: 0,
      durationInFrames: output.durationInFrames,
      radius: 0,
      borderWidth: 0,
      borderColor: "#ffffff",
      text: "Your copy here",
      fontFamily: FONT_CHOICES[0],
      fontSize: Math.round(output.width * 0.08),
      color: "#ffffff",
      fontWeight: 800,
      italic: false,
      align: "center",
      backgroundColor: null,
    });
  }

  function addMediaLayer(kind: "video" | "image" | "audio", assetHash: string) {
    const common = {
      id: newId(kind),
      rotation: 0,
      opacity: 1,
      z: nextZ(),
      from: 0,
      durationInFrames: output.durationInFrames,
      radius: 0,
      borderWidth: 0,
      borderColor: "#ffffff",
    };
    if (kind === "audio") {
      addLayer({
        ...common,
        type: "audio",
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        assetHash,
        trimStart: 0,
        trimEnd: null,
        volume: 1,
      });
      return;
    }
    // video / image default to full frame
    const base = {
      ...common,
      x: 0,
      y: 0,
      width: output.width,
      height: output.height,
      assetHash,
      objectFit: "cover" as const,
    };
    if (kind === "video") {
      addLayer({ ...base, type: "video", trimStart: 0, trimEnd: null, volume: 1 });
    } else {
      addLayer({ ...base, type: "image" });
    }
  }

  async function uploadFile(file: File): Promise<string | null> {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("kind", "compositor");
    const r = await fetch("/api/assets", { method: "POST", body: fd });
    const d = await r.json();
    if (!r.ok) {
      setError(d.error ?? "Upload failed");
      return null;
    }
    return d.asset.hash as string;
  }

  function kindFromMime(mime: string): "video" | "image" | "audio" | null {
    if (mime.startsWith("video/")) return "video";
    if (mime.startsWith("image/")) return "image";
    if (mime.startsWith("audio/")) return "audio";
    return null;
  }

  async function ingestFiles(files: FileList | File[]) {
    setError(null);
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const kind = kindFromMime(file.type);
        if (!kind) continue;
        const hash = await uploadFile(file);
        if (hash) addMediaLayer(kind, hash);
      }
    } finally {
      setUploading(false);
    }
  }

  function pickFile(kind: "video" | "image" | "audio") {
    pendingKind.current = kind;
    const input = fileInputRef.current;
    if (!input) return;
    input.accept = kind === "video" ? "video/*" : kind === "audio" ? "audio/*" : "image/*";
    input.value = "";
    input.click();
  }

  // ---- drag interactions on the stage ----
  function beginMove(e: React.PointerEvent) {
    if (!selected || selected.type === "audio" || !fit) return;
    e.preventDefault();
    e.stopPropagation();
    const { id, x, y } = selected;
    const sx = e.clientX;
    const sy = e.clientY;
    const move = (ev: PointerEvent) => {
      patchLayer(id, {
        x: Math.round(x + (ev.clientX - sx) / fit),
        y: Math.round(y + (ev.clientY - sy) / fit),
      });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  function beginResize(e: React.PointerEvent, corner: "nw" | "ne" | "sw" | "se") {
    if (!selected || selected.type === "audio" || !fit) return;
    e.preventDefault();
    e.stopPropagation();
    const { id, x, y, width, height } = selected;
    const sx = e.clientX;
    const sy = e.clientY;
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - sx) / fit;
      const dy = (ev.clientY - sy) / fit;
      let nx = x;
      let ny = y;
      let nw = width;
      let nh = height;
      if (corner.includes("e")) nw = Math.max(20, width + dx);
      if (corner.includes("s")) nh = Math.max(20, height + dy);
      if (corner.includes("w")) {
        nw = Math.max(20, width - dx);
        nx = x + (width - nw);
      }
      if (corner.includes("n")) {
        nh = Math.max(20, height - dy);
        ny = y + (height - nh);
      }
      patchLayer(id, {
        x: Math.round(nx),
        y: Math.round(ny),
        width: Math.round(nw),
        height: Math.round(nh),
      });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  // ---- align selected layer to the canvas ----
  function align(edge: "left" | "hcenter" | "right" | "top" | "vcenter" | "bottom") {
    if (!selected || selected.type === "audio") return;
    const patch: Partial<Layer> = {};
    if (edge === "left") patch.x = 0;
    if (edge === "hcenter") patch.x = Math.round((output.width - selected.width) / 2);
    if (edge === "right") patch.x = output.width - selected.width;
    if (edge === "top") patch.y = 0;
    if (edge === "vcenter") patch.y = Math.round((output.height - selected.height) / 2);
    if (edge === "bottom") patch.y = output.height - selected.height;
    patchLayer(selected.id, patch);
  }

  // ---- export ----
  async function exportVideo() {
    setError(null);
    setRendering(true);
    try {
      const r = await fetch(`/api/projects/${project.id}/render`, { method: "POST" });
      const d = await r.json();
      if (!r.ok || d.status === "error") throw new Error(d.error ?? "Render failed");
      setRenderUrl(d.url);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRendering(false);
    }
  }

  const sortedLayers = [...layers].sort((a, b) => b.z - a.z); // top layer first in the list
  const durationSec = output.durationInFrames / output.fps;
  const activePreset = OUTPUT_PRESETS.find(
    (p) => p.width === output.width && p.height === output.height
  );

  const textFamilies = layers.filter((l) => l.type === "text").map((l) => l.fontFamily);

  return (
    <div className="flex h-full flex-col">
      <FontLoader families={[...FONT_CHOICES, ...textFamilies]} />
      <input
        ref={fileInputRef}
        type="file"
        hidden
        onChange={(e) => {
          if (e.target.files?.length) ingestFiles(e.target.files);
        }}
      />

      {/* header strip */}
      <div className="flex h-12 shrink-0 items-center gap-4 border-b border-line px-5">
        <Link
          href="/"
          className="flex items-center gap-1.5 text-[12.5px] text-ink-faint transition-colors hover:text-ink"
        >
          <ArrowLeft size={13} /> All projects
        </Link>
        <span className="h-3.5 w-px bg-line" />
        <h1 className="truncate font-serif text-[16px] italic tracking-tight">{project.title}</h1>
        <span className="micro text-lime">compositor</span>
        <div className="ml-1 flex items-center gap-0.5">
          <button
            onClick={undo}
            disabled={!canUndo}
            title="Undo (⌘Z)"
            className="flex h-7 w-7 items-center justify-center rounded-md text-ink-dim transition-colors hover:bg-line hover:text-ink disabled:pointer-events-none disabled:opacity-30"
          >
            <Undo2 size={14} />
          </button>
          <button
            onClick={redo}
            disabled={!canRedo}
            title="Redo (⇧⌘Z)"
            className="flex h-7 w-7 items-center justify-center rounded-md text-ink-dim transition-colors hover:bg-line hover:text-ink disabled:pointer-events-none disabled:opacity-30"
          >
            <Redo2 size={14} />
          </button>
        </div>
        <div className="flex-1" />
        {error && <span className="text-[12px] text-danger">{error.slice(0, 90)}</span>}
        {renderUrl && !rendering && (
          <a
            href={renderUrl}
            download={`${project.title || "loso"}.mp4`}
            className="flex items-center gap-1.5 text-[12.5px] text-ink-dim transition-colors hover:text-lime"
          >
            <Download size={13} /> Download MP4
          </a>
        )}
        <Button size="sm" onClick={exportVideo} disabled={rendering || layers.length === 0}>
          {rendering ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
          {rendering ? "Rendering…" : "Export video"}
        </Button>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* left rail */}
        <div className="flex w-[300px] shrink-0 flex-col gap-6 overflow-y-auto border-r border-line p-5">
          {/* output size */}
          <div className="flex flex-col gap-3">
            <span className="micro">Output</span>
            <Select
              value={activePreset?.id ?? "custom"}
              onChange={(e) => {
                const p = OUTPUT_PRESETS.find((x) => x.id === e.target.value);
                if (p) setOutput({ width: p.width, height: p.height });
              }}
            >
              {OUTPUT_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label} · {p.width}×{p.height}
                </option>
              ))}
              {!activePreset && <option value="custom">Custom · {output.width}×{output.height}</option>}
            </Select>
            <div className="grid grid-cols-2 gap-3">
              <NumRow label="Width" value={output.width} min={16} onChange={(v) => setOutput({ width: Math.max(16, v) })} />
              <NumRow label="Height" value={output.height} min={16} onChange={(v) => setOutput({ height: Math.max(16, v) })} />
              <NumRow label="FPS" value={output.fps} min={1} onChange={(v) => setOutput({ fps: Math.max(1, v) })} />
              <NumRow
                label="Secs"
                step={0.5}
                min={0.5}
                value={Number(durationSec.toFixed(2))}
                onChange={(v) => setOutput({ durationInFrames: Math.max(1, Math.round(v * output.fps)) })}
              />
            </div>
            <label className="flex items-center gap-2">
              <span className="micro w-[52px] shrink-0">BG</span>
              <input
                type="color"
                value={output.background ?? "#000000"}
                onChange={(e) => setOutput({ background: e.target.value })}
              />
              <span className="font-mono text-[11px] text-ink-dim">{output.background}</span>
            </label>
          </div>

          {/* add tray */}
          <div className="flex flex-col gap-2 border-t border-line pt-5">
            <span className="micro">Add</span>
            <div className="grid grid-cols-2 gap-2">
              <TrayButton icon={Film} label="Video" onClick={() => pickFile("video")} />
              <TrayButton icon={ImageIcon} label="Image" onClick={() => pickFile("image")} />
              <TrayButton icon={Music} label="Audio" onClick={() => pickFile("audio")} />
              <TrayButton icon={TypeIcon} label="Text" onClick={addText} />
            </div>
            {uploading && (
              <span className="micro flex items-center gap-2 text-lime">
                <Loader2 size={11} className="animate-spin" /> Uploading…
              </span>
            )}
          </div>

          {/* layer list */}
          <div className="flex flex-col gap-2 border-t border-line pt-5">
            <span className="micro">Layers</span>
            {sortedLayers.length === 0 && (
              <p className="text-[12px] leading-relaxed text-ink-faint">
                Drop a video, image, or audio onto the stage — or use Add above.
              </p>
            )}
            {sortedLayers.map((l) => {
              const Icon = TYPE_ICON[l.type];
              return (
                <div
                  key={l.id}
                  onClick={() => setSelectedId(l.id)}
                  className={cx(
                    "group flex cursor-pointer items-center gap-2 rounded-md border px-2.5 py-1.5 text-[12.5px] transition-colors",
                    selectedId === l.id
                      ? "border-lime/60 bg-lime/5 text-ink"
                      : "border-line text-ink-dim hover:border-line-strong"
                  )}
                >
                  <Icon size={13} className="shrink-0" />
                  <span className="min-w-0 flex-1 truncate">
                    {l.type === "text" ? l.text || "Text" : l.type}
                  </span>
                  <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                    <button
                      className="p-0.5 text-ink-faint hover:text-ink"
                      onClick={(e) => {
                        e.stopPropagation();
                        reorder(l.id, 1);
                      }}
                      title="Bring forward"
                    >
                      ↑
                    </button>
                    <button
                      className="p-0.5 text-ink-faint hover:text-ink"
                      onClick={(e) => {
                        e.stopPropagation();
                        reorder(l.id, -1);
                      }}
                      title="Send back"
                    >
                      ↓
                    </button>
                    <button
                      className="p-0.5 text-ink-faint hover:text-danger"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeLayer(l.id);
                      }}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* stage */}
        <div className="flex min-w-0 flex-1 flex-col bg-void">
          <div
            ref={stageRef}
            className="relative flex flex-1 items-center justify-center overflow-hidden p-8"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              if (e.dataTransfer.files?.length) ingestFiles(e.dataTransfer.files);
            }}
            onPointerDown={() => setSelectedId(null)}
          >
            {dispW > 0 && (
              <div
                className="relative shadow-[0_30px_90px_-30px_rgba(0,0,0,0.9)]"
                style={{ width: dispW, height: dispH }}
                onPointerDown={(e) => e.stopPropagation()}
              >
                <Player
                  component={CompositorComposition}
                  durationInFrames={Math.max(1, output.durationInFrames)}
                  fps={output.fps}
                  compositionWidth={output.width}
                  compositionHeight={output.height}
                  inputProps={{ doc: resolved }}
                  style={{ width: "100%", height: "100%" }}
                  controls
                  loop
                />

                {/* selection overlay */}
                {selected && selected.type !== "audio" && (
                  <div
                    className="absolute z-10 cursor-move border border-lime"
                    style={{
                      left: selected.x * fit,
                      top: selected.y * fit,
                      width: selected.width * fit,
                      height: selected.height * fit,
                      transform: `rotate(${selected.rotation}deg)`,
                      transformOrigin: "center center",
                    }}
                    onPointerDown={beginMove}
                  >
                    {(["nw", "ne", "sw", "se"] as const).map((c) => (
                      <span
                        key={c}
                        onPointerDown={(e) => beginResize(e, c)}
                        className="absolute h-2.5 w-2.5 rounded-full border border-black bg-lime"
                        style={{
                          left: c.includes("w") ? -5 : undefined,
                          right: c.includes("e") ? -5 : undefined,
                          top: c.includes("n") ? -5 : undefined,
                          bottom: c.includes("s") ? -5 : undefined,
                          cursor: c === "nw" || c === "se" ? "nwse-resize" : "nesw-resize",
                        }}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* timeline strip */}
          <div className="shrink-0 border-t border-line px-6 py-3">
            <div className="mb-2 flex items-center gap-3">
              <span className="micro">Timeline</span>
              <span className="font-mono text-[11px] text-ink-faint">
                {durationSec.toFixed(1)}s · {output.fps}fps · {layers.length} layers
              </span>
            </div>
            <div className="flex flex-col gap-1">
              {sortedLayers.map((l) => {
                const total = Math.max(1, output.durationInFrames);
                const left = (l.from / total) * 100;
                const w = (Math.min(l.durationInFrames, total - l.from) / total) * 100;
                const Icon = TYPE_ICON[l.type];
                return (
                  <div
                    key={l.id}
                    className="relative h-4 cursor-pointer rounded bg-line/50"
                    onClick={() => setSelectedId(l.id)}
                  >
                    <div
                      className={cx(
                        "absolute top-0 flex h-full items-center gap-1 rounded px-1.5 text-[10px]",
                        selectedId === l.id ? "bg-lime text-black" : "bg-line-strong text-ink-dim"
                      )}
                      style={{ left: `${left}%`, width: `${Math.max(2, w)}%` }}
                    >
                      <Icon size={9} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* inspector */}
        <div className="w-[280px] shrink-0 overflow-y-auto border-l border-line p-5">
          {!selected ? (
            <p className="text-[12.5px] leading-relaxed text-ink-faint">
              Select a layer to edit its position, timing, and style.
            </p>
          ) : (
            <div className="flex flex-col gap-5">
              <span className="micro text-lime">{selected.type} layer</span>

              {selected.type === "text" && (
                <div className="flex flex-col gap-3">
                  <Field label="Copy">
                    <textarea
                      rows={3}
                      value={selected.text}
                      onChange={(e) => patchLayer(selected.id, { text: e.target.value })}
                      className="w-full resize-none rounded-lg border border-line bg-panel/60 px-3 py-2 text-sm text-ink outline-none focus:border-line-strong"
                    />
                  </Field>
                  <Field label="Font">
                    <Select
                      value={selected.fontFamily}
                      onChange={(e) => patchLayer(selected.id, { fontFamily: e.target.value })}
                    >
                      {FONT_CHOICES.map((f) => (
                        <option key={f} value={f}>
                          {f}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <div className="grid grid-cols-2 gap-3">
                    <NumRow
                      label="Size"
                      value={selected.fontSize}
                      min={4}
                      onChange={(v) => patchLayer(selected.id, { fontSize: Math.max(4, v) })}
                    />
                    <NumRow
                      label="Weight"
                      step={100}
                      value={selected.fontWeight}
                      onChange={(v) => patchLayer(selected.id, { fontWeight: v })}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <label className="flex items-center gap-2">
                      <span className="micro">Color</span>
                      <input
                        type="color"
                        value={selected.color}
                        onChange={(e) => patchLayer(selected.id, { color: e.target.value })}
                      />
                    </label>
                    <button
                      onClick={() => patchLayer(selected.id, { italic: !selected.italic })}
                      title="Italic"
                      className={cx(
                        "flex h-7 w-7 items-center justify-center rounded-md border italic transition-colors",
                        selected.italic
                          ? "border-lime bg-lime/10 text-lime"
                          : "border-line text-ink-dim hover:border-line-strong"
                      )}
                    >
                      I
                    </button>
                    <Select
                      className="!w-auto"
                      value={selected.align}
                      onChange={(e) =>
                        patchLayer(selected.id, { align: e.target.value as "left" | "center" | "right" })
                      }
                    >
                      <option value="left">Left</option>
                      <option value="center">Center</option>
                      <option value="right">Right</option>
                    </Select>
                  </div>
                </div>
              )}

              {(selected.type === "video" || selected.type === "image") && (
                <Field label="Fit">
                  <Select
                    value={selected.objectFit}
                    onChange={(e) =>
                      patchLayer(selected.id, { objectFit: e.target.value as "cover" | "contain" })
                    }
                  >
                    <option value="cover">Cover</option>
                    <option value="contain">Contain</option>
                  </Select>
                </Field>
              )}

              {(selected.type === "video" || selected.type === "audio") && (
                <div className="flex flex-col gap-2.5">
                  <SliderRow
                    label="Volume"
                    min={0}
                    max={1}
                    step={0.05}
                    value={selected.volume}
                    onChange={(v) => patchLayer(selected.id, { volume: v })}
                  />
                  <NumRow
                    label="Trim in"
                    value={selected.trimStart}
                    min={0}
                    onChange={(v) => patchLayer(selected.id, { trimStart: Math.max(0, v) })}
                  />
                </div>
              )}

              {/* geometry (skip for audio) */}
              {selected.type !== "audio" && (
                <div className="flex flex-col gap-2 border-t border-line pt-4">
                  <span className="micro">Align to canvas</span>
                  <div className="flex items-center gap-1">
                    <AlignBtn icon={AlignStartVertical} title="Left" onClick={() => align("left")} />
                    <AlignBtn icon={AlignCenterVertical} title="Center" onClick={() => align("hcenter")} />
                    <AlignBtn icon={AlignEndVertical} title="Right" onClick={() => align("right")} />
                    <span className="mx-1 h-4 w-px bg-line" />
                    <AlignBtn icon={AlignStartHorizontal} title="Top" onClick={() => align("top")} />
                    <AlignBtn icon={AlignCenterHorizontal} title="Middle" onClick={() => align("vcenter")} />
                    <AlignBtn icon={AlignEndHorizontal} title="Bottom" onClick={() => align("bottom")} />
                  </div>
                  <span className="micro mt-2">Transform</span>
                  <div className="grid grid-cols-2 gap-3">
                    <NumRow label="X" value={selected.x} onChange={(v) => patchLayer(selected.id, { x: v })} />
                    <NumRow label="Y" value={selected.y} onChange={(v) => patchLayer(selected.id, { y: v })} />
                    <NumRow
                      label="W"
                      value={selected.width}
                      min={1}
                      onChange={(v) => patchLayer(selected.id, { width: Math.max(1, v) })}
                    />
                    <NumRow
                      label="H"
                      value={selected.height}
                      min={1}
                      onChange={(v) => patchLayer(selected.id, { height: Math.max(1, v) })}
                    />
                    <NumRow
                      label="Rotate"
                      value={selected.rotation}
                      onChange={(v) => patchLayer(selected.id, { rotation: v })}
                    />
                  </div>
                  <SliderRow
                    label="Opacity"
                    min={0}
                    max={1}
                    step={0.05}
                    value={selected.opacity}
                    onChange={(v) => patchLayer(selected.id, { opacity: v })}
                  />
                </div>
              )}

              {/* style: rounded corners + border (skip audio) */}
              {selected.type !== "audio" && (
                <div className="flex flex-col gap-2 border-t border-line pt-4">
                  <span className="micro">Style</span>
                  <div className="grid grid-cols-2 gap-3">
                    <NumRow
                      label="Radius"
                      value={selected.radius ?? 0}
                      min={0}
                      onChange={(v) => patchLayer(selected.id, { radius: Math.max(0, v) })}
                    />
                    <NumRow
                      label="Border"
                      value={selected.borderWidth ?? 0}
                      min={0}
                      onChange={(v) => patchLayer(selected.id, { borderWidth: Math.max(0, v) })}
                    />
                  </div>
                  <label className="flex items-center gap-2">
                    <span className="micro w-[52px] shrink-0">Line</span>
                    <input
                      type="color"
                      value={selected.borderColor ?? "#ffffff"}
                      onChange={(e) => patchLayer(selected.id, { borderColor: e.target.value })}
                    />
                    <span className="font-mono text-[11px] text-ink-dim">{selected.borderColor}</span>
                  </label>
                </div>
              )}

              {/* entrance animation (skip audio) */}
              {selected.type !== "audio" && (
                <div className="flex flex-col gap-3 border-t border-line pt-4">
                  <span className="micro">Animate in</span>
                  <Select
                    value={selected.anim?.preset ?? "none"}
                    onChange={(e) => {
                      const preset = e.target.value as Anim["preset"];
                      const cur = selected.anim ?? { preset: "none", delay: 0, duration: 18 };
                      patchLayer(selected.id, { anim: { ...cur, preset } });
                    }}
                  >
                    <option value="none">None</option>
                    <option value="fade">Fade</option>
                    <option value="rise">Rise up</option>
                    <option value="scale">Scale / pop</option>
                    <option value="hero">Hero (center → place)</option>
                  </Select>
                  {selected.anim && selected.anim.preset !== "none" && (
                    <div className="grid grid-cols-2 gap-3">
                      <NumRow
                        label="Delay"
                        value={selected.anim.delay}
                        min={0}
                        onChange={(v) =>
                          patchLayer(selected.id, {
                            anim: { ...(selected.anim as Anim), delay: Math.max(0, v) },
                          })
                        }
                      />
                      <NumRow
                        label="Dur"
                        value={selected.anim.duration}
                        min={1}
                        onChange={(v) =>
                          patchLayer(selected.id, {
                            anim: { ...(selected.anim as Anim), duration: Math.max(1, v) },
                          })
                        }
                      />
                    </div>
                  )}
                </div>
              )}

              {/* timing */}
              <div className="flex flex-col gap-3 border-t border-line pt-4">
                <span className="micro">Timing (frames)</span>
                <div className="grid grid-cols-2 gap-3">
                  <NumRow
                    label="Start"
                    value={selected.from}
                    min={0}
                    onChange={(v) => patchLayer(selected.id, { from: Math.max(0, v) })}
                  />
                  <NumRow
                    label="Length"
                    value={selected.durationInFrames}
                    min={1}
                    onChange={(v) => patchLayer(selected.id, { durationInFrames: Math.max(1, v) })}
                  />
                </div>
              </div>

              <Button
                variant="danger"
                size="sm"
                className="self-start"
                onClick={() => removeLayer(selected.id)}
              >
                <Trash2 size={13} /> Delete layer
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function TrayButton({
  icon: Icon,
  label,
  onClick,
}: {
  icon: typeof Film;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2 rounded-md border border-line px-3 py-2 text-[12.5px] text-ink-dim transition-colors hover:border-lime hover:text-lime"
    >
      <Icon size={13} />
      {label}
    </button>
  );
}

function AlignBtn({
  icon: Icon,
  title,
  onClick,
}: {
  icon: typeof Film;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="flex h-7 w-7 items-center justify-center rounded-md border border-line text-ink-dim transition-colors hover:border-lime hover:text-lime"
    >
      <Icon size={14} />
    </button>
  );
}
