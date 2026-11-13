"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import type { PlayerRef } from "@remotion/player";
import { PenLine, Undo2 } from "lucide-react";
import { Button, cx } from "@/components/ui";
import { LosoMark } from "@/components/logo";
import type { CompositorDoc, Layer, ResolvedCompositorDoc } from "@/lib/compositor";
import { clockAt } from "@/lib/screenshot";

// "Point at it": draw on the stage (circle, arrow, scribble) to show Loso
// what needs fixing. Send makes a PNG of the current frame with the drawing
// on top, attaches it to the chat with "Fix this: " ready, plus the time and
// the pieces under the marks as words. No drawing? Pick a piece instead.
// Local projects have no AI yet: the same picture can be saved to notes/.

export const POINT_SHORTCUT_LABEL = "⌘⇧X";
const LIME = "#d4f53c";
const MAX_SIDE = 1280;

type Pt = [number, number];
type Box = { x: number; y: number; w: number; h: number };

export interface PointResult {
  file: File;
  /** "Fix this: " + "(at 0:04, around: SUNDAY title, Date)" */
  prompt: string;
  caretAt: number;
  /** Plain words for the status region. */
  summary: string;
  /** The frame couldn't be drawn; the picture is a sketch of where things are. */
  sketch: boolean;
}

function label(l: Layer): string {
  if (l.name) return l.name;
  if (l.type === "text") return (l.text || "Words").replace(/\s+/g, " ").slice(0, 32);
  return l.type === "video" ? "Video" : l.type === "image" ? "Picture" : "Sound";
}

function visibleAt(layers: Layer[], frame: number) {
  return layers.filter((l) => l.type !== "audio" && frame >= l.from && frame < l.from + l.durationInFrames);
}

function bounds(strokes: Pt[][], pad: number): Box | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of strokes) for (const [x, y] of s) {
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  }
  if (!isFinite(x0)) return null;
  return { x: x0 - pad, y: y0 - pad, w: x1 - x0 + pad * 2, h: y1 - y0 + pad * 2 };
}

function hits(a: Box, l: Layer) {
  return a.x < l.x + l.width && a.x + a.w > l.x && a.y < l.y + l.height && a.y + a.h > l.y;
}

function pathOf(s: Pt[]) {
  if (s.length === 1) return `M${s[0][0]},${s[0][1]}l0.1,0`;
  return s.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join("");
}

async function renderFrame(doc: ResolvedCompositorDoc, frame: number, scale: number): Promise<OffscreenCanvas> {
  // The whole capture gets a few seconds; after that Loso gets the sketch
  // instead of the user waiting. The render is cancelled, not left running
  // (Remotion renders one at a time, so a stuck one would hold up the next).
  const { renderStillCanvas } = await import("@/lib/local/agent/still");
  return renderStillCanvas(doc, frame, scale, { timeoutMs: 6000, isProduction: false });
}

/** Frame (or a sketch of the pieces) + the marks, as a PNG. */
async function makePicture(
  doc: ResolvedCompositorDoc,
  frame: number,
  strokes: Pt[][],
  target: Layer | null,
  layers: Layer[]
): Promise<{ blob: Blob; sketch: boolean }> {
  const { width: W, height: H } = doc.output;
  const scale = Math.min(1, MAX_SIDE / Math.max(W, H));
  const cw = Math.round(W * scale);
  const ch = Math.round(H * scale);
  const canvas = document.createElement("canvas");
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext("2d")!;
  let sketch = false;
  try {
    const shot = await renderFrame(doc, frame, scale);
    ctx.drawImage(shot, 0, 0, cw, ch);
    shot.width = shot.height = 1; // drawn: let its pixels go now
  } catch {
    // Couldn't draw the real frame: a plain map of where the pieces are.
    sketch = true;
    ctx.fillStyle = doc.output.background || "#0a0a0b";
    ctx.fillRect(0, 0, cw, ch);
    ctx.font = `${Math.round(22 * scale * (W / 1080))}px sans-serif`;
    for (const l of visibleAt(layers, frame)) {
      ctx.strokeStyle = "rgba(242,241,236,0.55)";
      ctx.lineWidth = 2;
      ctx.strokeRect(l.x * scale, l.y * scale, l.width * scale, l.height * scale);
      ctx.fillStyle = "rgba(242,241,236,0.85)";
      ctx.fillText(label(l), l.x * scale + 8, l.y * scale + 28 * scale * (W / 1080));
    }
  }
  const lw = Math.max(5, (W / 110) * scale);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = LIME;
  ctx.shadowColor = "rgba(0,0,0,0.6)";
  ctx.shadowBlur = lw;
  if (target) {
    ctx.setLineDash([lw * 2.5, lw * 1.5]);
    ctx.lineWidth = lw;
    ctx.strokeRect(target.x * scale, target.y * scale, target.width * scale, target.height * scale);
    ctx.setLineDash([]);
  }
  ctx.lineWidth = lw;
  for (const s of strokes) {
    ctx.beginPath();
    s.forEach(([x, y], i) => (i ? ctx.lineTo(x * scale, y * scale) : ctx.moveTo(x * scale, y * scale)));
    if (s.length === 1) ctx.lineTo(s[0][0] * scale + 0.1, s[0][1] * scale);
    ctx.stroke();
  }
  const blob = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("no picture"))), "image/png"));
  return { blob, sketch };
}

