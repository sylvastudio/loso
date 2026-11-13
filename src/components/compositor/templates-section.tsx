"use client";

import { useCallback, useEffect, useState } from "react";
import { LayoutTemplate, Trash2 } from "lucide-react";
import { InlineError } from "@/components/ui";
import type { CompositorDoc } from "@/lib/compositor";
import type { TemplateBackend, TemplateInfo } from "./backend";

// Left-rail section ("Starting points"): apply a saved design, or save this
// video as one. Applying needs no "are you sure": it's a new version, and
// Versions can always go back. Slots (the parts that change per video) are
// marked per piece in "More controls" — or by the agent.
export function TemplatesSection({
  templates: backend,
  doc,
  beforeApply,
  onApplied,
}: {
  templates: TemplateBackend;
  doc: CompositorDoc;
  beforeApply: () => Promise<boolean>;
  onApplied: (doc: CompositorDoc, name: string) => void;
}) {
  const [templates, setTemplates] = useState<TemplateInfo[] | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const load = useCallback(() => {
    backend
      .list()
      .then(setTemplates)
      .catch((e: Error) => setError(e.message));
  }, [backend]);
  useEffect(load, [load]);

  async function apply(t: TemplateInfo) {
    setError(null);
    if (!(await beforeApply())) return setError("Couldn't save your changes first. Try again.");
    try {
      onApplied(await backend.apply(t.id), t.name);
      setFlash(`Started from “${t.name}”. Versions can take you back.`);
      setTimeout(() => setFlash(null), 4000);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function save() {
    if (!name.trim()) return;
    setError(null);
    try {
      const d = await backend.save(name.trim(), doc);
      setName("");
      setSaving(false);
      setFlash(`Saved “${d.name}” as a starting point`);
      setTimeout(() => setFlash(null), 4000);
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const slotCount = doc.layers.filter((l) => l.slot).length;

  return (
    <section aria-labelledby="start-h" className="flex flex-col gap-2.5">
      <h2 id="start-h" className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-dim">
        Starting points
      </h2>
      <ul className="flex flex-col border-t border-line">
        {templates?.map((t) => (
          <li key={t.id} className="flex items-center gap-1 border-b border-line">
            {confirmDelete === t.id ? (
              <span className="flex min-h-10 flex-1 items-center gap-3 text-[13px] text-ink" role="group" aria-label={`Delete ${t.name}?`}>
                Delete “{t.name}”?
                <button
                  type="button"
                  onClick={async () => {
                    await backend.remove(t.id);
                    setConfirmDelete(null);
                    load();
                  }}
                  className="min-h-10 text-danger hover:underline"
                >
                  Delete
                </button>
                <button type="button" autoFocus onClick={() => setConfirmDelete(null)} className="min-h-10 text-ink-dim hover:text-ink">
                  Keep
                </button>
              </span>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => apply(t)}
                  title={t.description}
                  className="group flex min-h-10 min-w-0 flex-1 items-center gap-2.5 text-left text-[13.5px] text-ink transition-colors hover:text-lime"
                >
                  <LayoutTemplate size={14} className="shrink-0 text-ink-dim group-hover:text-lime" aria-hidden />
                  <span className="min-w-0 flex-1 truncate">{t.name}</span>
                </button>
                {!t.builtin && (
                  <button
                    type="button"
                    aria-label={`Delete starting point ${t.name}`}
                    onClick={() => setConfirmDelete(t.id)}
                    className="flex h-8 w-8 shrink-0 items-center justify-center text-ink-dim opacity-60 transition-opacity hover:text-danger hover:opacity-100 focus-visible:opacity-100"
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </>
            )}
          </li>
        ))}
      </ul>
      {saving ? (
        <div className="flex items-center gap-2">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") save();
              if (e.key === "Escape") setSaving(false);
            }}
            placeholder="Name it"
            aria-label="Name for this starting point"
            className="uline !py-1 text-[13.5px]"
          />
          <button type="button" onClick={save} disabled={!name.trim()} className="min-h-10 text-[13px] text-lime disabled:opacity-40">
            Save
          </button>
        </div>
      ) : (
        <button
          type="button"
          disabled={!doc.layers.length}
          onClick={() => setSaving(true)}
          className="min-h-10 self-start text-[13px] text-ink-dim transition-colors hover:text-lime disabled:opacity-40"
        >
          + Save this video as a starting point
        </button>
      )}
      {saving && (
        <p className="text-[12.5px] leading-relaxed text-ink-dim">
          {slotCount
            ? `${slotCount} piece${slotCount === 1 ? "" : "s"} marked to change every video.`
            : "Tip: in a piece's More controls, name the parts that change every video (title, date, main clip)."}
        </p>
      )}
      <p role="status" className="text-[12.5px] text-lime">{flash ?? ""}</p>
      {error && <InlineError onDismiss={() => setError(null)}>{error}</InlineError>}
    </section>
  );
}
