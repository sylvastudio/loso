// How much memory Loso uses, and how heavy a job will be, from what browsers
// tell a web page. All of it is coarse on purpose:
// - navigator.deviceMemory is the computer's RAM rounded down and capped at 8
//   (Chrome/Edge only), so "8" can mean 8 GB or 64 GB.
// - performance.measureUserAgentSpecificMemory() counts the whole page but only
//   works when the page is cross-origin isolated (COOP + COEP), which Loso
//   isn't (COEP would block the speech model download).
// - performance.memory (Chrome) counts JavaScript objects only: not pictures,
//   decoded video frames or the graphics card.
// Video decoding (VideoToolbox on a Mac) happens in a separate system process
// that no web page can see, so none of these numbers include it.

import type { CompositorDoc } from "../compositor";

const MB = 1024 * 1024;
const GB = 1024 * MB;

/** The computer's RAM in GB as the browser reports it (0.25–8), or null when unknown. */
export function deviceMemoryGB(): number | null {
  if (typeof navigator === "undefined") return null;
  const v = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  return typeof v === "number" && v > 0 ? v : null;
}

export interface PageMemory {
  bytes: number;
  /** "page": the whole page (precise API). "js": JavaScript objects only (Chrome). */
  scope: "page" | "js";
  /** Chrome's JS heap ceiling for this tab, when known. */
  limitBytes?: number;
}

/** This tab's memory, or null when the browser doesn't say. */
export async function readPageMemory(): Promise<PageMemory | null> {
  if (typeof window === "undefined") return null;
  const perf = performance as Performance & {
    measureUserAgentSpecificMemory?: () => Promise<{ bytes: number }>;
    memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number };
  };
  if (window.crossOriginIsolated && perf.measureUserAgentSpecificMemory) {
    try {
      // Can take a while (it waits for a garbage collection); fall back if slow.
      const r = await Promise.race([
        perf.measureUserAgentSpecificMemory(),
        new Promise<null>((res) => setTimeout(() => res(null), 8000)),
      ]);
      if (r) return { bytes: r.bytes, scope: "page" };
    } catch {
      /* fall through */
    }
  }
  if (perf.memory?.usedJSHeapSize) {
    return { bytes: perf.memory.usedJSHeapSize, scope: "js", limitBytes: perf.memory.jsHeapSizeLimit };
  }
  return null;
}

/**
 * How many bytes of decoded video frames Remotion may keep around while
 * rendering (@remotion/media's cache; its default is ~1 GB and it is never
 * emptied after a render). Smaller only means a little more re-decoding: the
 * frames that end up in the video are the same. 240 MB is Remotion's minimum.
 */
export function mediaCacheBytes(): number {
  const ram = deviceMemoryGB();
  if (ram === null) return 400 * MB;
  if (ram <= 4) return 240 * MB;
  if (ram < 8) return 320 * MB;
  return 512 * MB;
}

export function fmtBytes(n: number): string {
  if (n >= GB) return `${(n / GB).toFixed(n >= 10 * GB ? 0 : 1)} GB`;
  return `${Math.max(1, Math.round(n / MB))} MB`;
}

// ---------- how heavy is a job ----------

export type Load = "light" | "heavy" | "very-heavy";

export interface JobEstimate {
  load: Load;
  /** Rough peak memory of the tab while making the video, in bytes. */
  peakBytes: number;
  /** Seconds of video. */
  seconds: number;
  /** Most video clips playing at the same moment. */
  clipsAtOnce: number;
  ramGB: number | null;
}

/** Most video layers on screen at the same frame. */
function maxOverlap(doc: CompositorDoc): number {
  const edges: Array<[number, number]> = [];
  for (const l of doc.layers) {
    if (l.type !== "video") continue;
    edges.push([l.from, 1], [l.from + Math.max(1, l.durationInFrames), -1]);
  }
  edges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let cur = 0;
  let best = 0;
  for (const [, d] of edges) best = Math.max(best, (cur += d));
  return best;
}

/**
 * A coarse guess, not a measurement. Peak memory while rendering is roughly:
 * the page and renderer (~600 MB), Remotion's frame cache, a decoder's worth
 * of frames per clip playing at once (sized by the output, since the source
 * size isn't known without opening every clip), and the canvases + encoder
 * queue at the output size. Total work (seconds × width × height × fps)
 * decides how long the machine stays under that load.
 */
export function estimateRender(doc: CompositorDoc): JobEstimate {
  const { width, height, fps, durationInFrames } = doc.output;
  const px = width * height;
  const seconds = durationInFrames / fps;
  const clipsAtOnce = maxOverlap(doc);
  const peakBytes = 600 * MB + mediaCacheBytes() + clipsAtOnce * px * 1.5 * 20 + px * 4 * 12;
  const gigapixels = (px * durationInFrames) / 1e9;
  const ramGB = deviceMemoryGB();

  let load: Load = "light";
  if (ramGB !== null) {
    const share = peakBytes / (ramGB * GB);
    // deviceMemory stops at 8, so "8" may be a much bigger computer (or an 8 GB
    // laptop like the ones Loso is used on): only long jobs warn there.
    // 20 gigapixels ≈ 5 minutes of 1080×1920 at 30 fps.
    if (ramGB < 8) {
      if (share > 0.5 || gigapixels > 25) load = "very-heavy";
      else if (share > 0.3 || gigapixels > 8 || clipsAtOnce >= 3) load = "heavy";
    } else if (gigapixels > 20 || clipsAtOnce >= 4) load = "heavy";
  } else if (gigapixels > 40) load = "heavy";
  return { load, peakBytes, seconds, clipsAtOnce, ramGB };
}

/** Speech-to-text on a stretch of audio: model (~300 MB) plus the audio itself. */
export function transcribeIsHeavy(seconds: number): boolean {
  const ram = deviceMemoryGB();
  return ram !== null && ram <= 4 && seconds > 300;
}

/**
 * A scale that halves the video (or so) while keeping both sides even, which
 * video encoders need. Null when no such scale exists for this size.
 */
export function smallScale(width: number, height: number): number | null {
  for (const s of [0.5, 0.25]) {
    const w = width * s;
    const h = height * s;
    if (Number.isInteger(w) && Number.isInteger(h) && w % 2 === 0 && h % 2 === 0 && Math.min(w, h) >= 160) return s;
  }
  return null;
}