/** The toolbar button + its shortcut (⌘/Ctrl + Shift + X). */
export function PointAtItButton({
  disabledReason,
  active,
  onStart,
}: {
  /** Why it can't start right now, in words (null = ready). */
  disabledReason: string | null;
  active: boolean;
  onStart: (opener: HTMLElement | null) => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const startRef = useRef(onStart);
  startRef.current = onStart;
  const blocked = useRef(disabledReason);
  blocked.current = disabledReason;
  const activeRef = useRef(active);
  activeRef.current = active;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && !e.altKey && e.code === "KeyX") {
        const t = e.target as HTMLElement | null;
        if (t && (/^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName) || t.isContentEditable)) return;
        e.preventDefault();
        if (!activeRef.current && !blocked.current) startRef.current(ref.current);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <button
      ref={ref}
      type="button"
      aria-pressed={active}
      aria-disabled={disabledReason ? true : undefined}
      aria-keyshortcuts="Control+Shift+X Meta+Shift+X"
      title={disabledReason ?? `Circle what needs fixing (${POINT_SHORTCUT_LABEL})`}
      aria-label="Point at it"
      data-tour="point"
      onClick={() => !disabledReason && !active && onStart(ref.current)}
      className={cx(
        "flex h-10 shrink-0 items-center gap-1.5 px-2 text-[13.5px] transition-colors xl:px-2.5",
        active ? "text-lime" : disabledReason ? "text-ink-faint" : "text-ink hover:text-lime"
      )}
    >
      <PenLine size={15} aria-hidden /> <span className="hidden xl:inline">Point at it</span>
    </button>
  );
}

