import crypto from "node:crypto";
import { getDb } from "./db";
import { brandSchema, defaultBrand, type Brand } from "./brand";
import type { ProviderId } from "./providers";

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

// ---------- API keys (server-side only; never returned raw to the client) ----------

export function getApiKey(provider: ProviderId): string | null {
  return kvGet(`key.${provider}`);
}

export function setApiKey(provider: ProviderId, value: string) {
  if (value.trim() === "") kvDelete(`key.${provider}`);
  else kvSet(`key.${provider}`, value.trim());
}

// ---------- pronunciation dictionary ----------

export interface PronunciationEntry {
  match: string;
  replacement: string;
}

export function getPronunciations(): PronunciationEntry[] {
  const raw = kvGet("pronunciations");
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export function setPronunciations(entries: PronunciationEntry[]) {
  kvSet("pronunciations", JSON.stringify(entries));
}

// ---------- provider usage counters ----------

export function bumpUsage(provider: string, metric: string, amount: number) {
  const key = `usage.${provider}.${metric}`;
  const current = Number(kvGet(key) ?? 0);
  kvSet(key, String(current + amount));
}

export function getUsage(): Record<string, number> {
  const rows = getDb()
    .prepare("SELECT key, value FROM kv WHERE key LIKE 'usage.%'")
    .all() as Array<{ key: string; value: string }>;
  return Object.fromEntries(rows.map((r) => [r.key.slice(6), Number(r.value)]));
}

// ---------- brand ----------

export function getBrand(): Brand {
  const raw = kvGet("brand");
  if (!raw) return defaultBrand;
  try {
    return brandSchema.parse(JSON.parse(raw));
  } catch {
    return defaultBrand;
  }
}

export function setBrand(brand: Brand) {
  kvSet("brand", JSON.stringify(brand));
}

// ---------- projects ----------

export interface ProjectSettings {
  pace: "single" | "chill" | "normal" | "fast";
  captionStyle: "clean" | "dynamic";
  voiceId: string | null;
  voice?: { stability: number; similarity: number; style: number; speed: number };
}

export interface Project {
  id: string;
  title: string;
  script: string;
  settings: ProjectSettings;
  artifacts: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

interface ProjectRow {
  id: string;
  title: string;
  script: string;
  settings: string;
  artifacts: string;
  created_at: number;
  updated_at: number;
}

const defaultSettings: ProjectSettings = {
  pace: "normal",
  captionStyle: "clean",
  voiceId: null,
};

function rowToProject(row: ProjectRow): Project {
  return {
    id: row.id,
    title: row.title,
    script: row.script,
    settings: { ...defaultSettings, ...JSON.parse(row.settings) },
    artifacts: JSON.parse(row.artifacts),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listProjects(): Project[] {
  const rows = getDb()
    .prepare("SELECT * FROM projects ORDER BY updated_at DESC")
    .all() as ProjectRow[];
  return rows.map(rowToProject);
}

export function getProject(id: string): Project | null {
  const row = getDb().prepare("SELECT * FROM projects WHERE id = ?").get(id) as
    | ProjectRow
    | undefined;
  return row ? rowToProject(row) : null;
}

export function createProject(input: {
  title: string;
  script: string;
  settings?: Partial<ProjectSettings>;
}): Project {
  const now = Date.now();
  const id = crypto.randomUUID().slice(0, 8);
  getDb()
    .prepare(
      "INSERT INTO projects (id, title, script, settings, artifacts, created_at, updated_at) VALUES (?, ?, ?, ?, '{}', ?, ?)"
    )
    .run(
      id,
      input.title,
      input.script,
      JSON.stringify({ ...defaultSettings, ...input.settings }),
      now,
      now
    );
  return getProject(id)!;
}

export function updateProject(
  id: string,
  patch: Partial<Pick<Project, "title" | "script" | "settings" | "artifacts">>
): Project | null {
  const current = getProject(id);
  if (!current) return null;
  const next = { ...current, ...patch, settings: { ...current.settings, ...patch.settings } };
  getDb()
    .prepare(
      "UPDATE projects SET title = ?, script = ?, settings = ?, artifacts = ?, updated_at = ? WHERE id = ?"
    )
    .run(
      next.title,
      next.script,
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
