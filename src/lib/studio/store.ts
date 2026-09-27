import "server-only";
import crypto from "node:crypto";
import { getDb } from "../db";
import { compositorDocSchema, type CompositorDoc } from "../compositor";

// ---------- templates ----------
// A template is a saved composition. Layers carrying `slot` are the parts a
// new video fills in; everything else (card, rules, badges…) is fixed design.

export interface TemplateSlot {
  name: string;
  layerId: string;
  kind: "text" | "video" | "image" | "audio";
  /** Current text (for text slots) — doubles as the example value. */
  example?: string;
}

export interface Template {
  id: string;
  name: string;
  description: string;
  doc: CompositorDoc;
  slots: TemplateSlot[];
  builtin: boolean;
  createdAt: number;
  updatedAt: number;
}

interface TemplateRow {
  id: string;
  name: string;
  description: string;
  doc: string;
  builtin: number;
  created_at: number;
  updated_at: number;
}

export function slotsOf(doc: CompositorDoc): TemplateSlot[] {
  return doc.layers
    .filter((l) => l.slot)
    .map((l) => ({
      name: l.slot!,
      layerId: l.id,
      kind: l.type,
      example: l.type === "text" ? l.text : undefined,
    }));
}

function rowToTemplate(r: TemplateRow): Template {
  const doc = compositorDocSchema.parse(JSON.parse(r.doc));
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    doc,
    slots: slotsOf(doc),
    builtin: !!r.builtin,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function listTemplates(): Template[] {
  const rows = getDb()
    .prepare("SELECT * FROM templates ORDER BY builtin DESC, updated_at DESC")
    .all() as TemplateRow[];
  return rows.map(rowToTemplate);
}

export function getTemplate(id: string): Template | null {
  const row = getDb().prepare("SELECT * FROM templates WHERE id = ?").get(id) as
    | TemplateRow
    | undefined;
  return row ? rowToTemplate(row) : null;
}

export function saveTemplate(input: {
  id?: string;
  name: string;
  description?: string;
  doc: CompositorDoc;
  builtin?: boolean;
}): Template {
  const now = Date.now();
  const id = input.id ?? crypto.randomBytes(4).toString("hex");
  getDb()
    .prepare(
      `INSERT INTO templates (id, name, description, doc, builtin, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, description = excluded.description,
         doc = excluded.doc, updated_at = excluded.updated_at`
    )
    .run(id, input.name, input.description ?? "", JSON.stringify(input.doc), input.builtin ? 1 : 0, now, now);
  return getTemplate(id)!;
}

export function deleteTemplate(id: string) {
  getDb().prepare("DELETE FROM templates WHERE id = ? AND builtin = 0").run(id);
}

// ---------- agent chat history ----------
// Stored per project as provider-neutral ChatMessages (see lib/ai/types).
// Images are stored as asset hashes, never inline base64.

export interface StoredMessage {
  seq: number;
  turn: string;
  message: unknown;
  createdAt: number;
}

export function listAgentMessages(projectId: string): StoredMessage[] {
  const rows = getDb()
    .prepare("SELECT seq, turn, message, created_at FROM agent_messages WHERE project_id = ? ORDER BY seq")
    .all(projectId) as Array<{ seq: number; turn: string; message: string; created_at: number }>;
  return rows.map((r) => ({ seq: r.seq, turn: r.turn, message: JSON.parse(r.message), createdAt: r.created_at }));
}

export function appendAgentMessage(projectId: string, turn: string, message: unknown): number {
  const db = getDb();
  const next =
    ((db.prepare("SELECT MAX(seq) AS m FROM agent_messages WHERE project_id = ?").get(projectId) as {
      m: number | null;
    }).m ?? 0) + 1;
  db.prepare(
    "INSERT INTO agent_messages (project_id, seq, message, turn, created_at) VALUES (?, ?, ?, ?, ?)"
  ).run(projectId, next, JSON.stringify(message), turn, Date.now());
  return next;
}

export function clearAgentMessages(projectId: string) {
  getDb().prepare("DELETE FROM agent_messages WHERE project_id = ?").run(projectId);
}