export function PointAtIt({
  doc,
  resolved,
  playerRef,
  fit,
  selected,
  barHost,
  barRight,
  onBarHeight,
  agent,
  onCancel,
  onSend,
  onSave,
  announce,
}: {
  doc: CompositorDoc;
  resolved: ResolvedCompositorDoc;
  playerRef: RefObject<PlayerRef | null>;
  /** Display px per composition px. */
  fit: number;
  selected: Layer | null;
  /** Where the toolbar goes (the stage section). */
  barHost: HTMLElement | null;
  /** Keep the toolbar clear of the floating chat. */
  barRight: number;
  /** The toolbar's height, so the stage can keep the frame below it. */
  onBarHeight?: (px: number) => void;
  /** true = "Send to Loso"; false = local: "Save picture to folder". */
  agent: boolean;
  onCancel: () => void;
  onSend: (r: PointResult) => void;
  /** Local: write the PNG into the folder's notes/, returns where. */
  onSave?: (file: File) => Promise<string>;
  announce: (msg: string) => void;
}) {
  const { width: W, height: H, fps } = doc.output;
  const [strokes, setStrokes] = useState<Pt[][]>([]);
  const [targetId, setTargetId] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const drawing = useRef<Pt[] | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const introRef = useRef<HTMLParagraphElement>(null);
  const ids = useId();

  // Freeze the frame being marked: read it once, pause after render (pausing
  // updates the Player's state, which can't happen while this renders).
  const [frame] = useState(() => playerRef.current?.getCurrentFrame() ?? 0);
  useEffect(() => {
    const p = playerRef.current;
    p?.pause();
    p?.seekTo(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const time = clockAt(frame, fps);
  const onStage = useMemo(() => visibleAt(doc.layers, frame).sort((a, b) => b.z - a.z), [doc.layers, frame]);
  const target = onStage.find((l) => l.id === targetId) ?? null;

  useEffect(() => {
    introRef.current?.focus();
    announce("Point at it. Draw on the video to show Loso what to fix. Escape cancels.");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const undoStroke = useCallback(() => setStrokes((s) => s.slice(0, -1)), []);
  // Set when the user cancels mid-capture, so a late picture is dropped.
  const cancelled = useRef(false);

  // Esc cancels; ⌘Z takes back the last mark (not an edit to the video).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = !!t && (/^(INPUT|TEXTAREA)$/.test(t.tagName) || t.isContentEditable);
      if (e.key === "Escape") {
        if (t?.tagName === "SELECT") return;
        e.preventDefault();
        e.stopPropagation();
        cancelled.current = true;
        onCancel();
      } else if (typing) {
        return;
      } else if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === "z") {
        e.preventDefault();
        e.stopPropagation();
        undoStroke();
      } else if (
        /^(Delete|Backspace|\[|\]|ArrowUp|ArrowDown|ArrowLeft|ArrowRight)$/.test(e.key) &&
        (e.target as HTMLElement)?.tagName !== "SELECT"
      ) {
        // The editor's piece shortcuts stay off while marking.
        e.stopPropagation();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onCancel, undoStroke]);

  function toComp(e: React.PointerEvent): Pt {
    const r = svgRef.current!.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * H];
  }

  const marked = strokes.length > 0 || !!target;
  const pad = W / 40;
  const area = bounds(strokes, pad);
  const under = useMemo(() => {
    const out: Layer[] = [];
    if (target) out.push(target);
    if (area) for (const l of onStage) if (l !== target && hits(area, l)) out.push(l);
    return out.slice(0, 4);
  }, [target, area, onStage]);

  async function finish(kind: "send" | "save") {
    if (!marked || busy) return;
    setBusy(true);
    setNote(null);
    try {
      const { blob, sketch } = await makePicture(resolved, frame, strokes, target, doc.layers);
      if (cancelled.current) return;
      const name = `Marked frame ${time.replace(":", "-")}.png`;
      const file = new File([blob], name, { type: "image/png" });
      const around = under.length ? `, around: ${under.map(label).join(", ")}` : "";
      const lead = "Fix this: ";
      const prompt = `${lead} (at ${time}${around})`;
      if (kind === "save" && onSave) {
        const where = await onSave(file);
        announce(`Saved the picture in ${where}`);
        onSend({ file, prompt, caretAt: lead.length, summary: `Saved in ${where}`, sketch });
      } else {
        onSend({
          file,
          prompt,
          caretAt: lead.length,
          summary: sketch ? "Couldn't take a picture of the frame, so Loso gets a sketch of where things are." : "Picture attached.",
          sketch,
        });
      }
    } catch (e) {
      setNote(`Couldn't make the picture. ${(e as Error).message}`);
      setBusy(false);
    }
  }

  const sw = Math.max(8, W / 110);
  // The toolbar sits above the frame: the editor moves the frame down by the
  // toolbar's height while marking, so nothing on the video is covered.
  const barRef = useRef<HTMLDivElement>(null);
  const heightCb = useRef(onBarHeight);
  heightCb.current = onBarHeight;
  useEffect(() => {
    const el = barRef.current;
    if (!el) return;
    const report = () => heightCb.current?.(el.offsetHeight);
    const ro = new ResizeObserver(report);
    ro.observe(el);
    report();
    return () => {
      ro.disconnect();
      heightCb.current?.(0);
    };
  }, []);

  const bar = (
    <div
      ref={barRef}
      className="pointer-events-none absolute left-0 top-2 z-40 flex justify-center px-4"
      style={{ right: barRight }}
    >
      <div
        role="region"
        aria-label="Point at it"
        className="pointer-events-auto flex max-w-full flex-col gap-2 border border-lime/60 bg-ground/95 px-4 py-2.5 shadow-[0_20px_60px_-20px_var(--color-shade)]"
      >
        <p ref={introRef} tabIndex={-1} id={`${ids}-intro`} className="text-[13.5px] leading-snug text-ink outline-none">
          <span className="font-serif text-[16px] italic">Point at it.</span>{" "}
          <span className="text-ink-dim">
            Draw around what needs fixing at {time}.{" "}
            {agent ? "Esc to cancel." : "Loso’s AI arrives in the next update, so for now you can keep the picture in your folder’s notes."}
          </span>
        </p>
        <div className="flex flex-wrap items-center gap-x-1 gap-y-1.5">
          <button
            type="button"
            onClick={undoStroke}
            disabled={!strokes.length || busy}
            className="flex h-9 items-center gap-1.5 px-2 text-[13px] text-ink transition-colors hover:text-lime disabled:text-ink-faint"
          >
            <Undo2 size={14} aria-hidden /> Undo a line
          </button>
          <button
            type="button"
            onClick={() => {
              setStrokes([]);
              setTargetId("");
            }}
            disabled={!marked || busy}
            className="flex h-9 items-center px-2 text-[13px] text-ink transition-colors hover:text-lime disabled:text-ink-faint"
          >
            Clear
          </button>
          <span className="mx-1 h-5 w-px bg-line-strong" aria-hidden />
          {selected && selected.type !== "audio" && targetId !== selected.id && onStage.some((l) => l.id === selected.id) && (
            <button
              type="button"
              onClick={() => setTargetId(selected.id)}
              className="flex h-9 items-center px-2 text-[13px] text-ink transition-colors hover:text-lime"
            >
              Point at the selected piece
            </button>
          )}
          <label className="flex h-9 items-center gap-2 text-[13px] text-ink-dim">
            <span>{selected ? "or" : "Or"} pick a piece</span>
            <select
              value={targetId}
              onChange={(e) => setTargetId(e.target.value)}
              disabled={busy}
              className="h-8 max-w-[180px] border-b border-edge bg-ground px-1 text-[13px] text-ink outline-none focus-visible:border-lime"
            >
              <option value="">None</option>
              {onStage.map((l) => (
                <option key={l.id} value={l.id}>
                  {label(l)}
                </option>
              ))}
            </select>
          </label>
          <span className="flex-1" />
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              cancelled.current = true;
              onCancel();
            }}
          >
            Cancel
          </Button>
          {agent ? (
            <Button size="sm" onClick={() => finish("send")} disabled={!marked || busy} aria-describedby={`${ids}-why`}>
              {busy && <LosoMark working size={16} />}
              {busy ? "Taking the picture…" : "Send to Loso"}
            </Button>
          ) : (
            <Button size="sm" onClick={() => finish("save")} disabled={!marked || busy || !onSave} aria-describedby={`${ids}-why`}>
              {busy && <LosoMark working size={16} />}
              {busy ? "Saving…" : "Save picture to folder"}
            </Button>
          )}
        </div>
        <p id={`${ids}-why`} role="status" className="min-h-[18px] text-[12.5px] text-ink-dim">
          {note ??
            (!marked
              ? "Draw with your mouse, pen or finger, or pick a piece."
              : under.length
                ? `Around: ${under.map(label).join(", ")}`
                : "Marked.")}
        </p>
      </div>
    </div>
  );

  return (
    <>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={marked ? `Your marks on the video${under.length ? `, around ${under.map(label).join(", ")}` : ""}` : "Drawing area over the video"}
        className="absolute inset-0 z-40 h-full w-full cursor-crosshair"
        style={{ touchAction: "none", outline: `1px solid ${LIME}`, outlineOffset: 0 }}
        onPointerDown={(e) => {
          if (busy || e.button > 0) return;
          e.preventDefault();
          e.stopPropagation();
          (e.currentTarget as Element).setPointerCapture(e.pointerId);
          const p = toComp(e);
          drawing.current = [p];
          setStrokes((s) => [...s, [p]]);
        }}
        onPointerMove={(e) => {
          if (!drawing.current) return;
          const p = toComp(e);
          const last = drawing.current[drawing.current.length - 1];
          // skip points closer than ~1.5 screen px
          if (Math.hypot(p[0] - last[0], p[1] - last[1]) * fit < 1.5) return;
          drawing.current.push(p);
          const cur = drawing.current;
          setStrokes((s) => [...s.slice(0, -1), [...cur]]);
        }}
        onPointerUp={() => (drawing.current = null)}
        onPointerCancel={() => (drawing.current = null)}
      >
        <rect x={0} y={0} width={W} height={H} fill="rgba(0,0,0,0.12)" />
        {target && (
          <rect
            x={target.x}
            y={target.y}
            width={target.width}
            height={target.height}
            fill="none"
            stroke={LIME}
            strokeWidth={sw}
            strokeDasharray={`${sw * 2.5} ${sw * 1.5}`}
            vectorEffect="non-scaling-stroke"
            style={{ strokeWidth: 3 }}
          />
        )}
        {strokes.map((s, i) => (
          <path
            key={i}
            d={pathOf(s)}
            fill="none"
            stroke={LIME}
            strokeWidth={sw}
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ filter: "drop-shadow(0 0 3px rgba(0,0,0,0.6))" }}
          />
        ))}
      </svg>
      {barHost ? createPortal(bar, barHost) : bar}
    </>
  );
}
