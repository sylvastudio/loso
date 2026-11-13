// One frame of the composition, rendered in this tab exactly as it exports
// (Remotion's web renderer) — the in-browser agent's "snapshot".
//
// Remotion runs one web render at a time (renders queue behind each other),
// so a frame that is given up on must really be cancelled: otherwise it keeps
// decoding in the background and every later snapshot (and the export) waits
// behind it. The AbortSignal does that; the timer only decides when.

import { CompositorComposition } from "@/remotion/compositor";
import type { ResolvedCompositorDoc } from "../../compositor";
import { mediaCacheBytes } from "../memory";

/** The agent looks at frames this big at most (long side, pixels). */
const LOOK_MAX_SIDE = 960;

export class StillError extends Error {
  constructor(
    message: string,
    readonly kind: "timeout" | "decode" | "other"
  ) {
    super(message);
  }
}

function classify(e: unknown, timedOut: boolean, timeoutMs: number): StillError {
  if (timedOut) return new StillError(`the frame took longer than ${Math.round(timeoutMs / 1000)}s to draw (the computer may be busy or low on memory)`, "timeout");
  const msg = e instanceof Error ? e.message : String(e);
  if (/decod|codec|prores|unsupported|cannot-decode|not supported/i.test(msg)) return new StillError(`a clip couldn't be decoded: ${msg.slice(0, 200)}`, "decode");
  if (/delayRender|timeout|timed out/i.test(msg)) return new StillError(`the frame took too long to draw: ${msg.slice(0, 160)}`, "timeout");
  return new StillError(msg.slice(0, 240) || "the frame couldn't be drawn", "other");
}

/** Render one frame to a canvas; cancelled (not just abandoned) after timeoutMs. */
export async function renderStillCanvas(
  doc: ResolvedCompositorDoc,
  frame: number,
  scale: number,
  { timeoutMs = 25000, isProduction = process.env.NEXT_PUBLIC_LOSO_STATIC === "1" }: { timeoutMs?: number; isProduction?: boolean } = {}
): Promise<OffscreenCanvas> {
  const { renderStillOnWeb } = await import("@remotion/web-renderer");
  const props = { doc, webMedia: true };
  const ac = new AbortController();
  let timedOut = false;
  let giveUp: ReturnType<typeof setTimeout> | undefined;
  const timer = setTimeout(() => {
    timedOut = true;
    ac.abort();
  }, timeoutMs);
  // If the renderer doesn't notice the abort soon, stop waiting for it anyway.
  const late = new Promise<never>((_, rej) => {
    ac.signal.addEventListener("abort", () => {
      giveUp = setTimeout(() => rej(new Error("cancelled")), 3000);
    });
  });
  try {
    const run = renderStillOnWeb({
      composition: {
        id: "compositor",
        component: CompositorComposition,
        width: doc.output.width,
        height: doc.output.height,
        fps: doc.output.fps,
        durationInFrames: Math.max(1, doc.output.durationInFrames),
        defaultProps: props,
      },
      inputProps: props,
      frame: Math.max(0, Math.min(frame, doc.output.durationInFrames - 1)),
      scale,
      signal: ac.signal,
      mediaCacheSizeInBytes: mediaCacheBytes(),
      // Remotion counts renders (no content is sent); the public site counts as production.
      licenseKey: process.env.NEXT_PUBLIC_REMOTION_LICENSE_KEY ?? null,
      isProduction,
      delayRenderTimeoutInMilliseconds: Math.max(3000, timeoutMs - 1000),
    }).then((r) => r.canvas());
    return await Promise.race([run, late]);
  } catch (e) {
    throw classify(e, timedOut, timeoutMs);
  } finally {
    clearTimeout(timer);
    clearTimeout(giveUp);
  }
}

async function toBase64(canvas: OffscreenCanvas): Promise<string> {
  const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.8 });
  // Shrink the drawing surface right away: the pixels are in the JPEG now.
  canvas.width = canvas.height = 1;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/**
 * The agent's look at one frame, as JPEG base64. Half size, never more than
 * 960 px on the long side. On failure it tries once more at a quarter of that
 * size (less to decode and draw) before giving up with a StillError.
 */
export async function renderStillJpeg(doc: ResolvedCompositorDoc, frame: number, scale = 0.5): Promise<{ data: string; scale: number }> {
  const long = Math.max(doc.output.width, doc.output.height);
  const first = Math.min(scale, LOOK_MAX_SIDE / long);
  try {
    return { data: await toBase64(await renderStillCanvas(doc, frame, first)), scale: first };
  } catch (e) {
    const err = e as StillError;
    // A clip the browser can't decode won't decode smaller either.
    if (err.kind === "decode") throw err;
    const second = Math.max(0.1, first / 2);
    try {
      return { data: await toBase64(await renderStillCanvas(doc, frame, second, { timeoutMs: 20000 })), scale: second };
    } catch (e2) {
      throw e2 instanceof StillError ? e2 : err;
    }
  }
}
