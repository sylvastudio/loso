import "server-only";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { renderStill, selectComposition } from "@remotion/renderer";
import { getBrowser, getServeUrl, resolveDocForRender } from "../render";
import type { CompositorDoc } from "../compositor";

/**
 * Render one frame of a composition to JPEG — the agent's eyes. Uses the same
 * bundle + headless browser as MP4 export, so what it sees is what exports.
 */
export async function snapshotFrame(
  doc: CompositorDoc,
  timeSec: number,
  baseUrl: string,
  scale = 0.5
): Promise<Buffer> {
  await getBrowser();
  const serveUrl = await getServeUrl();
  const inputProps = { doc: resolveDocForRender(doc, baseUrl) };
  const composition = await selectComposition({ serveUrl, id: "compositor", inputProps });
  const frame = Math.min(
    composition.durationInFrames - 1,
    Math.max(0, Math.round(timeSec * composition.fps))
  );
  const out = path.join(os.tmpdir(), `loso-still-${process.pid}-${Date.now()}.jpeg`);
  try {
    await renderStill({
      composition,
      serveUrl,
      output: out,
      frame,
      inputProps,
      imageFormat: "jpeg",
      jpegQuality: 80,
      scale,
    });
    return fs.readFileSync(out);
  } finally {
    fs.rmSync(out, { force: true });
  }
}
