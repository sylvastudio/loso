"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Film, Layers, Plus, Trash2 } from "lucide-react";
import { Thumbnail } from "@remotion/player";
import { Button, Field, Input, Select, Textarea, cx } from "@/components/ui";
import { CompositorComposition } from "@/remotion/compositor";
import {
  compositorDocSchema,
  emptyCompositorDoc,
  resolveDocForBrowser,
  type CompositorDoc,
} from "@/lib/compositor";

interface ProjectListItem {
  id: string;
  title: string;
  script: string;
  settings: { kind?: string; pace: string; captionStyle: string; compositor?: CompositorDoc };
  artifacts: { transcript?: { durationSec: number }; render?: { renderedAt: number } };
  updatedAt: number;
}

// Live poster: renders a single representative frame of a compositor project
// (past its intro animation) right in the card. Returns null when there's
// nothing to show, so the caller can fall back to a text poster.
function ProjectThumb({ project }: { project: ProjectListItem }) {
  if (project.settings.kind !== "compositor") return null;
  const parsed = compositorDocSchema.safeParse(project.settings.compositor);
  if (!parsed.success || parsed.data.layers.length === 0) return null;
  const doc = parsed.data;
  const resolved = resolveDocForBrowser(doc);
  const total = Math.max(1, doc.output.durationInFrames);
  return (
    <Thumbnail
      component={CompositorComposition}
      inputProps={{ doc: resolved }}
      durationInFrames={total}
      fps={doc.output.fps}
      compositionWidth={doc.output.width}
      compositionHeight={doc.output.height}
      frameToDisplay={Math.min(total - 1, Math.round(total * 0.55))}
      style={{ width: "100%", height: "100%" }}
      errorFallback={() => null}
    />
  );
}

function timeAgo(ts: number) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function ModeCard({
  active,
  icon: Icon,
  title,
  desc,
  onClick,
}: {
  active: boolean;
  icon: typeof Film;
  title: string;
  desc: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        "flex flex-col gap-2 rounded-lg border p-4 text-left transition-colors",
        active ? "border-lime bg-lime/5" : "border-line hover:border-line-strong"
      )}
    >
      <Icon size={18} className={active ? "text-lime" : "text-ink-dim"} />
      <span className={cx("text-[14px]", active ? "text-ink" : "text-ink-dim")}>{title}</span>
      <span className="text-[11.5px] leading-snug text-ink-faint">{desc}</span>
    </button>
  );
}

function NewProjectModal({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [kind, setKind] = useState<"ai-short" | "compositor">("ai-short");
  const [title, setTitle] = useState("");
  const [script, setScript] = useState("");
  const [pace, setPace] = useState("normal");
  const [captionStyle, setCaptionStyle] = useState("clean");
  const [creating, setCreating] = useState(false);

  const words = script.trim() ? script.trim().split(/\s+/).length : 0;
  const isCompositor = kind === "compositor";

  async function create() {
    setCreating(true);
    const settings = isCompositor
      ? { kind, compositor: emptyCompositorDoc() }
      : { kind, pace, captionStyle };
    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, script: isCompositor ? "" : script, settings }),
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
          <h2 className="font-serif text-[26px] italic tracking-tight">
            {isCompositor ? "New composition" : "New short"}
          </h2>
          <p className="mt-1 text-[13px] text-ink-dim">
            {isCompositor
              ? "A blank canvas — drop in video, images, and copy, then export."
              : "Paste the narration — Loso voices it, captions it, and cuts visuals to the beat."}
          </p>
        </header>
        <div className="flex flex-col gap-6 px-7 py-6">
          {/* mode toggle */}
          <div className="grid grid-cols-2 gap-3">
            <ModeCard
              active={kind === "ai-short"}
              icon={Film}
              title="AI short"
              desc="Script → voiceover → captions"
              onClick={() => setKind("ai-short")}
            />
            <ModeCard
              active={kind === "compositor"}
              icon={Layers}
              title="Compositor"
              desc="Manual drag & drop canvas"
              onClick={() => setKind("compositor")}
            />
          </div>

          <Field label="Title" hint="optional">
            <Input
              value={title}
              placeholder={isCompositor ? "Untitled composition" : "Untitled short"}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
            />
          </Field>

          {!isCompositor && (
            <>
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
            </>
          )}
        </div>
        <footer className="flex justify-end gap-3 border-t border-line px-7 py-4">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={create} disabled={(!isCompositor && !script.trim()) || creating}>
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
          {projects.map((p, i) => {
            const isCompositor = p.settings.kind === "compositor";
            const doc = isCompositor
              ? compositorDocSchema.safeParse(p.settings.compositor)
              : null;
            const hasThumb = doc?.success && doc.data.layers.length > 0;
            const aspect = hasThumb
              ? `${doc!.data.output.width} / ${doc!.data.output.height}`
              : "9 / 16";
            return (
            <Link
              key={p.id}
              href={`/project/${p.id}`}
              className="rise group"
              style={{ animationDelay: `${i * 40}ms` }}
            >
              <div
                className="relative flex flex-col justify-between overflow-hidden border border-line bg-void transition-colors duration-200 group-hover:border-lime/70"
                style={{ aspectRatio: aspect }}
              >
                {/* live composition frame */}
                {hasThumb && (
                  <div className="pointer-events-none absolute inset-0">
                    <ProjectThumb project={p} />
                  </div>
                )}
                {/* scrim for legibility over the thumbnail */}
                {hasThumb && (
                  <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/75 via-transparent to-black/25" />
                )}

                <p className={cx("micro relative", hasThumb ? "m-3 text-ink/85" : "m-4")}>
                  {isCompositor ? "compositor" : p.settings.pace}
                </p>
                {!hasThumb && (
                  <p className="relative m-4 mt-0 font-serif text-[17px] italic leading-snug tracking-tight text-ink">
                    {p.title}
                  </p>
                )}
                {hasThumb && (
                  <p className="relative m-3 mt-0 font-serif text-[14px] italic leading-snug tracking-tight text-ink drop-shadow-[0_1px_4px_rgba(0,0,0,0.9)]">
                    {p.title}
                  </p>
                )}
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
                  {p.settings.kind === "compositor"
                    ? p.artifacts?.render
                      ? "exported"
                      : "draft"
                    : p.artifacts?.transcript
                      ? `${p.artifacts.transcript.durationSec.toFixed(0)}s voiced`
                      : "draft"}
                </span>
                <span className="font-mono text-[10.5px] text-ink-faint">{timeAgo(p.updatedAt)}</span>
              </div>
            </Link>
            );
          })}
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
