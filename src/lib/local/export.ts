// In-tab MP4 export with @remotion/web-renderer: the same CompositorComposition
// the Player previews is rendered frame by frame in this tab and encoded with
// WebCodecs. No server, no headless Chromium.

import { canRenderMediaOnWeb, renderMediaOnWeb } from "@remotion/web-renderer";
import { CompositorComposition } from "../../remotion/compositor";
import type { ResolvedCompositorDoc } from "../compositor";

export interface ExportResult {
  blob: Blob;
  ms: number;
}

export async function checkExport(doc: ResolvedCompositorDoc) {
  return canRenderMediaOnWeb({ width: doc.output.width, height: doc.output.height });
}

export async function exportInTab(
  doc: ResolvedCompositorDoc,
  { onProgress, signal }: { onProgress?: (p: number) => void; signal?: AbortSignal } = {}
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
    isProduction: false,
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
