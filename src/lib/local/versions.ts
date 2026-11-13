// Versions (the editor's undo history) kept per project in IndexedDB, so
// "going back never throws anything away" holds across reloads. Docs and
// labels only, no thumbnails, at most HISTORY_LIMIT versions. Used for both
// folder projects and dev-server projects (keyed by kind + id).

import type { CompositorDoc } from "../compositor";
import { compositorDocSchema } from "../compositor";
import { idbDelete, idbGet, idbPut } from "./db";
import { HISTORY_LIMIT, type History, type Step, type StepMeta } from "@/components/compositor/history";

export interface SavedVersions {
  v: 1;
  past: Step[];
  present: CompositorDoc;
  presentMeta: StepMeta;
  future: Step[];
  savedAt: number;
}

const key = (kind: string, projectId: string) => `${kind}:${projectId}`;

function validStep(s: unknown): s is Step {
  const x = s as Step | null;
  return !!x && typeof x === "object" && !!x.meta && typeof x.meta.at === "number" && compositorDocSchema.safeParse(x.doc).success;
}

/** The saved versions, or null (none yet, storage off, or unreadable). */
export async function loadVersions(kind: string, projectId: string): Promise<SavedVersions | null> {
  try {
    const raw = await idbGet<SavedVersions>("versions", key(kind, projectId));
    if (!raw || raw.v !== 1 || !compositorDocSchema.safeParse(raw.present).success) return null;
    return {
      ...raw,
      past: (raw.past ?? []).filter(validStep),
      future: (raw.future ?? []).filter(validStep),
    };
  } catch {
    return null;
  }
}

/** Keep the newest HISTORY_LIMIT versions (undone ones count too). */
export async function saveVersions(kind: string, projectId: string, h: History): Promise<void> {
  const future = h.future.slice(0, HISTORY_LIMIT - 1);
  const room = Math.max(0, HISTORY_LIMIT - 1 - future.length);
  const value: SavedVersions = {
    v: 1,
    past: room ? h.past.slice(-room) : [],
    present: h.present,
    presentMeta: h.presentMeta,
    future,
    savedAt: Date.now(),
  };
  try {
    await idbPut("versions", key(kind, projectId), value);
  } catch {
    /* storage full or blocked: versions just won't outlive this visit */
  }
}

export const forgetVersions = (kind: string, projectId: string) =>
  idbDelete("versions", key(kind, projectId)).catch(() => {});
