"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, AudioLines, Clapperboard, Wand2 } from "lucide-react";
import { Button, Field, Select, Textarea } from "@/components/ui";

interface Project {
  id: string;
  title: string;
  script: string;
  settings: { pace: string; captionStyle: string; voiceId: string | null };
}

export default function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [project, setProject] = useState<Project | null>(null);
  const [savedScript, setSavedScript] = useState("");

  useEffect(() => {
    fetch(`/api/projects/${id}`)
      .then((r) => r.json())
      .then((d) => {
        setProject(d.project);
        setSavedScript(d.project?.script ?? "");
      });
  }, [id]);

  async function persist(patch: Partial<Project>) {
    const res = await fetch(`/api/projects/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const d = await res.json();
    setProject(d.project);
    if (patch.script !== undefined) setSavedScript(d.project.script);
  }

  if (!project) {
    return <p className="py-24 text-center text-sm text-ink-faint">Loading project…</p>;
  }

  const chars = project.script.length;

  return (
    <div className="flex h-full flex-col">
      {/* Editor top bar */}
      <header className="flex h-14 shrink-0 items-center gap-4 border-b border-line bg-panel px-5">
        <Link
          href="/"
          className="flex items-center gap-1.5 text-[13px] text-ink-dim transition-colors hover:text-ink"
        >
          <ArrowLeft size={14} /> Projects
        </Link>
        <span className="h-4 w-px bg-line-strong" />
        <h1 className="truncate font-display text-[15px] font-semibold tracking-tight">
          {project.title}
        </h1>
        <div className="flex-1" />
        <Button size="sm" disabled title="Arrives with Milestone 2">
          <Wand2 size={14} /> Generate voiceover
        </Button>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Script panel */}
        <div className="flex w-[340px] shrink-0 flex-col gap-4 overflow-y-auto border-r border-line p-5">
          <Field label="Script" hint={`${chars} chars (raw)`}>
            <Textarea
              rows={12}
              value={project.script}
              onChange={(e) => setProject({ ...project, script: e.target.value })}
              onBlur={() => {
                if (project.script !== savedScript) persist({ script: project.script });
              }}
            />
          </Field>
          <p className="-mt-2 text-[11px] leading-relaxed text-ink-faint">
            The normalized character count (numbers &amp; symbols expanded for speech) will
            appear here in M2, checked against the ~3,000-char voiceover cap.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Pace">
              <Select
                value={project.settings.pace}
                onChange={(e) =>
                  persist({ settings: { ...project.settings, pace: e.target.value } })
                }
              >
                <option value="chill">Chill</option>
                <option value="normal">Normal</option>
                <option value="fast">Fast</option>
                <option value="single">Single</option>
              </Select>
            </Field>
            <Field label="Captions">
              <Select
                value={project.settings.captionStyle}
                onChange={(e) =>
                  persist({
                    settings: { ...project.settings, captionStyle: e.target.value },
                  })
                }
              >
                <option value="clean">Clean</option>
                <option value="dynamic">Dynamic</option>
              </Select>
            </Field>
          </div>
        </div>

        {/* Preview stage */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex flex-1 items-center justify-center p-6">
            <div className="relative flex aspect-[9/16] h-full max-h-[520px] items-center justify-center rounded-2xl border border-line-strong bg-inset shadow-[0_20px_60px_-20px_rgba(0,0,0,0.8)]">
              <div className="pointer-events-none absolute inset-x-[8%] inset-y-[6%] rounded-lg border border-dashed border-white/8" />
              <div className="flex flex-col items-center gap-3 px-8 text-center">
                <AudioLines size={22} className="text-ink-faint" />
                <p className="text-[13px] leading-relaxed text-ink-faint">
                  The Remotion preview lights up in{" "}
                  <span className="text-ink-dim">Milestone 2</span> — voiceover +
                  word-synced captions.
                </p>
              </div>
            </div>
          </div>

          {/* Timeline strip */}
          <div className="ticks h-24 shrink-0 border-t border-line bg-panel/60 px-5">
            <div className="flex h-full items-center gap-2 opacity-50">
              {[...Array(5)].map((_, i) => (
                <div
                  key={i}
                  className="flex h-14 w-24 items-center justify-center rounded-md border border-dashed border-line-strong bg-inset"
                >
                  <Clapperboard size={12} className="text-ink-faint" />
                </div>
              ))}
              <span className="ml-3 font-mono text-[11px] uppercase tracking-wider text-ink-faint">
                Timeline · M3
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
