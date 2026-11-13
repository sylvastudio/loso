import type { NextConfig } from "next";

// LOSO_STATIC=1: the public site (loso.sylvastudio.com), the browser-only app
// as static files in out/. Built from a staged copy without the server routes
// (scripts/build-static.mjs). Otherwise: the dev/server setup.
const isStatic = process.env.LOSO_STATIC === "1";

const nextConfig: NextConfig = isStatic
  ? {
      output: "export",
      images: { unoptimized: true },
      env: { NEXT_PUBLIC_LOSO_STATIC: "1" },
      webpack(config) {
        // onnxruntime-web names its 26 MB WASM with `new URL(…, import.meta.url)`,
        // so webpack would copy it into _next/static/media. Loso never loads that
        // copy: transcription points ONNX Runtime at /ort/ (scripts/copy-ort.mjs,
        // src/lib/local/transcribe.ts). Keep the URL, skip the file.
        config.module.rules.push({
          test: /ort-wasm-simd-threaded[^/\\]*\.wasm$/,
          type: "asset/resource",
          generator: { emit: false },
        });
        return config;
      },
    }
  : {
      serverExternalPackages: [
        "better-sqlite3",
        "@remotion/renderer",
        "@remotion/bundler",
        "esbuild",
      ],
    };

export default nextConfig;
