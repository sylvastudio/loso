import type { CompositorDoc, Layer } from "@/lib/compositor";

// ---------- undo/redo history with plain-words versions ----------
// Rapid edits (dragging, sliders) within COALESCE_MS collapse into a single
// step so one drag isn't dozens of entries; discrete edits each get one.
// Every step carries a label and a time, so the Versions rail can show
// "Moved the title · 3:42". Going back to a version never deletes anything:
// it adds a new step on top ("Went back to 3:42").

export type DocUpdater = CompositorDoc | ((d: CompositorDoc) => CompositorDoc);

export interface StepMeta {
  at: number;
  label: string;
  /** Who made it: you, Loso (agent turn), a starting point, or another window. */
  by: "you" | "loso" | "start" | "outside" | "open";
}

export interface Step {
  doc: CompositorDoc;
  meta: StepMeta;
}

// `group` tags the present entry when it came from outside the editor (an
// agent turn, an MCP edit): consecutive changes with the same group collapse
// into one undo step, so "undo" reverts a whole agent turn at once.
export type History = {
  past: Step[];
  present: CompositorDoc;
  presentMeta: StepMeta;
  future: Step[];
  ts: number;
  group?: string;
};

export type HistoryAction =
  | { type: "set"; updater: DocUpdater; /** plain-words label instead of the guessed one */ label?: string }
  | { type: "external"; doc: CompositorDoc; group: string; label?: string }
  | { type: "restore"; index: number }
  | { type: "undo" }
  | { type: "redo" }
  /** Versions saved on an earlier visit (see lib/local/versions.ts). */
  | { type: "hydrate"; saved: { past: Step[]; present: CompositorDoc; presentMeta: StepMeta; future: Step[] } };

const COALESCE_MS = 450;
export const HISTORY_LIMIT = 100;

/** JSON with object keys sorted, so key order (editor vs server vs schema) never counts as a change. */
function stable(v: unknown): string {
  return JSON.stringify(v, (_k, x) =>
    x && typeof x === "object" && !Array.isArray(x)
      ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, (x as Record<string, unknown>)[k]]))
      : x
  );
}

export const sameDoc = (a: CompositorDoc, b: CompositorDoc) => a === b || stable(a) === stable(b);

export function initialHistory(doc: CompositorDoc): History {
  return { past: [], present: doc, presentMeta: { at: Date.now(), label: "Opened the video", by: "open" }, future: [], ts: 0 };
}

/** Chronological list of every version: past, the one showing now, then undone ones. */
export function timeline(h: History): Array<Step & { current: boolean; undone: boolean }> {
  return [
    ...h.past.map((s) => ({ ...s, current: false, undone: false })),
    { doc: h.present, meta: h.presentMeta, current: true, undone: false },
    ...h.future.map((s) => ({ ...s, current: false, undone: true })),
  ];
}

