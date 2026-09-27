"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Film, Layers, Plus, Trash2 } from "lucide-react";
import { Thumbnail } from "@remotion/player";
import { Button, ErrorState, Field, InlineError, Input, Select, Textarea, cx } from "@/components/ui";
import { fetchJson, jsonInit } from "@/lib/fetch-json";
import { LIVE_REQUIRED } from "@/lib/providers";
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
      aria-pressed={active}
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
  const [createError, setCreateError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  const words = script.trim() ? script.trim().split(/\s+/).length : 0;
  const isCompositor = kind === "compositor";

  const canCreate = (isCompositor || !!script.trim()) && !creating;

  async function create() {
    if (!canCreate) return;
    setCreating(true);
    setCreateError(null);
    const settings = isCompositor
      ? { kind, compositor: emptyCompositorDoc() }
      : { kind, pace, captionStyle };
    try {
      const d = await fetchJson<{ project: { id: string } }>(
        "/api/projects",
        jsonInit("POST", { title, script: isCompositor ? "" : script, settings })
      );
      router.push(`/project/${d.project.id}`);
    } catch (e) {
      setCreateError(`Couldn't create the project — ${(e as Error).message}`);
      setCreating(false);
    }
  }

  // Dialog behavior: Escape closes, Tab is trapped inside, ⌘/Ctrl+Enter
  // creates, and focus returns to whatever opened the dialog.
  const createRef = useRef(create);
  createRef.current = create;
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        createRef.current();
        return;
      }
      if (e.key !== "Tab" || !dialogRef.current) return;
      const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input, textarea, select, a[href], [tabindex]:not([tabindex="-1"])'
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      opener?.focus?.();
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6 backdrop-blur-[2px]"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-project-title"
        className="rise max-h-full w-full max-w-xl overflow-y-auto border border-line-strong bg-black shadow-[0_40px_120px_-30px_rgba(0,0,0,1)]"
      >
        <header className="border-b border-line px-7 pb-5 pt-6">
          <h2 id="new-project-title" className="font-serif text-[26px] italic tracking-tight">
            {isCompositor ? "New composition" : "New short"}
          </h2>
          <p className="mt-1 text-[13px] text-ink-dim">
            {isCompositor
              ? "A blank canvas — drop in video, images, and copy, then export."
              : "Paste the narration — Loso voices it and captions it word-for-word. Visuals are coming soon."}
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
                  placeholder="Every word will be voiced and captioned word-for-word…"
                  onChange={(e) => setScript(e.target.value)}
                />
              </Field>
              <div className="grid grid-cols-2 gap-8">
                <Field label="Pace" hint="applies when visuals ship">
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
        <footer className="flex items-center justify-end gap-3 border-t border-line px-7 py-4">
          {createError ? (
            <InlineError className="mr-auto" onDismiss={() => setCreateError(null)}>
              {createError}
            </InlineError>
          ) : (
            <span className="mr-auto hidden font-mono text-[10.5px] text-ink-faint sm:inline">
              ⌘↵ to create · esc to close
            </span>
          )}
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={create} disabled={!canCreate}>
            {creating ? "Creating…" : "Create"}
          </Button>
        </footer>
      </div>
    </div>
  );
}

const UNDO_MS = 6000;

