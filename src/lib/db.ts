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

function open(): Database.Database {
  fs.mkdirSync(ASSETS_DIR, { recursive: true });
  const db = new Database(path.join(DATA_DIR, "studio.db"));
  db.pragma("journal_mode = WAL");
  db.exec(SCHEMA);
  return db;
}

// Survive Next.js dev-server HMR without leaking connections.
const g = globalThis as unknown as { __studioDb?: Database.Database };

export function getDb(): Database.Database {
  if (!g.__studioDb) g.__studioDb = open();
  return g.__studioDb;
}
