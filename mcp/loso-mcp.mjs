#!/usr/bin/env node
// Loso MCP server — zero-dependency stdio bridge to the Loso HTTP tool API.
//
//   GET  {LOSO_URL}/api/tools       -> { tools: ToolInfo[] }
//   POST {LOSO_URL}/api/tools/call  -> ToolCallResult
//        body { projectId?: string, name: string, args: object }
//
// Contract: src/lib/studio/contract.ts
// Transport: MCP stdio — newline-delimited JSON-RPC 2.0 on stdin/stdout.
// stdout carries protocol messages ONLY; all logging goes to stderr.
//
// Config: LOSO_URL (default http://localhost:3000)

import http from "node:http";
import https from "node:https";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const LOSO_URL = (process.env.LOSO_URL || "http://localhost:3000").replace(/\/+$/, "");
const LIST_TIMEOUT_MS = 30_000;
const CALL_TIMEOUT_MS = 20 * 60_000; // renders can take minutes; stay well above 15 min
const SUPPORTED_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const DEFAULT_VERSION = "2025-06-18";

const INSTRUCTIONS = [
  "Loso is a local video studio (Next.js app) for cutting and composing short videos from footage on this machine.",
  "Most tools need a projectId: call list_projects to find one, or create_project to start a new one.",
  "After changing layout/composition, call snapshot to see the rendered result before moving on.",
  "When cutting footage, cut only at sentence boundaries using the word timings from the transcript — never mid-word or mid-sentence.",
  "Cutting and rendering are not confirmed by Loso over MCP; ask your user before destructive or long-running steps.",
].join("\n");

function log(...a) {
  process.stderr.write(`[loso-mcp] ${a.join(" ")}\n`);
}

function readVersion() {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(readFileSync(join(here, "..", "package.json"), "utf8"));
    if (typeof pkg.version === "string" && pkg.version) return pkg.version;
  } catch {}
  return "0.1.0";
}
const VERSION = readVersion();

// ---------------------------------------------------------------- HTTP
// node:http rather than fetch: global fetch (undici) has a 5-minute
// headers/body timeout that can't be changed without the undici package.
function httpJson(method, path, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    let url;
    try {
      url = new URL(LOSO_URL + path);
    } catch (e) {
      return reject(new Error(`Invalid LOSO_URL "${LOSO_URL}": ${e.message}`));
    }
    const lib = url.protocol === "https:" ? https : http;
    const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
    const req = lib.request(
      url,
      {
        method,
        headers: {
          accept: "application/json",
          ...(payload ? { "content-type": "application/json", "content-length": payload.length } : {}),
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("error", reject);
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let json;
          try {
            json = text ? JSON.parse(text) : undefined;
          } catch {}
          resolve({ status: res.statusCode || 0, json, text });
        });
      },
    );
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`timed out after ${Math.round(timeoutMs / 1000)}s`)));
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function unreachable(err) {
  if (err && /^timed out/.test(err.message || "")) return `Loso at ${LOSO_URL} did not respond (${err.message}).`;
  const code = err && (err.code || (err.cause && err.cause.code));
  const detail = code ? `${code}` : err && err.message ? err.message : String(err);
  return `Loso isn't reachable at ${LOSO_URL} — start it with \`pnpm dev\` in the loso repo (or set LOSO_URL). (${detail})`;
}

function httpErrorText(r, what) {
  const msg =
    (r.json && (r.json.error?.message || r.json.error || r.json.message)) ||
    (r.text ? r.text.slice(0, 500) : "");
  const hint = r.status === 404 ? " — this Loso build may not expose the tool API yet (/api/tools)." : "";
  return `Loso ${what} failed: HTTP ${r.status}${msg ? ` — ${typeof msg === "string" ? msg : JSON.stringify(msg)}` : ""}${hint}`;
}

// ---------------------------------------------------------------- tools
function toMcpTool(t) {
  const base = t.parameters && typeof t.parameters === "object" ? t.parameters : {};
  const schema = { ...base, type: "object", properties: { ...(base.properties || {}) } };
  if (t.needsProject) {
    schema.properties.projectId = {
      type: "string",
      description: "Loso project id (from list_projects or create_project).",
    };
    const req = Array.isArray(base.required) ? base.required.filter((r) => r !== "projectId") : [];
    schema.required = ["projectId", ...req];
  }
  return { name: t.name, description: t.description || "", inputSchema: schema };
}

async function listTools() {
  let r;
  try {
    r = await httpJson("GET", "/api/tools", undefined, LIST_TIMEOUT_MS);
  } catch (e) {
    throw rpcError(-32603, unreachable(e));
  }
  if (r.status < 200 || r.status >= 300 || !r.json || !Array.isArray(r.json.tools)) {
    throw rpcError(-32603, r.status >= 200 && r.status < 300 ? "Loso returned an unexpected /api/tools payload" : httpErrorText(r, "tool listing"));
  }
  return r.json.tools.filter((t) => t && t.name && !t.interactive).map(toMcpTool);
}