export default function ProjectsPage() {
  const [projects, setProjects] = useState<ProjectListItem[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [missingCount, setMissingCount] = useState(0);
  // Deletes are deferred so they can be undone; the row is hidden meanwhile.
  const [pendingDelete, setPendingDelete] = useState<{ id: string; title: string } | null>(null);
  const deleteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<string | null>(null);

  const refresh = useCallback(() => {
    setLoadError(null);
    fetchJson<{ projects: ProjectListItem[] }>("/api/projects")
      .then((d) => setProjects(d.projects))
      .catch((e: Error) => setLoadError(e.message));
  }, []);

  useEffect(() => {
    refresh();
    fetchJson<{ keys: Array<{ id: string; set: boolean }> }>("/api/keys")
      .then((d) =>
        setMissingCount(LIVE_REQUIRED.filter((p) => !d.keys.find((k) => k.id === p.id)?.set).length)
      )
      .catch(() => setMissingCount(0));
  }, [refresh]);

  const commitDelete = useCallback(
    (id: string, keepalive = false) => {
      if (deleteTimer.current) clearTimeout(deleteTimer.current);
      deleteTimer.current = null;
      pendingRef.current = null;
      setPendingDelete(null);
      fetch(`/api/projects/${id}`, { method: "DELETE", keepalive })
        .then(() => !keepalive && refresh())
        .catch(() => {});
    },
    [refresh]
  );

  function remove(p: ProjectListItem) {
    if (pendingRef.current) commitDelete(pendingRef.current); // one pending at a time
    pendingRef.current = p.id;
    setPendingDelete({ id: p.id, title: p.title });
    deleteTimer.current = setTimeout(() => commitDelete(p.id), UNDO_MS);
  }

  function undoDelete() {
    if (deleteTimer.current) clearTimeout(deleteTimer.current);
    deleteTimer.current = null;
    pendingRef.current = null;
    setPendingDelete(null);
  }

  // Leaving the page (navigation or tab close) commits a pending delete.
  useEffect(() => {
    const flush = () => pendingRef.current && commitDelete(pendingRef.current, true);
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [commitDelete]);

  const visible = projects?.filter((p) => p.id !== pendingDelete?.id) ?? null;

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
          <em className="text-lime">Captioned short</em> out.
        </h1>
        <div
          className="rise mt-8 flex items-center gap-5"
          style={{ animationDelay: "140ms" }}
        >
          <Button onClick={() => setShowNew(true)}>
            <Plus size={15} /> New project
          </Button>
          {missingCount > 0 && (
            <Link
              href="/settings?tab=keys"
              className="text-[13px] text-ink-faint transition-colors hover:text-lime"
            >
              {missingCount} pipeline {missingCount === 1 ? "key" : "keys"} missing — finish setup →
            </Link>
          )}
        </div>
      </header>

      {loadError && (
        <ErrorState detail={`Your projects couldn't load (${loadError}).`} onRetry={refresh} />
      )}

      {!loadError && projects === null && (
        <p className="py-16 text-center text-sm text-ink-faint">Loading projects…</p>
      )}

      {/* Poster grid */}
      {visible !== null && visible.length > 0 && (
        <div className="grid grid-cols-2 gap-x-6 gap-y-10 pt-10 sm:grid-cols-3 md:grid-cols-4">
          {visible.map((p, i) => {
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
                  {isCompositor ? "compositor" : "ai short"}
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
                  aria-label={`Delete ${p.title}`}
                  title="Delete project"
                  className="absolute right-1.5 top-1.5 flex h-8 w-8 items-center justify-center bg-black/40 text-ink-dim opacity-0 transition-opacity hover:text-danger focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100"
                  onClick={(e) => {
                    e.preventDefault();
                    remove(p);
                  }}
                >
                  <Trash2 size={14} />
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

      {visible !== null && visible.length === 0 && (
        <div className="rise pt-10" style={{ animationDelay: "220ms" }}>
          <button
            onClick={() => setShowNew(true)}
            className="group flex w-56 flex-col justify-between border border-dashed border-line-strong p-4 text-left transition-colors hover:border-lime/70"
            style={{ aspectRatio: "9/16" }}
          >
            <span className="micro">01</span>
            <span>
              <span className="font-serif text-[18px] italic leading-snug text-ink-dim transition-colors group-hover:text-ink">
                Start with a script
                <br />
                — or a blank canvas.
              </span>
              <span className="mt-3 block text-[12px] text-ink-faint">
                Click to begin →
              </span>
            </span>
          </button>
        </div>
      )}

      {showNew && <NewProjectModal onClose={() => setShowNew(false)} />}

      {/* Undo toast for deferred deletes */}
      <div
        className={cx(
          "pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center pb-6 transition-all duration-300",
          pendingDelete ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0"
        )}
        aria-live="polite"
      >
        {pendingDelete && (
          <div className="pointer-events-auto flex items-center gap-4 border border-line-strong bg-black/90 py-2.5 pl-5 pr-2.5 backdrop-blur-md">
            <span className="max-w-[260px] truncate text-[13px] text-ink-dim">
              Deleted <span className="font-serif italic text-ink">{pendingDelete.title}</span>
            </span>
            <Button size="sm" onClick={undoDelete}>
              Undo
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
