// In-tab MP4 export with @remotion/web-renderer: the same CompositorComposition
// the Player previews is rendered frame by frame in this tab and encoded with
// WebCodecs. No server, no headless Chromium.

import { renderMediaOnWeb } from "@remotion/web-renderer";
import { CompositorComposition } from "../../remotion/compositor";
import type { ResolvedCompositorDoc } from "../compositor";
import { mediaCacheBytes } from "./memory";

export interface ExportResult {
  blob: Blob;
  ms: number;
}

export interface ExportOptions {
  onProgress?: (p: number) => void;
  signal?: AbortSignal;
  /** A quick test copy: smaller (e.g. 0.5) and/or only the first frames. The real export leaves both unset. */
  scale?: number;
  lastFrame?: number;
}

export async function exportInTab(
  doc: ResolvedCompositorDoc,
  { onProgress, signal, scale, lastFrame }: ExportOptions = {}
): Promise<ExportResult> {
  const t0 = performance.now();
  const props = { doc, webMedia: true };
  const { getBlob } = await renderMediaOnWeb({
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
    onProgress: (p) => onProgress?.(p.progress),
    signal: signal ?? null,
    ...(scale && scale !== 1 ? { scale } : {}),
    ...(lastFrame !== undefined ? { frameRange: [0, Math.min(lastFrame, Math.max(1, doc.output.durationInFrames) - 1)] as [number, number] } : {}),
    // Decoded frames Remotion keeps (default ~1 GB, kept after the render ends).
    // Capped by this computer's RAM; the video's pixels are unchanged.
    mediaCacheSizeInBytes: mediaCacheBytes(),
    // Remotion counts renders (no content is sent); the public site counts as production.
    licenseKey: process.env.NEXT_PUBLIC_REMOTION_LICENSE_KEY ?? null,
    isProduction: process.env.NEXT_PUBLIC_LOSO_STATIC === "1",
  });
  const blob = await getBlob();
  return { blob, ms: performance.now() - t0 };
}

// renderMediaOnWeb streams into a temp file in the browser's private storage
// and only clears old ones on a later visit. Once the MP4 is safely in the
// user's folder, drop the temp copy so exports don't pile up there.
export async function discardRenderTemp(): Promise<void> {
  try {
    const root = await navigator.storage.getDirectory();
    const names: string[] = [];
    for await (const [name] of (root as unknown as { entries(): AsyncIterable<[string, unknown]> }).entries()) {
      if (name.startsWith("__remotion_render:")) names.push(name);
    }
    await Promise.all(names.map((n) => root.removeEntry(n).catch(() => {})));
  } catch {
    /* private storage unavailable: nothing to clean */
  }
}
