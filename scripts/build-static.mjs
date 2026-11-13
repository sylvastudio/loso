// The public site (loso.sylvastudio.com): the browser-only app as plain
// static files in out/, no server. Runs when LOSO_STATIC=1 (see package.json
// "build"); a normal `npm run build` stays the dev/server build.
//
// `output: "export"` can't include the dev server's parts — the /api routes,
// the middleware, the server-backed /project/[id] editor — so this builds a
// staged copy of the app without them instead of moving files in the working
// tree (a running dev server would see them disappear). node_modules is
// linked, not copied.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd();
const stage = join(root, ".static-build");
const SERVER_ONLY = ["src/app/api", "src/app/project", "src/middleware.ts"];
const COPY = ["src", "public", "next.config.ts", "tsconfig.json", "postcss.config.mjs", "package.json", "next-env.d.ts"];

function run(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, stdio: "inherit", env: { ...process.env, LOSO_STATIC: "1" } });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

if (process.env.LOSO_STATIC !== "1") {
  run("npx", ["next", "build"], root);
  process.exit(0);
}

run("node", ["scripts/copy-ort.mjs"], root);

rmSync(stage, { recursive: true, force: true });
mkdirSync(stage);
for (const p of COPY) {
  if (!existsSync(join(root, p))) continue;
  cpSync(join(root, p), join(stage, p), {
    recursive: true,
    filter: (src) => !SERVER_ONLY.includes(relative(root, src)),
  });
}
symlinkSync(join(root, "node_modules"), join(stage, "node_modules"), "dir");

run("npx", ["next", "build"], stage);

rmSync(join(root, "out"), { recursive: true, force: true });
cpSync(join(stage, "out"), join(root, "out"), { recursive: true });

rmSync(stage, { recursive: true, force: true });

// The Content-Security-Policy, with a hash for every inline <script> Next
// wrote (no server = no nonces, and 'unsafe-inline' would let injected
// scripts run — and any script on this origin can read the user's Claude key).
// Netlify reads out/_headers on deploy; the other headers are in netlify.toml.
const hashes = new Set();
const walk = (d) =>
  readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));

// Bundlers inline some libraries' import.meta.url as an absolute file:// path
// (transformers.js). Don't publish the build machine's folder layout.
for (const f of walk(join(root, "out")).filter((f) => f.endsWith(".js"))) {
  const src = readFileSync(f, "utf8");
  const clean = src.replaceAll(`file://${stage}`, "file:///loso").replaceAll(`file://${root}`, "file:///loso");
  if (clean !== src) writeFileSync(f, clean);
}
for (const f of walk(join(root, "out")).filter((f) => f.endsWith(".html"))) {
  for (const m of readFileSync(f, "utf8").matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)) {
    if (m[1]) hashes.add(`'sha256-${createHash("sha256").update(m[1], "utf8").digest("base64")}'`);
  }
}
const csp = [
  "default-src 'self'",
  `script-src 'self' 'wasm-unsafe-eval' ${[...hashes].join(" ")}`,
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' blob: data:",
  "media-src 'self' blob:",
  "worker-src 'self' blob:",
  // The AI providers the user can bring a key for (lib/local/providers.ts), the
  // speech model's files, Remotion's render count, fonts.
  "connect-src 'self' blob: data: https://api.anthropic.com https://api.openai.com https://api.x.ai https://api.groq.com https://generativelanguage.googleapis.com https://openrouter.ai https://huggingface.co https://cdn-lfs.huggingface.co https://cdn-lfs-us-1.hf.co https://cas-bridge.xethub.hf.co https://www.remotion.pro https://fonts.googleapis.com https://fonts.gstatic.com",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "upgrade-insecure-requests",
].join("; ");
writeFileSync(
  join(root, "out", "_headers"),
  `/*\n  Content-Security-Policy: ${csp}\n  Content-Security-Policy-Report-Only: require-trusted-types-for 'script'\n`
);

// Nothing from the dev server may ship.
const leaks = walk(join(root, "out")).filter((f) => {
  const rel = relative(join(root, "out"), f);
  return rel.startsWith("api/") || /\.(html|js)$/.test(f) && /__losoDev/.test(readFileSync(f, "utf8"));
});
if (leaks.length) {
  console.error("Server-only code ended up in out/:", leaks.map((f) => relative(root, f)));
  process.exit(1);
}
console.log(`Static site written to out/ (${hashes.size} inline script hashes in out/_headers)`);
