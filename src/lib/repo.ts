import crypto from "node:crypto";
import { getDb } from "./db";
import { compositorDocSchema, type CompositorDoc } from "./compositor";

// ---------- kv ----------

function kvGet(key: string): string | null {
  const row = getDb().prepare("SELECT value FROM kv WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

function kvSet(key: string, value: string) {
  getDb()
    .prepare(
      "INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
    )
    .run(key, value);
}

function kvDelete(key: string) {
  getDb().prepare("DELETE FROM kv WHERE key = ?").run(key);
}

// ---------- provider keys (server-side only; never returned raw to the client) ----------
// Groq and Anthropic keep their AI key in a per-provider row ("key.groq",
// "key.anthropic"), so switching the agent between them never loses a key.
// Every other provider uses the single "ai.key" row below.

export type KeyedProvider = "groq" | "anthropic";

export function getApiKey(provider: KeyedProvider): string | null {
  return kvGet(`key.${provider}`);
}

export function setApiKey(provider: KeyedProvider, value: string) {
  if (value.trim() === "") kvDelete(`key.${provider}`);
  else kvSet(`key.${provider}`, value.trim());
}

// ---------- AI model config (bring-your-own-model; see src/lib/ai) ----------
// Stored as two kv rows so the key never travels with the JSON config:
// "ai.config" (JSON, no key) and "ai.key" (raw key string).

export function getAiConfigRaw(): string | null {
  return kvGet("ai.config");
}

export function setAiConfigRaw(json: string | null) {
  if (json === null) kvDelete("ai.config");
  else kvSet("ai.config", json);
}

export function getAiKey(): string | null {
  return kvGet("ai.key");
}

export function setAiKey(value: string | null) {
  if (value === null || value.trim() === "") kvDelete("ai.key");
  else kvSet("ai.key", value.trim());
}

/** Last "Test model" result (JSON) — lets the UI tell "never tested" from "failed" from "ready". */
export function getAiLastTestRaw(): string | null {
  return kvGet("ai.lastTest");
}

export function setAiLastTestRaw(json: string | null) {
  if (json === null) kvDelete("ai.lastTest");
  else kvSet("ai.lastTest", json);
}

// ---------- projects ----------

export interface ProjectSettings {
  /** "compositor" for every project Loso makes. Rows from the retired
   *  script-to-voiceover pipeline carry another kind (or none) and are
   *  kept but not opened. */
  kind?: string;
  /** The full layer document. */
  compositor?: CompositorDoc;
}

export interface Project {
  id: string;
  title: string;
  settings: ProjectSettings;
  artifacts: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

interface ProjectRow {
  id: string;
  title: string;
  settings: string;
  artifacts: string;
  created_at: number;
  updated_at: number;
}

function rowToProject(row: ProjectRow): Project {
  return {
    id: row.id,
    title: row.title,
    settings: JSON.parse(row.settings),
    artifacts: JSON.parse(row.artifacts),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function isCompositorProject(p: Project): boolean {
  return p.settings.kind === "compositor";
}

/** Compositor projects only; legacy rows stay in the table untouched. */
export function listProjects(): Project[] {
  const rows = getDb()
    .prepare("SELECT * FROM projects ORDER BY updated_at DESC")
    .all() as ProjectRow[];
  return rows.map(rowToProject).filter(isCompositorProject);
}

export function getProject(id: string): Project | null {
  const row = getDb().prepare("SELECT * FROM projects WHERE id = ?").get(id) as
    | ProjectRow
    | undefined;
  return row ? rowToProject(row) : null;
}

/** A new, empty compositor project (an optional starting doc). */
export function createProject(input: { title: string; doc?: CompositorDoc }): Project {
  const now = Date.now();
  const id = crypto.randomUUID().slice(0, 8);
  const settings: ProjectSettings = { kind: "compositor", compositor: input.doc ?? compositorDocSchema.parse({}) };
  getDb()
    .prepare(
      "INSERT INTO projects (id, title, settings, artifacts, created_at, updated_at) VALUES (?, ?, ?, '{}', ?, ?)"
    )
    .run(id, input.title, JSON.stringify(settings), now, now);
  return getProject(id)!;
}

export function updateProject(
  id: string,
  patch: Partial<Pick<Project, "title" | "settings" | "artifacts">>
): Project | null {
  const current = getProject(id);
  if (!current) return null;
  const next = { ...current, ...patch, settings: { ...current.settings, ...patch.settings } };
  getDb()
    .prepare(
      "UPDATE projects SET title = ?, settings = ?, artifacts = ?, updated_at = ? WHERE id = ?"
    )
    .run(
      next.title,
      JSON.stringify(next.settings),
      JSON.stringify(next.artifacts),
      Date.now(),
      id
    );
  return getProject(id);
}

export function deleteProject(id: string) {
  getDb().prepare("DELETE FROM projects WHERE id = ?").run(id);
}

// ---------- assets ----------

export interface AssetMeta {
  hash: string;
  ext: string;
  mime: string;
  bytes: number;
  originalName: string;
  kind: string;
  createdAt: number;
}

export function getAsset(hash: string): AssetMeta | null {
  const row = getDb().prepare("SELECT * FROM assets WHERE hash = ?").get(hash) as
    | {
        hash: string;
        ext: string;
        mime: string;
        bytes: number;
        original_name: string;
        kind: string;
        created_at: number;
      }
    | undefined;
  if (!row) return null;
  return {
    hash: row.hash,
    ext: row.ext,
    mime: row.mime,
    bytes: row.bytes,
    originalName: row.original_name,
    kind: row.kind,
    createdAt: row.created_at,
  };
}

export function insertAsset(meta: Omit<AssetMeta, "createdAt">) {
  getDb()
    .prepare(
      "INSERT OR IGNORE INTO assets (hash, ext, mime, bytes, original_name, kind, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    )
    .run(meta.hash, meta.ext, meta.mime, meta.bytes, meta.originalName, meta.kind, Date.now());
}
