import "server-only";
import path from "node:path";
import fs from "node:fs";
import { bundle } from "@remotion/bundler";
import { ensureBrowser, renderMedia, selectComposition } from "@remotion/renderer";
import { DATA_DIR } from "./db";
import type { CompositorDoc, ResolvedCompositorDoc } from "./compositor";

export const RENDERS_DIR = path.join(DATA_DIR, "renders");

// Cache the browser download + the Remotion bundle across renders. Both are
// expensive: ensureBrowser downloads a headless shell once, and bundle() runs
// esbuild over the Remotion entry. Module-level promises make repeat renders
// cheap (dev-server HMR may reset these, which is acceptable).
let browserPromise: Promise<unknown> | undefined;
let bundlePromise: Promise<string> | undefined;

function getBrowser() {
  return (browserPromise ??= ensureBrowser().catch((e) => {
    browserPromise = undefined; // don't cache a failure
    throw e;
  }));
}

function getServeUrl() {
  return (bundlePromise ??= bundle({
    entryPoint: path.join(process.cwd(), "src/remotion/index.ts"),
  }).catch((e) => {
    bundlePromise = undefined; // don't cache a failure
    throw e;
  }));
}

// Server-side resolver: media hashes -> absolute HTTP URLs served by the same
// Next app. Chromium blocks file:// resources from the http-served bundle
// origin, so assets must come over http. The renderer's Chromium runs in child
// processes and the route awaits asynchronously, so serving these concurrently
// does not block the event loop. `baseUrl` is the request origin.
function resolveDocForRender(doc: CompositorDoc, baseUrl: string): ResolvedCompositorDoc {
  return {
    output: doc.output,
    layers: doc.layers.map((l) =>
      l.type === "text" ? l : { ...l, src: `${baseUrl}/api/assets/${l.assetHash}` }
    ),
  };
}

// Prevent concurrent renders of the same project clobbering the output file.
const inFlight = new Set<string>();

export async function renderCompositor(
  projectId: string,
  doc: CompositorDoc,
  baseUrl: string
): Promise<string> {
  if (inFlight.has(projectId)) {
    throw new Error("A render for this project is already in progress");
  }
  inFlight.add(projectId);
  try {
    await getBrowser();
    const serveUrl = await getServeUrl();
    const inputProps = { doc: resolveDocForRender(doc, baseUrl) };

    const composition = await selectComposition({
      serveUrl,
      id: "compositor",
      inputProps,
    });

    fs.mkdirSync(RENDERS_DIR, { recursive: true });
    const outputLocation = path.join(RENDERS_DIR, `${projectId}.mp4`);

    await renderMedia({
      composition,
      serveUrl,
      codec: "h264",
      outputLocation,
      inputProps,
    });

    return outputLocation;
  } finally {
    inFlight.delete(projectId);
  }
}

export function renderPath(projectId: string): string {
  return path.join(RENDERS_DIR, `${projectId}.mp4`);
}
