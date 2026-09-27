"use client";

import { useCallback, useEffect, useState } from "react";
import { LayoutTemplate, Trash2 } from "lucide-react";
import { InlineError, cx } from "@/components/ui";
import { fetchJson, jsonInit } from "@/lib/fetch-json";
import type { CompositorDoc } from "@/lib/compositor";

interface TemplateInfo {
  id: string;
  name: string;
  description: string;
  builtin: boolean;
  width: number;
  height: number;
  slots: Array<{ name: string; kind: string }>;
}

// Left-rail section: apply a saved design, or save this canvas as one.
// Slots (the parts that change per video) are marked per layer in the
// inspector's "Slot" field — or by the agent.
export function TemplatesSection({
  projectId,
  doc,
  beforeApply,
  onApplied,
}: {
  projectId: string;
  doc: CompositorDoc;
  beforeApply: () => Promise<boolean>;
  onApplied: (doc: CompositorDoc) => void;
}) {
  const [templates, setTemplates] = useState<TemplateInfo[] | null>(null);
  const [armed, setArmed] = useState<string | null>(null); // two-step "replace canvas?"
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const load = useCallback(() => {
    fetchJson<{ templates: TemplateInfo[] }>("/api/templates")
      .then((d) => setTemplates(d.templates))
      .catch((e: Error) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(null), 4000);
    return () => clearTimeout(t);
  }, [armed]);

  async function apply(t: TemplateInfo) {
    if (doc.layers.length && armed !== t.id) {
      setArmed(t.id);
      return;
    }
    setArmed(null);
    setError(null);
    if (!(await beforeApply())) return setError("Couldn't save your edits first — try again.");
    try {
      const d = await fetchJson<{ doc: CompositorDoc }>("/api/templates/apply", jsonInit("POST", { projectId, templateId: t.id }));
      onApplied(d.doc);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function save() {
    if (!name.trim()) return;
    setError(null);
    try {
      const d = await fetchJson<{ template: { name: string; slots: unknown[] } }>(
        "/api/templates",
        jsonInit("POST", { name: name.trim(), doc })
      );
      setName("");
      setSaving(false);
      setFlash(`Saved “${d.template.name}” · ${d.template.slots.length} slot${d.template.slots.length === 1 ? "" : "s"}`);
      setTimeout(() => setFlash(null), 2500);
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const slotCount = doc.layers.filter((l) => l.slot).length;

  return (
    <div className="flex flex-col gap-2 border-t border-line pt-5">
      <span className="micro">Templates</span>
      {templates?.map((t) => (
        <div key={t.id} className="group flex items-center gap-2">
          <button
            type="button"
            onClick={() => apply(t)}
            title={t.description}
            className={cx(
              "flex min-w-0 flex-1 items-center gap-2 rounded-md border px-2.5 py-1.5 text-left text-[12.5px] transition-colors",
              armed === t.id ? "border-danger/60 text-danger" : "border-line text-ink-dim hover:border-lime/60 hover:text-ink"
            )}
          >
            <LayoutTemplate size={13} className="shrink-0" />
            <span className="min-w-0 flex-1 truncate">{armed === t.id ? "Replace this canvas?" : t.name}</span>
            <span className="shrink-0 font-mono text-[10px] text-ink-faint">
              {armed === t.id ? "click again" : `${t.width}×${t.height}`}
            </span>
          </button>
          {!t.builtin && (
            <button
              type="button"
              aria-label={`Delete template ${t.name}`}
              onClick={async () => {
                await fetch(`/api/templates?id=${t.id}`, { method: "DELETE" });
                load();
              }}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-ink-faint opacity-0 transition-opacity hover:text-danger group-hover:opacity-100 focus-visible:opacity-100"
            >
              <Trash2 size={12} />
            </button>
          )}
        </div>
      ))}
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
            placeholder="Template name"
            aria-label="Template name"
            className="uline !py-1 text-[12.5px]"
          />
          <button type="button" onClick={save} disabled={!name.trim()} className="text-[12px] text-lime disabled:opacity-40">
            Save
          </button>
        </div>
      ) : (
        <button
          type="button"
          disabled={!doc.layers.length}
          onClick={() => setSaving(true)}
          className="self-start text-[12px] text-ink-faint transition-colors hover:text-lime disabled:opacity-40"
        >
          + Save this canvas as a template
        </button>
      )}
      {saving && (
        <p className="text-[11px] leading-relaxed text-ink-faint">
          {slotCount
            ? `${slotCount} layer${slotCount === 1 ? "" : "s"} marked as slots — they change per video.`
            : "Tip: mark the parts that change per video (title, date, main video) with the Slot field in the Layer tab."}
        </p>
      )}
      {flash && <p className="text-[11.5px] text-lime">{flash}</p>}
      {error && <InlineError onDismiss={() => setError(null)}>{error}</InlineError>}
    </div>
  );
}