function normalizeContent(content) {
  if (!Array.isArray(content)) return [{ type: "text", text: JSON.stringify(content ?? null) }];
  return content.map((c) => {
    if (c && c.type === "image") return { type: "image", data: String(c.data ?? ""), mimeType: c.mimeType || "image/png" };
    if (c && c.type === "text") return { type: "text", text: String(c.text ?? "") };
    return { type: "text", text: JSON.stringify(c) };
  });
}

async function callTool(params) {
  const name = params && params.name;
  if (typeof name !== "string" || !name) throw rpcError(-32602, "tools/call requires a string 'name'");
  const args = { ...((params && params.arguments) || {}) };
  const projectId = args.projectId;
  delete args.projectId;
  const body = { name, args };
  if (projectId !== undefined && projectId !== null && projectId !== "") body.projectId = String(projectId);

  const errResult = (text) => ({ content: [{ type: "text", text }], isError: true });
  let r;
  try {
    r = await httpJson("POST", "/api/tools/call", body, CALL_TIMEOUT_MS);
  } catch (e) {
    return errResult(unreachable(e));
  }
  if (r.json && Array.isArray(r.json.content)) {
    // Contract result — pass through even on non-2xx (the API may use 4xx for tool errors).
    return { content: normalizeContent(r.json.content), isError: Boolean(r.json.isError) || r.status >= 400 };
  }
  if (r.status < 200 || r.status >= 300) return errResult(httpErrorText(r, `tool "${name}"`));
  return errResult(`Loso returned an unexpected response for tool "${name}": ${r.text.slice(0, 500)}`);
}

// ---------------------------------------------------------------- JSON-RPC
function rpcError(code, message, data) {
  const e = new Error(message);
  e.rpc = { code, message, ...(data !== undefined ? { data } : {}) };
  return e;
}

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

async function handle(method, params) {
  switch (method) {
    case "initialize": {
      const requested = params && params.protocolVersion;
      return {
        protocolVersion: SUPPORTED_VERSIONS.includes(requested) ? requested : DEFAULT_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "loso", version: VERSION },
        instructions: INSTRUCTIONS,
      };
    }
    case "ping":
      return {};
    case "tools/list":
      return { tools: await listTools() };
    case "tools/call":
      return await callTool(params);
    default:
      throw rpcError(-32601, `Method not found: ${method}`);
  }
}

async function dispatch(msg) {
  if (!msg || typeof msg !== "object" || Array.isArray(msg) || msg.jsonrpc !== "2.0") {
    send({ jsonrpc: "2.0", id: msg && typeof msg === "object" && "id" in msg ? msg.id : null, error: { code: -32600, message: "Invalid Request" } });
    return;
  }
  const hasId = "id" in msg && msg.id !== null && msg.id !== undefined;
  if (typeof msg.method !== "string") {
    // A response to a server->client request (we send none) — ignore.
    if (!hasId || !("result" in msg || "error" in msg)) {
      send({ jsonrpc: "2.0", id: hasId ? msg.id : null, error: { code: -32600, message: "Invalid Request" } });
    }
    return;
  }
  if (!hasId) {
    // Notification: notifications/initialized, notifications/cancelled, ... — never answered.
    return;
  }
  try {
    const result = await handle(msg.method, msg.params);
    send({ jsonrpc: "2.0", id: msg.id, result });
  } catch (e) {
    const error = e && e.rpc ? e.rpc : { code: -32603, message: (e && e.message) || "Internal error" };
    if (!e || !e.rpc) log("internal error:", e && e.stack ? e.stack : String(e));
    send({ jsonrpc: "2.0", id: msg.id, error });
  }
}

// Newline-delimited reader. Each message is dispatched without awaiting so a
// slow tool call (render) never blocks subsequent requests.
let buf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buf += chunk;
  let nl;
  while ((nl = buf.indexOf("\n")) !== -1) {
    const line = buf.slice(0, nl).replace(/\r$/, "");
    buf = buf.slice(nl + 1);
    if (!line.trim()) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
      continue;
    }
    dispatch(msg).catch((e) => log("dispatch failed:", e && e.stack ? e.stack : String(e)));
  }
});
// On stdin EOF, let in-flight calls finish; the process exits once no handles remain.
process.on("uncaughtException", (e) => log("uncaught:", e && e.stack ? e.stack : String(e)));
process.on("unhandledRejection", (e) => log("unhandled:", e && e.stack ? e.stack : String(e)));

log(`ready (v${VERSION}) -> ${LOSO_URL}`);