export function clock(ts: number) {
  return new Date(ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function byFromGroup(group: string): StepMeta["by"] {
  if (group.startsWith("agent-")) return "loso";
  if (group.startsWith("tpl-")) return "start";
  return "outside";
}

export function historyReducer(s: History, a: HistoryAction): History {
  switch (a.type) {
    case "hydrate": {
      // The saved versions go *before* anything done since opening. If the
      // video opened exactly as it was saved, the saved history (including
      // undone versions) picks up where it left off. If it changed meanwhile
      // (another window, MCP, an edit that didn't reach the history store),
      // every saved version is kept as an older one and the opened video
      // stays current.
      const { saved } = a;
      const fresh = !s.past.length && !s.future.length;
      if (sameDoc(saved.present, s.present) && fresh) {
        return { ...s, past: saved.past.slice(-HISTORY_LIMIT), presentMeta: saved.presentMeta, future: saved.future, ts: 0 };
      }
      const older: Step[] = sameDoc(saved.present, s.past[0]?.doc ?? s.present)
        ? saved.past
        : [...saved.past, { doc: saved.present, meta: saved.presentMeta }, ...saved.future];
      return { ...s, past: [...older, ...s.past].slice(-HISTORY_LIMIT) };
    }
    case "undo": {
      if (!s.past.length) return s;
      const prev = s.past[s.past.length - 1];
      return {
        past: s.past.slice(0, -1),
        present: prev.doc,
        presentMeta: prev.meta,
        future: [{ doc: s.present, meta: s.presentMeta }, ...s.future],
        ts: 0,
      };
    }
    case "redo": {
      if (!s.future.length) return s;
      const next = s.future[0];
      return {
        past: [...s.past, { doc: s.present, meta: s.presentMeta }],
        present: next.doc,
        presentMeta: next.meta,
        future: s.future.slice(1),
        ts: 0,
      };
    }
    case "restore": {
      // Non-destructive: keep every version (including undone ones) in order,
      // then add the chosen one again as the newest step.
      const all = timeline(s);
      const target = all[a.index];
      if (!target || target.current) return s;
      const kept: Step[] = all.map(({ doc, meta }) => ({ doc, meta }));
      return {
        past: kept.slice(-HISTORY_LIMIT),
        present: target.doc,
        presentMeta: { at: Date.now(), label: `Went back to ${clock(target.meta.at)}`, by: "you" },
        future: [],
        ts: 0,
      };
    }
    case "external": {
      const by = byFromGroup(a.group);
      if (s.group === a.group) {
        const base = s.past.at(-1)?.doc ?? s.present;
        return {
          ...s,
          present: a.doc,
          presentMeta: { at: Date.now(), label: a.label ?? describeChange(base, a.doc, by), by },
          future: [],
          ts: 0,
        };
      }
      return {
        past: [...s.past, { doc: s.present, meta: s.presentMeta }].slice(-HISTORY_LIMIT),
        present: a.doc,
        presentMeta: { at: Date.now(), label: a.label ?? describeChange(s.present, a.doc, by), by },
        future: [],
        ts: 0,
        group: a.group,
      };
    }
    case "set": {
      const next =
        typeof a.updater === "function" ? (a.updater as (d: CompositorDoc) => CompositorDoc)(s.present) : a.updater;
      if (next === s.present) return s;
      const now = Date.now();
      if (s.ts !== 0 && now - s.ts < COALESCE_MS) {
        // coalesce into the current step, relabelled against what it started from
        const base = s.past.at(-1)?.doc ?? s.present;
        return { ...s, present: next, presentMeta: { at: now, label: a.label ?? describeChange(base, next, "you"), by: "you" }, ts: now };
      }
      return {
        past: [...s.past, { doc: s.present, meta: s.presentMeta }].slice(-HISTORY_LIMIT),
        present: next,
        presentMeta: { at: now, label: a.label ?? describeChange(s.present, next, "you"), by: "you" },
        future: [],
        ts: now,
      };
    }
  }
}

// ---------- plain-words labels ----------

/** "the title “SUNDAY”", "the video “Sermon edit”", "the sound “service”". */
export function pieceName(l: Layer): string {
  const kind = l.type === "text" ? "words" : l.type === "audio" ? "sound" : l.type === "image" ? "picture" : "video";
  const name = l.name || (l.type === "text" ? l.text : "");
  const short = name.length > 22 ? `${name.slice(0, 21)}…` : name;
  return short ? `the ${kind} “${short}”` : `a ${kind === "words" ? "piece of text" : kind}`;
}

function changedKeys(a: Layer, b: Layer): string[] {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].filter((k) => stable((a as Record<string, unknown>)[k]) !== stable((b as Record<string, unknown>)[k]));
}

function verbFor(keys: string[]): string {
  const k = new Set(keys);
  if (keys.every((x) => x === "x" || x === "y")) return "Moved";
  if (keys.every((x) => ["x", "y", "width", "height", "fontSize"].includes(x))) return "Resized";
  if (k.has("text") && keys.length === 1) return "Changed the words of";
  if (keys.every((x) => ["color", "backgroundColor", "borderColor"].includes(x))) return "Recoloured";
  if (keys.every((x) => ["from", "durationInFrames", "trimStart", "trimEnd"].includes(x))) return "Retimed";
  if (k.has("anim") && keys.length === 1) return "Changed how it comes in:";
  if (k.has("name") && keys.length === 1) return "Renamed";
  if (k.has("z") && keys.length === 1) return "Moved in front or behind:";
  return "Changed";
}

export function describeChange(prev: CompositorDoc, next: CompositorDoc, by: StepMeta["by"]): string {
  const who = by === "loso" ? "Loso " : "";
  const cap = (t: string) => (who ? who + t.charAt(0).toLowerCase() + t.slice(1) : t);
  if (by === "start") return "Started from a starting point";
  const before = new Map(prev.layers.map((l) => [l.id, l]));
  const after = new Map(next.layers.map((l) => [l.id, l]));
  const added = next.layers.filter((l) => !before.has(l.id));
  const removed = prev.layers.filter((l) => !after.has(l.id));
  const changed = next.layers.filter((l) => {
    const p = before.get(l.id);
    return p && stable(p) !== stable(l);
  });
  const outputChanged = stable(prev.output) !== stable(next.output);

  const parts: string[] = [];
  if (added.length === 1) parts.push(`Added ${pieceName(added[0])}`);
  else if (added.length > 1) parts.push(`Added ${added.length} things`);
  if (removed.length === 1) parts.push(`Removed ${pieceName(removed[0])}`);
  else if (removed.length > 1) parts.push(`Removed ${removed.length} things`);
  if (changed.length === 1 && !added.length && !removed.length) {
    const p = before.get(changed[0].id)!;
    const keys = changedKeys(p, changed[0]);
    const now = changed[0];
    if (keys.length === 1 && keys[0] === "text" && now.type === "text") {
      parts.push(`Changed the words to “${now.text.length > 22 ? `${now.text.slice(0, 21)}…` : now.text}”`);
    } else {
      parts.push(`${verbFor(keys)} ${pieceName(now)}`);
    }
  } else if (changed.length > 1) {
    parts.push(`Changed ${changed.length} things`);
  }
  if (outputChanged) {
    const shape = prev.output.width !== next.output.width || prev.output.height !== next.output.height;
    parts.push(shape ? "Changed the shape" : "Changed the video settings");
  }
  if (!parts.length) return cap(by === "outside" ? "Changed in another window" : "Small change");
  const text = parts.slice(0, 2).join(", ");
  return by === "outside" ? `${text} (another window)` : cap(text);
}
