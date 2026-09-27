"use client";

import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Player } from "@remotion/player";
import { ArrowLeft, Pause, Play, Sparkles } from "lucide-react";
import { Button, ErrorState, Field, InlineError, Select, Textarea, cx } from "@/components/ui";
import { FetchError, fetchJson, jsonInit } from "@/lib/fetch-json";
import { EditableTitle, NarrowScreenNote, SaveStatus, type SaveState } from "@/components/editor-chrome";
import { FontLoader } from "@/components/font-loader";
import { ShortComposition, SHORT_FPS } from "@/remotion/short";
import { CompositorEditor } from "@/components/compositor/editor";
import { groupWords, type Word } from "@/lib/captions";
import type { Brand } from "@/lib/brand";

interface VoiceOption {
  voiceId: string;
  name: string;
  category: string;
  previewUrl: string | null;
}

interface Project {
  id: string;
  title: string;
  script: string;
  settings: {
    pace: string;
    captionStyle: "clean" | "dynamic";
    voiceId: string | null;
    voice?: { stability: number; similarity: number; style: number; speed: number };
  };
  artifacts: {
    voiceover?: { assetHash: string; voiceId: string; normalizedChars: number; scriptHash: string };
    transcript?: { words: Word[]; durationSec: number };
  };
}

const DEFAULT_SLIDERS = { stability: 0.5, similarity: 0.75, style: 0.3, speed: 1.0 };
const LEAD_IN_SEC = 0.35;

type Stage = "idle" | "voice" | "sync";

function SliderRow({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="micro w-[72px] shrink-0">{label}</span>
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1"
      />
      <span className="w-9 text-right font-mono text-[11px] text-ink-dim">
        {value.toFixed(2)}
      </span>
    </div>
  );
}

export default function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [route, setRoute] = useState<{ kind: string; project: RawProject } | null>(null);
  const [failure, setFailure] = useState<{ notFound: boolean; message: string } | null>(null);

  const load = useCallback(() => {
    setFailure(null);
    fetchJson<{ project: RawProject }>(`/api/projects/${id}`)
      .then((d) => setRoute({ kind: d.project.settings?.kind ?? "ai-short", project: d.project }))
      .catch((e: FetchError) => setFailure({ notFound: e.status === 404, message: e.message }));
  }, [id]);

  useEffect(load, [load]);

  if (failure) {
    const back = (
      <Link href="/" className="text-[13px] text-ink-dim transition-colors hover:text-lime">
        ← All projects
      </Link>
    );
    return failure.notFound ? (
      <ErrorState
        title="This project no longer exists"
        detail="It may have been deleted, or the link is mistyped."
      >
        {back}
      </ErrorState>
    ) : (
      <ErrorState detail={`The project couldn't load (${failure.message}).`} onRetry={load}>
        {back}
      </ErrorState>
    );
  }
  if (!route) {
    return <p className="py-24 text-center text-sm text-ink-faint">Loading…</p>;
  }
  if (route.kind === "compositor") {
    return <CompositorEditor project={route.project} />;
  }
  return <AiShortEditor id={id} />;
}

interface RawProject {
  id: string;
  title: string;
  updatedAt: number;
  settings: { kind?: string; compositor?: import("@/lib/compositor").CompositorDoc };
  artifacts: { render?: { url: string; renderedAt: number } };
}

