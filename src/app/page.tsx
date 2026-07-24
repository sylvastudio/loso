"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Clapperboard, Plus, Trash2 } from "lucide-react";
import { Button, Field, Input, Select, Textarea } from "@/components/ui";

interface ProjectListItem {
  id: string;
  title: string;
  script: string;
  settings: { pace: string; captionStyle: string };
  updatedAt: number;
}

function timeAgo(ts: number) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function NewProjectModal({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [script, setScript] = useState("");
  const [pace, setPace] = useState("normal");
  const [captionStyle, setCaptionStyle] = useState("clean");
  const [creating, setCreating] = useState(false);

  const words = script.trim() ? script.trim().split(/\s+/).length : 0;

  async function create() {
    setCreating(true);
    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, script, settings: { pace, captionStyle } }),
    });
    const d = await res.json();
    router.push(`/project/${d.project.id}`);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="rise w-full max-w-xl rounded-2xl border border-line-strong bg-panel shadow-[0_30px_80px_-20px_rgba(0,0,0,0.9)]">
        <header className="border-b border-line px-6 py-4">
          <h2 className="font-display text-lg font-bold tracking-tight">New project</h2>
          <p className="mt-0.5 text-[13px] text-ink-dim">
            Paste your script — the studio handles voice, captions, and visuals.
          </p>
        </header>
        <div className="flex flex-col gap-4 p-6">
          <Field label="Title" hint="optional">
            <Input
              value={title}
              placeholder="Untitled project"
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
            />
          </Field>
          <Field label="Script" hint={`${words} words`}>
            <Textarea
              rows={7}
              value={script}
              placeholder={
                "Type or paste the narration for your short…\n\nEvery word will be voiced, captioned, and matched to visuals."
              }
              onChange={(e) => setScript(e.target.value)}
            />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Pace">
              <Select value={pace} onChange={(e) => setPace(e.target.value)}>
                <option value="chill">Chill · ~9s per shot</option>
                <option value="normal">Normal · ~6s per shot</option>
                <option value="fast">Fast · ~4.5s per shot</option>
                <option value="single">Single · never split</option>
              </Select>
            </Field>
            <Field label="Caption style">
              <Select value={captionStyle} onChange={(e) => setCaptionStyle(e.target.value)}>
                <option value="clean">Clean · smooth highlight</option>
                <option value="dynamic">Dynamic · word pop-in</option>
              </Select>
            </Field>
          </div>
        </div>
        <footer className="flex justify-end gap-2 border-t border-line px-6 py-4">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={create} disabled={!script.trim() || creating}>
            {creating ? "Creating…" : "Create project"}
          </Button>
        </footer>
      </div>
    </div>
  );
}

export default function ProjectsPage() {
  const [projects, setProjects] = useState<ProjectListItem[] | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [keysMissing, setKeysMissing] = useState(false);

  function refresh() {
    fetch("/api/projects")
      .then((r) => r.json())
      .then((d) => setProjects(d.projects));
  }

  useEffect(() => {
    refresh();
    fetch("/api/keys")
      .then((r) => r.json())
      .then((d) =>
        setKeysMissing(
          d.keys.filter((k: { id: string; set: boolean }) => k.id !== "serpapi" && !k.set)
            .length > 0
        )
      );
  }, []);

  async function remove(id: string) {
    await fetch(`/api/projects/${id}`, { method: "DELETE" });
    refresh();
  }

  return (
    <div className="mx-auto max-w-5xl px-8 pb-20 pt-10">
      <header className="mb-8 flex items-end justify-between">
        <div>
          <p className="mb-1 font-mono text-[11px] uppercase tracking-[0.2em] text-amber">
            Script in · branded short out
          </p>
          <h1 className="font-display text-3xl font-bold tracking-tight">Projects</h1>
        </div>
        <Button onClick={() => setShowNew(true)}>
          <Plus size={16} /> New project
        </Button>
      </header>

      {keysMissing && (
        <Link
          href="/settings"
          className="mb-6 flex items-center justify-between rounded-xl border border-amber/25 bg-amber/5 px-5 py-3.5 transition-colors hover:bg-amber/10"
        >
          <p className="text-sm text-ink-dim">
            <span className="font-medium text-amber">Finish setup —</span> some pipeline
            keys are missing. The studio runs in a degraded mode until they&apos;re added.
          </p>
          <span className="text-sm text-amber">Open Settings →</span>
        </Link>
      )}

      {projects === null ? null : projects.length === 0 ? (
        <button
          onClick={() => setShowNew(true)}
          className="rise group mx-auto mt-10 flex w-full max-w-md flex-col items-center gap-5 rounded-2xl border border-dashed border-line-strong px-8 py-14 transition-colors hover:border-amber/50"
        >
          <div className="ticks relative flex aspect-[9/16] w-28 items-center justify-center rounded-xl border border-line-strong bg-panel">
            <Clapperboard
              size={22}
              className="text-ink-faint transition-colors group-hover:text-amber"
            />
            <span className="absolute inset-x-3 bottom-3 h-1 rounded bg-line" />
            <span className="absolute inset-x-3 bottom-5 h-1 w-2/3 rounded bg-line" />
          </div>
          <div className="text-center">
            <p className="font-display text-lg font-semibold">Make your first short</p>
            <p className="mt-1 max-w-xs text-sm text-ink-dim">
              Paste a script and Reelsmith voices it, captions it word-for-word, and cuts
              visuals to the beat.
            </p>
          </div>
        </button>
      ) : (
        <div className="grid grid-cols-1 gap-3">
          {projects.map((p, i) => (
            <Link
              key={p.id}
              href={`/project/${p.id}`}
              className="rise group flex items-center gap-5 rounded-xl border border-line bg-panel p-4 transition-colors hover:border-amber/40"
              style={{ animationDelay: `${i * 50}ms` }}
            >
              <div className="ticks flex aspect-[9/16] w-12 shrink-0 items-center justify-center rounded-md border border-line bg-inset">
                <Clapperboard size={13} className="text-ink-faint group-hover:text-amber" />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="truncate font-display text-[15px] font-semibold tracking-tight">
                  {p.title}
                </h3>
                <p className="mt-0.5 truncate text-[13px] text-ink-faint">
                  {p.script.slice(0, 120) || "No script yet"}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-4">
                <span className="font-mono text-[11px] uppercase tracking-wider text-ink-faint">
                  {p.settings.pace} · {p.settings.captionStyle}
                </span>
                <span className="font-mono text-[11px] text-ink-faint">
                  {timeAgo(p.updatedAt)}
                </span>
                <button
                  className="rounded-md p-2 text-ink-faint opacity-0 transition-all hover:bg-danger/10 hover:text-danger group-hover:opacity-100"
                  onClick={(e) => {
                    e.preventDefault();
                    remove(p.id);
                  }}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </Link>
          ))}
        </div>
      )}

      {showNew && <NewProjectModal onClose={() => setShowNew(false)} />}
    </div>
  );
}
