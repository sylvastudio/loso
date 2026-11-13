// One frame of the composition, rendered in this tab exactly as it exports
// (Remotion's web renderer) — the in-browser agent's "snapshot".

import { CompositorComposition } from "@/remotion/compositor";
import type { ResolvedCompositorDoc } from "../../compositor";

export async function renderStillJpeg(doc: ResolvedCompositorDoc, frame: number, scale = 0.5): Promise<string> {
  const { renderStillOnWeb } = await import("@remotion/web-renderer");
  const props = { doc, webMedia: true };
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
    // Remotion counts renders (no content is sent); the public site counts as production.
    licenseKey: process.env.NEXT_PUBLIC_REMOTION_LICENSE_KEY ?? null,
    isProduction: process.env.NEXT_PUBLIC_LOSO_STATIC === "1",
    delayRenderTimeoutInMilliseconds: 20000,
  }).then((r) => r.canvas());
  const timeout = new Promise<never>((_, rej) => setTimeout(() => rej(new Error("the frame took too long to draw")), 25000));
  const canvas = await Promise.race([run, timeout]);
  const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.8 });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