function AiShortEditor({ id }: { id: string }) {
  const [project, setProject] = useState<Project | null>(null);
  const [brand, setBrand] = useState<Brand | null>(null);
  const [voices, setVoices] = useState<VoiceOption[] | null>(null);
  const [voicesError, setVoicesError] = useState<string | null>(null);
  const [normalized, setNormalized] = useState<{ count: number; limit: number } | null>(null);
  const [stage, setStage] = useState<Stage>("idle");
  const [error, setError] = useState<string | null>(null);
  const [previewingVoice, setPreviewingVoice] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [keys, setKeys] = useState<Record<string, boolean> | null>(null);
  const [transcriber, setTranscriber] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const previewAudio = useRef<HTMLAudioElement | null>(null);
  const scriptRef = useRef("");

  const load = useCallback(() => {
    setLoadError(null);
    Promise.all([
      fetchJson<{ project: Project }>(`/api/projects/${id}`),
      fetchJson<{ brand: Brand }>("/api/brand"),
    ])
      .then(([p, b]) => {
        setProject(p.project);
        scriptRef.current = p.project.script ?? "";
        setBrand(b.brand);
      })
      .catch((e: Error) => setLoadError(e.message));
    fetchJson<{ keys: Array<{ id: string; set: boolean }> }>("/api/keys")
      .then((d) => setKeys(Object.fromEntries(d.keys.map((k) => [k.id, k.set]))))
      .catch(() => setKeys(null));
    fetchJson<{ transcription?: { engine: string } }>("/api/ai/config")
      .then((d) => setTranscriber(d.transcription?.engine ?? null))
      .catch(() => setTranscriber(null));
    fetchJson<{ voices: VoiceOption[] }>("/api/voices")
      .then((d) => setVoices(d.voices))
      .catch((e: FetchError) =>
        setVoicesError(e.body.error === "missing_key" ? "missing_key" : e.message)
      );
  }, [id]);

  useEffect(load, [load]);

  // Debounced normalized-character meter
  useEffect(() => {
    if (project === null) return;
    const t = setTimeout(() => {
      fetch("/api/normalize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: project.script }),
      })
        .then((r) => r.json())
        .then((d) => setNormalized({ count: d.count, limit: d.limit }))
        .catch(() => {});
    }, 350);
    return () => clearTimeout(t);
  }, [project?.script, project === null]);

  const patchLocal = useCallback((p: Partial<Project>) => {
    setProject((prev) => (prev ? { ...prev, ...p } : prev));
  }, []);

  // Server-side save; returns the saved project (or null on failure) and
  // drives the header save indicator.
  const persist = useCallback(
    async (patch: Record<string, unknown>, opts: { adopt?: boolean } = {}) => {
      setSaveState("saving");
      try {
        const d = await fetchJson<{ project: Project }>(`/api/projects/${id}`, jsonInit("PATCH", patch));
        setSaveState("saved");
        // Don't clobber in-flight local typing with the server copy unless asked.
        if (opts.adopt) setProject(d.project);
        return d.project;
      } catch {
        setSaveState("error");
        return null;
      }
    },
    [id]
  );

  // Debounced autosave for the script and voice sliders — no more losing
  // edits to a closed tab or a reload.
  const pendingSave = useRef<Record<string, unknown> | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushSave = useCallback(
    (keepalive = false) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = null;
      const patch = pendingSave.current;
      pendingSave.current = null;
      if (!patch) return Promise.resolve(null);
      if (typeof patch.script === "string") scriptRef.current = patch.script;
      if (keepalive) {
        fetch(`/api/projects/${id}`, { ...jsonInit("PATCH", patch), keepalive: true }).catch(() => {});
        return Promise.resolve(null);
      }
      return persist(patch);
    },
    [id, persist]
  );
  const queueSave = useCallback(
    (patch: Record<string, unknown>) => {
      pendingSave.current = { ...pendingSave.current, ...patch };
      setSaveState("dirty");
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => flushSave(), 600);
    },
    [flushSave]
  );
  useEffect(() => {
    const onHide = () => flushSave(true);
    window.addEventListener("pagehide", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      flushSave(true);
    };
  }, [flushSave]);

  function setSliders(voice: NonNullable<Project["settings"]["voice"]>) {
    if (!project) return;
    const settings = { ...project.settings, voice };
    patchLocal({ settings });
    queueSave({ settings });
  }

  async function generate() {
    if (!project) return;
    setError(null);
    // Persist the latest script + sliders before synthesis
    await flushSave();
    if (project.script !== scriptRef.current) {
      await persist({ script: project.script });
      scriptRef.current = project.script;
    }
    setStage("voice");
    try {
      const sliders = project.settings.voice ?? DEFAULT_SLIDERS;
      const voiced = await fetchJson<{ project: Project }>(
        `/api/projects/${id}/voiceover`,
        jsonInit("POST", { voiceId: project.settings.voiceId, settings: sliders })
      ).catch((e: FetchError) => {
        throw new Error(e.body.error === "missing_key" ? "missing_key:ElevenLabs" : e.message);
      });
      setProject(voiced.project);

      setStage("sync");
      const synced = await fetchJson<{ project: Project }>(`/api/projects/${id}/transcribe`, {
        method: "POST",
      }).catch((e: FetchError) => {
        throw new Error(e.body.error === "missing_key" ? "missing_key:transcription" : e.message);
      });
      setProject(synced.project);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setStage("idle");
    }
  }

  function toggleVoicePreview() {
    const voice = voices?.find((v) => v.voiceId === project?.settings.voiceId);
    if (!voice?.previewUrl) return;
    if (previewingVoice) {
      previewAudio.current?.pause();
      setPreviewingVoice(false);
      return;
    }
    previewAudio.current?.pause();
    const audio = new window.Audio(voice.previewUrl);
    previewAudio.current = audio;
    audio.onended = () => setPreviewingVoice(false);
    audio.play();
    setPreviewingVoice(true);
  }

  const transcript = project?.artifacts.transcript;
  const voiceover = project?.artifacts.voiceover;
  const groups = useMemo(() => (transcript ? groupWords(transcript.words) : []), [transcript]);

  const durationInFrames = transcript
    ? Math.max(60, Math.ceil((LEAD_IN_SEC + transcript.durationSec + 0.6) * SHORT_FPS))
    : 60;

  if (loadError) {
    return <ErrorState detail={`The project couldn't load (${loadError}).`} onRetry={load} />;
  }
  if (!project || !brand) {
    return <p className="py-24 text-center text-sm text-ink-faint">Loading…</p>;
  }

  const over = normalized !== null && normalized.count > normalized.limit;
  const meterPct = normalized ? Math.min(100, (normalized.count / normalized.limit) * 100) : 0;
  const sliders = project.settings.voice ?? DEFAULT_SLIDERS;
  const busy = stage !== "idle";
  // Why Generate is unavailable, in the order the user should fix things.
  // Groq is checked up front so we never spend ElevenLabs credits on a run
  // that will fail at transcription.
  const blocker: { text: string; settings?: boolean } | null =
    keys && !keys.elevenlabs
      ? { text: "Add an ElevenLabs key", settings: true }
      : transcriber === "none"
        ? { text: "Set up transcription for captions", settings: true }
        : voicesError && voicesError !== "missing_key"
          ? { text: "Voices couldn't load" }
          : !project.script.trim()
            ? { text: "Write a script" }
            : !project.settings.voiceId
              ? { text: "Choose a voice" }
              : over && normalized
                ? { text: `Script is ${(normalized.count - normalized.limit).toLocaleString()} chars over` }
                : null;
  const canGenerate = !busy && !blocker;

  return (
    <div className="flex h-full flex-col">
      <FontLoader families={[brand.fonts.caption]} />
      <NarrowScreenNote />

      {/* Project header strip */}
      <div className="flex h-12 shrink-0 items-center gap-4 border-b border-line px-5">
        <Link
          href="/"
          className="flex items-center gap-1.5 text-[12.5px] text-ink-faint transition-colors hover:text-ink"
        >
          <ArrowLeft size={13} /> All projects
        </Link>
        <span className="h-3.5 w-px bg-line" />
        <EditableTitle
          value={project.title}
          onSave={async (title) => {
            patchLocal({ title });
            await persist({ title });
          }}
        />
        <SaveStatus state={saveState} onRetry={() => persist({ script: project.script, settings: project.settings })} />
        <div className="flex-1" />
        {error && (
          <InlineError onDismiss={() => setError(null)} className="max-w-[420px]">
            {error.startsWith("missing_key") ? (
              <>
                Missing {error.split(":")[1]} key —{" "}
                <Link href="/settings" className="underline">
                  add it in Settings
                </Link>
              </>
            ) : (
              error
            )}
          </InlineError>
        )}
        {!busy && !error && blocker && (
          <span className="text-[12px] text-ink-dim">
            {blocker.settings ? (
              <Link href="/settings" className="underline-offset-2 hover:text-lime hover:underline">
                {blocker.text} →
              </Link>
            ) : (
              blocker.text
            )}
          </span>
        )}
        {busy && (
          <span className="micro flex items-center gap-2 text-lime">
            <span className="led on blink" />
            {stage === "voice" ? "Synthesizing voice" : "Syncing words"}
          </span>
        )}
        <Button size="sm" onClick={generate} disabled={!canGenerate}>
          <Sparkles size={13} />
          {voiceover ? "Regenerate" : "Generate voiceover"}
        </Button>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Left rail — script & voice */}
        <div className="flex w-[360px] shrink-0 flex-col gap-6 overflow-y-auto border-r border-line p-5">
          <div>
            <div className="mb-1 flex items-baseline justify-between">
              <span className="micro">Script</span>
              {normalized && (
                <span
                  className={cx(
                    "font-mono text-[11px]",
                    over ? "text-danger" : "text-ink-faint"
                  )}
                >
                  {normalized.count.toLocaleString()} / {normalized.limit.toLocaleString()} spoken
                  chars
                </span>
              )}
            </div>
            <Textarea
              rows={11}
              value={project.script}
              aria-label="Script"
              onChange={(e) => {
                patchLocal({ script: e.target.value });
                queueSave({ script: e.target.value });
              }}
              onBlur={() => flushSave()}
              placeholder="Type or paste your narration…"
            />
            <div className="mt-1.5 h-0.5 w-full overflow-hidden rounded bg-line">
              <div
                className={cx("h-full transition-all", over ? "bg-danger" : "bg-lime")}
                style={{ width: `${meterPct}%` }}
              />
            </div>
            <p className="mt-1.5 text-[11px] leading-relaxed text-ink-faint">
              Numbers, money, and % are expanded to words before synthesis — the count above is
              what ElevenLabs bills.
            </p>
          </div>

          {/* Voice */}
          <div className="flex flex-col gap-4">
            <div className="flex items-end gap-2">
              <Field label="Voice" className="flex-1">
                {voicesError === "missing_key" ? (
                  <p className="pt-1 text-[12.5px] text-ink-faint">
                    <Link href="/settings" className="text-lime underline-offset-2 hover:underline">
                      Add your ElevenLabs key
                    </Link>{" "}
                    to load voices.
                  </p>
                ) : voicesError ? (
                  <p className="pt-1 text-[12px] text-danger">{voicesError.slice(0, 80)}</p>
                ) : (
                  <Select
                    value={project.settings.voiceId ?? ""}
                    onChange={(e) => {
                      const settings = { ...project.settings, voiceId: e.target.value };
                      patchLocal({ settings });
                      persist({ settings });
                    }}
                  >
                    <option value="" disabled>
                      {voices ? "Choose a voice…" : "Loading voices…"}
                    </option>
                    {voices?.map((v) => (
                      <option key={v.voiceId} value={v.voiceId}>
                        {v.name} · {v.category}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              {project.settings.voiceId && voices && (
                <button
                  onClick={toggleVoicePreview}
                  title="Preview voice"
                  className="mb-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-line-strong text-ink-dim transition-colors hover:border-lime hover:text-lime"
                >
                  {previewingVoice ? <Pause size={13} /> : <Play size={13} className="ml-0.5" />}
                </button>
              )}
            </div>

            <div className="flex flex-col gap-2.5">
              <SliderRow
                label="Stability"
                value={sliders.stability}
                min={0}
                max={1}
                step={0.05}
                onChange={(v) => setSliders({ ...sliders, stability: v })}
              />
              <SliderRow
                label="Similarity"
                value={sliders.similarity}
                min={0}
                max={1}
                step={0.05}
                onChange={(v) => setSliders({ ...sliders, similarity: v })}
              />
              <SliderRow
                label="Style"
                value={sliders.style}
                min={0}
                max={1}
                step={0.05}
                onChange={(v) => setSliders({ ...sliders, style: v })}
              />
              <SliderRow
                label="Speed"
                value={sliders.speed}
                min={0.7}
                max={1.2}
                step={0.05}
                onChange={(v) => setSliders({ ...sliders, speed: v })}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-5 border-t border-line pt-5">
            <Field label="Pace" hint="with visuals · soon">
              <Select
                value={project.settings.pace}
                onChange={(e) => {
                  const settings = { ...project.settings, pace: e.target.value };
                  patchLocal({ settings });
                  persist({ settings });
                }}
              >
                <option value="chill">Chill · 9s</option>
                <option value="normal">Normal · 6s</option>
                <option value="fast">Fast · 4.5s</option>
                <option value="single">Single shot</option>
              </Select>
            </Field>
            <Field label="Captions">
              <Select
                value={project.settings.captionStyle}
                onChange={(e) => {
                  const settings = {
                    ...project.settings,
                    captionStyle: e.target.value as Project["settings"]["captionStyle"],
                  };
                  patchLocal({ settings });
                  persist({ settings });
                }}
              >
                <option value="clean">Clean</option>
                <option value="dynamic">Dynamic</option>
              </Select>
            </Field>
          </div>
        </div>

        {/* Stage */}
        <div className="flex min-w-0 flex-1 flex-col bg-void">
          <div className="flex flex-1 items-center justify-center p-8">
            <div className="relative h-full max-h-[560px]">
              <div
                className="h-full overflow-hidden rounded-[18px] border border-line-strong shadow-[0_30px_90px_-30px_rgba(0,0,0,0.9)]"
                style={{ aspectRatio: "9 / 16" }}
              >
                {transcript && voiceover ? (
                  <Player
                    component={ShortComposition}
                    durationInFrames={durationInFrames}
                    fps={SHORT_FPS}
                    compositionWidth={720}
                    compositionHeight={1280}
                    style={{ width: "100%", height: "100%" }}
                    controls
                    loop
                    inputProps={{
                      audioUrl: `/api/assets/${voiceover.assetHash}`,
                      backgroundColor: brand.colors.backgroundColor,
                      captionStyle: project.settings.captionStyle,
                      captionTheme: {
                        fontFamily: brand.fonts.caption,
                        textColor: brand.colors.primaryColor,
                        highlightColor: brand.colors.captionHighlightColor,
                        fontSize: 52,
                        verticalPct: 55,
                      },
                      groups,
                      leadInSec: LEAD_IN_SEC,
                    }}
                  />
                ) : (
                  <div className="flex h-full flex-col items-center justify-center gap-4 px-10 text-center">
                    {busy ? (
                      <>
                        <span className="led on blink !h-2.5 !w-2.5" />
                        <p className="micro text-lime">
                          {stage === "voice" ? "Synthesizing voice" : "Syncing words"}
                        </p>
                      </>
                    ) : (
                      <>
                        <p className="font-serif text-[19px] italic text-ink-dim">
                          Nothing on the reel yet
                        </p>
                        <p className="text-[12.5px] leading-relaxed text-ink-faint">
                          Pick a voice and hit{" "}
                          <span className="text-ink-dim">Generate voiceover</span> — your script
                          becomes audio with word-synced captions.
                        </p>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Timeline strip placeholder (M3) */}
          <div className="shrink-0 border-t border-line px-6 py-3">
            <div className="flex items-center gap-3">
              <span className="micro">Timeline</span>
              <span className="text-[11px] text-ink-faint">Visual shots — coming soon</span>
              {transcript && (
                <span className="ml-auto font-mono text-[11px] text-ink-dim">
                  {transcript.durationSec.toFixed(1)}s · {transcript.words.length} words ·{" "}
                  {groups.length} captions
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
