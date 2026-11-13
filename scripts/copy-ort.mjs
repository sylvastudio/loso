// Copies ONNX Runtime's WASM build (used by in-browser Whisper) into
// public/ort/ so the site serves it itself instead of transformers.js
// fetching it from a CDN. Runs after install; the files match the installed
// onnxruntime-web version.
import { cpSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";

// The copy transformers.js imports: its own nested one if present, else the hoisted one.
const dist = [
  "node_modules/@huggingface/transformers/node_modules/onnxruntime-web/dist",
  "node_modules/onnxruntime-web/dist",
]
  .map((d) => path.join(process.cwd(), d))
  .find((d) => existsSync(d));
if (!dist) {
  console.warn("[copy-ort] onnxruntime-web not installed; skipping");
  process.exit(0);
}
const out = path.join(process.cwd(), "public", "ort");
mkdirSync(out, { recursive: true });
for (const f of ["ort-wasm-simd-threaded.asyncify.mjs", "ort-wasm-simd-threaded.asyncify.wasm"]) {
  const src = path.join(dist, f);
  if (!existsSync(src)) {
    console.error(`[copy-ort] missing ${src}`);
    process.exit(1);
  }
  cpSync(src, path.join(out, f));
}
console.log(`[copy-ort] copied ONNX Runtime WASM to ${path.relative(process.cwd(), out)}/`);
