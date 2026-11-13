import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

export const DATA_DIR = path.join(process.cwd(), "data");
export const ASSETS_DIR = path.join(DATA_DIR, "assets");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS kv (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  script TEXT NOT NULL DEFAULT '',
  settings TEXT NOT NULL DEFAULT '{}',
  artifacts TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  doc TEXT NOT NULL,
  builtin INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS agent_messages (
  project_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  message TEXT NOT NULL,
  turn TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  PRIMARY KEY (project_id, seq)
);
CREATE TABLE IF NOT EXISTS assets (
  hash TEXT PRIMARY KEY,
  ext TEXT NOT NULL,
  mime TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  original_name TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'upload',
  created_at INTEGER NOT NULL
);
`;

// Settings rows left by retired features (brand profile, voiceover pipeline,
// stock-image keys, usage counters). Idempotent, runs on open. The "key.groq"
// and "key.anthropic" rows stay: they hold the AI model key for those presets.
// The projects table keeps its old "script" column so old rows load unchanged.
const CLEANUP = `
DELETE FROM kv WHERE key IN ('brand', 'pronunciations', 'key.elevenlabs', 'key.pexels', 'key.serpapi')
  OR key LIKE 'usage.%';
`;

function open(): Database.Database {
  fs.mkdirSync(ASSETS_DIR, { recursive: true });
  const db = new Database(path.join(DATA_DIR, "studio.db"));
  db.pragma("journal_mode = WAL");
  db.exec(SCHEMA);
  db.exec(CLEANUP);
  return db;
}

// Survive Next.js dev-server HMR without leaking connections.
const g = globalThis as unknown as { __studioDb?: Database.Database; __studioSchema?: string };

export function getDb(): Database.Database {
  if (!g.__studioDb) g.__studioDb = open();
  // HMR keeps the connection alive across code changes; re-apply the
  // (idempotent) schema whenever it changes so new tables appear.
  if (g.__studioSchema !== SCHEMA + CLEANUP) {
    g.__studioDb.exec(SCHEMA);
    g.__studioDb.exec(CLEANUP);
    g.__studioSchema = SCHEMA + CLEANUP;
  }
  return g.__studioDb;
}
