// Templates in the browser-only app: saved in this browser (IndexedDB), with
// the built-in Poster card always available.

import { compositorDocSchema, type CompositorDoc } from "../compositor";
import { POSTER_DESCRIPTION, POSTER_ID, posterDoc, slotsOf, type Template } from "../templates-core";
import { idbAll, idbDelete, idbGet, idbPut } from "./db";

function builtinPoster(): Template {
  const doc = posterDoc();
  return {
    id: POSTER_ID,
    name: "Poster card",
    description: POSTER_DESCRIPTION,
    doc,
    slots: slotsOf(doc),
    builtin: true,
    createdAt: 0,
    updatedAt: 0,
  };
}

type Stored = Omit<Template, "slots">;

function hydrate(t: Stored): Template | null {
  const parsed = compositorDocSchema.safeParse(t.doc);
  return parsed.success ? { ...t, doc: parsed.data, slots: slotsOf(parsed.data) } : null;
}

export async function listLocalTemplates(): Promise<Template[]> {
  const mine = (await idbAll<Stored>("templates"))
    .map(hydrate)
    .filter((t): t is Template => !!t)
    .sort((a, b) => b.updatedAt - a.updatedAt);
  return [builtinPoster(), ...mine];
}

export async function getLocalTemplate(id: string): Promise<Template | null> {
  if (id === POSTER_ID) return builtinPoster();
  const t = await idbGet<Stored>("templates", id);
  return t ? hydrate(t) : null;
}

export async function saveLocalTemplate(name: string, doc: CompositorDoc, description = ""): Promise<Template> {
  const now = Date.now();
  const stored: Stored = {
    id: `tpl-${now.toString(36)}`,
    name,
    description,
    doc: structuredClone(doc),
    builtin: false,
    createdAt: now,
    updatedAt: now,
  };
  await idbPut("templates", stored.id, stored);
  return hydrate(stored)!;
}

export async function deleteLocalTemplate(id: string): Promise<void> {
  if (id !== POSTER_ID) await idbDelete("templates", id);
}
