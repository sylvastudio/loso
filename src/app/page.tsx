"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Plus, Trash2 } from "lucide-react";
import { Button, Field, Input, Select, Textarea } from "@/components/ui";

interface ProjectListItem {
  id: string;
  title: string;
  script: string;
  settings: { pace: string; captionStyle: string };
  artifacts: { transcript?: { durationSec: number } };
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6 backdrop-blur-[2px]"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="rise w-full max-w-xl border border-line-strong bg-black shadow-[0_40px_120px_-30px_rgba(0,0,0,1)]">
        <header className="border-b border-line px-7 pb-5 pt-6">
          <h2 className="font-serif text-[26px] italic tracking-tight">New short</h2>
          <p className="mt-1 text-[13px] text-ink-dim">
            Paste the narration — Sylva voices it, captions it, and cuts visuals to the beat.
          </p>
        </header>
        <div className="flex flex-col gap-6 px-7 py-6">
          <Field label="Title" hint="optional">
            <Input
              value={title}
              placeholder="Untitled short"
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
            />
          </Field>
          <Field label="Script" hint={`${words} words`}>
            <Textarea
              rows={7}
              value={script}
              placeholder="Every word will be voiced, captioned word-for-word, and matched to visuals…"
              onChange={(e) => setScript(e.target.value)}
            />
          </Field>
          <div className="grid grid-cols-2 gap-8">
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
        <footer className="flex justify-end gap-3 border-t border-line px-7 py-4">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={create} disabled={!script.trim() || creating}>
            {creating ? "Creating…" : "Create"}
          </Button>
        </footer>
      </div>
    </div>
  );
}

export default function ProjectsPage() {
  const [projects, setProjects] = useState<ProjectListItem[] | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [missingCount, setMissingCount] = useState(0);

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
        setMissingCount(
          d.keys.filter((k: { id: string; set: boolean }) => k.id !== "serpapi" && !k.set).length
        )
      );
  }, []);

  async function remove(id: string) {
    await fetch(`/api/projects/${id}`, { method: "DELETE" });
    refresh();
  }

  return (
    <div className="mx-auto max-w-5xl px-8 pb-24">
      {/* Editorial hero */}
      <header className="border-b border-line pb-10 pt-14">
        <p className="micro rise mb-4">Faceless short-video studio</p>
        <h1
          className="rise font-serif text-[clamp(40px,6vw,68px)] font-light leading-[1.02] tracking-[-0.02em]"
          style={{ animationDelay: "60ms" }}
        >
          Script in.
          <br />
          <em className="text-lime">Branded short</em> out.
        </h1>
        <div
          className="rise mt-8 flex items-center gap-5"
          style={{ animationDelay: "140ms" }}
        >
          <Button onClick={() => setShowNew(true)}>
            <Plus size={15} /> New short
          </Button>
          {missingCount > 0 && (
            <Link
              href="/settings"
              className="text-[13px] text-ink-faint transition-colors hover:text-lime"
            >
              {missingCount} pipeline {missingCount === 1 ? "key" : "keys"} missing — finish setup →
            </Link>
          )}
        </div>
      </header>

      {/* Poster grid */}
      {projects !== null && projects.length > 0 && (
        <div className="grid grid-cols-2 gap-x-6 gap-y-10 pt-10 sm:grid-cols-3 md:grid-cols-4">
          {projects.map((p, i) => (
            <Link
              key={p.id}
              href={`/project/${p.id}`}
              className="rise group"
              style={{ animationDelay: `${i * 40}ms` }}
            >
              <div className="relative flex aspect-[9/16] flex-col justify-between overflow-hidden border border-line bg-panel p-4 transition-colors duration-200 group-hover:border-lime/70">
                <p className="micro">{p.settings.pace}</p>
                <p className="font-serif text-[17px] italic leading-snug tracking-tight text-ink">
                  {p.title}
                </p>
                <button
                  className="absolute right-2.5 top-2.5 p-1 text-ink-faint opacity-0 transition-opacity hover:text-danger group-hover:opacity-100"
                  onClick={(e) => {
                    e.preventDefault();
                    remove(p.id);
                  }}
                >
                  <Trash2 size={13} />
                </button>
              </div>
              <div className="mt-2 flex items-baseline justify-between">
                <span className="text-[11.5px] text-ink-faint">
                  {p.artifacts?.transcript
                    ? `${p.artifacts.transcript.durationSec.toFixed(0)}s voiced`
                    : "draft"}
                </span>
                <span className="font-mono text-[10.5px] text-ink-faint">{timeAgo(p.updatedAt)}</span>
              </div>
            </Link>
          ))}
        </div>
      )}

      {projects !== null && projects.length === 0 && (
        <div className="rise pt-10" style={{ animationDelay: "220ms" }}>
          <button
            onClick={() => setShowNew(true)}
            className="group flex w-56 flex-col justify-between border border-dashed border-line-strong p-4 text-left transition-colors hover:border-lime/70"
            style={{ aspectRatio: "9/16" }}
          >
            <span className="micro">01</span>
            <span>
              <span className="font-serif text-[18px] italic leading-snug text-ink-dim transition-colors group-hover:text-ink">
                Your first short
                <br />
                starts with a script.
              </span>
              <span className="mt-3 block text-[12px] text-ink-faint">
                Click to begin →
              </span>
            </span>
          </button>
        </div>
      )}

      {showNew && <NewProjectModal onClose={() => setShowNew(false)} />}
    </div>
  );
}
