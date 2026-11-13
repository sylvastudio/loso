import "server-only";
import { type CompositorDoc } from "../compositor";
import { POSTER_DESCRIPTION, POSTER_ID, posterDoc } from "../templates-core";
import { getTemplate, listTemplates, saveTemplate, type Template } from "./store";

export { applyTemplate } from "../templates-core";

export function ensureBuiltinTemplates() {
  if (!getTemplate(POSTER_ID)) {
    saveTemplate({
      id: POSTER_ID,
      name: "Poster card",
      description: POSTER_DESCRIPTION,
      doc: posterDoc(),
      builtin: true,
    });
  }
}

export function allTemplates(): Template[] {
  ensureBuiltinTemplates();
  return listTemplates();
}

/** Save a composition as a template. `slots` maps layerId → slot name (merged with slots already set). */
export function templateFromDoc(
  doc: CompositorDoc,
  input: { name: string; description?: string; slots?: Record<string, string>; id?: string }
): Template {
  const copy = structuredClone(doc);
  copy.layers = copy.layers.map((l) =>
    input.slots && input.slots[l.id] ? { ...l, slot: input.slots[l.id] } : l
  );
  return saveTemplate({ id: input.id, name: input.name, description: input.description, doc: copy });
}
