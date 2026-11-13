"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import Link from "next/link";
import { Player, type PlayerRef } from "@remotion/player";
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignStartVertical,
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  Download,
  Film,
  FolderOpen,
  History as HistoryIcon,
  Image as ImageIcon,
  Music,
  PanelLeft,
  Plus,
  Redo2,
  Square,
  Trash2,
  Type as TypeIcon,
  Undo2,
  Settings2,
  PenLine,
  Monitor,
  Sun,
  Moon,
  LayoutGrid,
  CircleHelp,
} from "lucide-react";
import { Button, InlineError, Select, cx } from "@/components/ui";
import { FontLoader } from "@/components/font-loader";
import { EditableTitle, SaveStatus, usePhoneLayout, type SaveState } from "@/components/editor-chrome";
import { PhoneMenu, PhoneTabs, type MenuItem, type PhoneTab } from "@/components/compositor/phone-bar";
import { THEMES, THEME_LABEL, useTheme } from "@/lib/theme";
import { ChatPanel, STARTERS, type ChatControl } from "@/components/agent/chat-panel";
import { ChatDock, IDLE_STATUS, dockSafeArea, useAnnouncer, useDockState, type DockStatus } from "@/components/agent/chat-dock";
import { TemplatesSection } from "@/components/compositor/templates-section";
import { FolderTray } from "@/components/compositor/folder-tray";
import { VersionsPanel } from "@/components/compositor/versions-panel";
import { VideoReady } from "@/components/compositor/video-ready";
import { HeavyJobAsk, type HeavyChoice } from "@/components/compositor/heavy-job";
import { estimateRender, type JobEstimate } from "@/lib/local/memory";
import { DropOverlay, useWindowFileDrag } from "@/components/compositor/drop-overlay";
import { PointAtIt, PointAtItButton } from "@/components/compositor/point-at-it";
import { ThemeToggle } from "@/components/theme-toggle";
import { useLosoInbox } from "@/components/compositor/loso-inbox";
import { useSettingsMode, useSettingsSheet } from "@/components/settings/settings-sheet";
import { clock, historyReducer, initialHistory, sameDoc, timeline, type DocUpdater } from "@/components/compositor/history";
import { loadVersions, saveVersions } from "@/lib/local/versions";
import { setFaviconWorking } from "@/lib/favicon";
import type { EditorBackend } from "@/components/compositor/backend";
import { WordsOnScreen } from "@/components/compositor/words-on-screen";
import { WordsIcon, WordsPiecesRow, WordsStoryRow } from "@/components/compositor/words-strip";
import { isCaption, styleAll } from "@/lib/caption-set";
import { CompositorComposition } from "@/remotion/compositor";
import { LosoLogo, LosoMark } from "@/components/logo";
import { Tour, showTour } from "@/components/tour/tour";
import { editorSteps, phoneEditorSteps } from "@/components/tour/steps";
import { FONT_CHOICES } from "@/lib/fonts";
import {
  OUTPUT_PRESETS,
  compositorDocSchema,
  emptyCompositorDoc,
  mediaRefs,
  resolveDocWith,
  type Anim,
  type CompositorDoc,
  type Layer,
} from "@/lib/compositor";

const TYPE_ICON = { video: Film, image: ImageIcon, audio: Music, text: TypeIcon } as const;
const KIND_WORD = { video: "Video", image: "Picture", audio: "Sound", text: "Words" } as const;
const SHAPE_WORD: Record<string, string> = { "9x16": "Phone (tall)", "16x9": "TV (wide)", "1x1": "Square", "4x5": "Tall post" };

function layerLabel(l: Layer): string {
  if (l.name) return l.name;
  if (l.type === "text") return l.text || "Words";
  return KIND_WORD[l.type];
}

function safeFileName(title: string) {
  return title.replace(/[^\w\- ]+/g, "").trim() || "loso";
}

let seq = 0;
function newId(prefix: string) {
  seq += 1;
  return `${prefix}-${Date.now().toString(36)}-${seq}`;
}

// ---------- small inspector controls ----------

/** A number field that keeps what you type (no jump to 0 while it's empty). */
function NumRow({
  label,
  value,
  onChange,
  step = 1,
  min,
  wide,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  wide?: boolean;
}) {
  const shown = Number.isFinite(value) ? String(Math.round(value * 100) / 100) : "0";
  const [text, setText] = useState(shown);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(shown);
  }, [shown]);
  return (
    <label className="flex items-center gap-2">
      <span className={cx("shrink-0 text-[12.5px] text-ink-dim", wide ? "w-[92px]" : "w-[58px]")}>{label}</span>
      <input
        type="number"
        value={text}
        step={step}
        min={min}
        onFocus={() => (focused.current = true)}
        onBlur={() => {
          focused.current = false;
          setText(shown);
        }}
        onChange={(e) => {
          setText(e.target.value);
          const n = Number(e.target.value);
          if (e.target.value.trim() !== "" && Number.isFinite(n)) onChange(n);
        }}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        className="uline !py-1 text-[13.5px]"
      />
    </label>
  );
}

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
    <div className="flex items-center gap-2.5">
      <span className="w-[92px] shrink-0 text-[12.5px] text-ink-dim">{label}</span>
      <input
        type="range"
        aria-label={label}
        aria-valuetext={`${Math.round(value * 100)}%`}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1"
      />
      <span className="w-10 text-right font-mono text-[12px] text-ink-dim">{Math.round(value * 100)}%</span>
    </div>
  );
}

function RailHeading({ children, id }: { children: React.ReactNode; id?: string }) {
  return (
    <h2 id={id} className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-dim">
      {children}
    </h2>
  );
}

function readFlag(key: string, fallback: boolean) {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v === "1";
  } catch {
    return fallback;
  }
}
function writeFlag(key: string, v: boolean) {
  try {
    localStorage.setItem(key, v ? "1" : "0");
  } catch {
    /* ignore */
  }
}

// ---------- editor ----------

export function CompositorEditor({ backend }: { backend: EditorBackend }) {
  const [hist, dispatch] = useReducer(historyReducer, undefined, () => {
    const parsed = compositorDocSchema.safeParse(backend.doc);
    return initialHistory(parsed.success ? parsed.data : emptyCompositorDoc());
  });
  const doc = hist.present;
  const setDoc = useCallback((u: DocUpdater) => dispatch({ type: "set", updater: u }), []);
  const undo = useCallback(() => dispatch({ type: "undo" }), []);
  const redo = useCallback(() => dispatch({ type: "redo" }), []);
  const canUndo = hist.past.length > 0;
  const canRedo = hist.future.length > 0;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [stageBox, setStageBox] = useState({ w: 0, h: 0 });
  const [uploading, setUploading] = useState<{ i: number; n: number; name: string } | null>(null);
  const [rendering, setRendering] = useState(false);
  const [folderVersion, setFolderVersion] = useState(0); // bumps after files are added to the folder
  const [renderElapsed, setRenderElapsed] = useState(0);
  const [renderProgress, setRenderProgress] = useState<number | null>(null);
  const [renderUrl, setRenderUrl] = useState<string | null>(backend.lastExport?.url ?? null);
  const [savedAs, setSavedAs] = useState<string | null>(backend.lastExport?.savedAs ?? null);
  // The doc the current export was rendered from. Any later edit makes the
  // download stale; the backend says whether the last export is current.
  const [renderedDoc, setRenderedDoc] = useState<CompositorDoc | null>(() =>
    backend.lastExport?.current ? hist.present : null
  );
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState(backend.title);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [agentBusy, setAgentBusy] = useState(false);
  const [dockStatus, setDockStatus] = useState<DockStatus>(IDLE_STATUS);
  const [versionsOpen, setVersionsOpen] = useState(false);
  // "Done." — the finished video, shown once right after it's made.
  const [ready, setReady] = useState<{ url: string; savedAs: string | null; test?: boolean } | null>(null);
  // "This is a big video for this computer": the open question, if any.
  const [heavyAsk, setHeavyAsk] = useState<{
    est: JobEstimate;
    unreadable: Array<{ clip: string; why: string }>;
    resolve: (c: HeavyChoice) => void;
  } | null>(null);
  // The doc a quick test was made of: making the whole video next doesn't ask again.
  const testedDoc = useRef<CompositorDoc | null>(null);
  const asking = useRef(false);
  const makeBtnRef = useRef<HTMLButtonElement>(null);
  // While marking, the frame moves down below the Point-at-it toolbar.
  const [markBarH, setMarkBarH] = useState(0);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [railOpen, setRailOpenRaw] = useState(true);
  const [storyOpen, setStoryOpenRaw] = useState(false);
  const [agentFocus, setAgentFocus] = useState<string[]>([]);
  // "Words on screen": the captions manager in the rail (see words-on-screen.tsx)
  const [wordsOpen, setWordsOpen] = useState(false);
  const playerRef = useRef<PlayerRef>(null);
  // updatedAt of the newest saved copy we know about (ours or adopted)
  const lastSeen = useRef(backend.updatedAt);
  const dock = useDockState(backend.projectId);
  // Phones: the video on top and Loso / Pieces / Story as tabs below it
  // (no floating dock, no side rail).
  const { phone, landscape } = usePhoneLayout();
  const [phoneTab, setPhoneTab] = useState<PhoneTab>(backend.agent ? "loso" : "pieces");
  // Where the chat is, in the dock's words: on a phone it's "open" while its tab is picked.
  const chatState = phone ? (phoneTab === "loso" ? "open" : "peek") : dock.state;
  const openChat = useCallback(() => (phone ? setPhoneTab("loso") : dock.setState("open")), [phone, dock]);
  const [theme, setTheme] = useTheme();
  // In a narrow window an open chat and the pieces rail don't both fit
  // beside the video: the chat wins while it's open.
  const railShown = phone ? phoneTab === "pieces" : railOpen && !(dock.narrow && dock.state === "open");
  const { message: announcement, announce } = useAnnouncer();
  const chat = useRef<ChatControl | null>(null);
  const dragTypes = useWindowFileDrag();

  const stageRef = useRef<HTMLDivElement>(null);
  const stageSectionRef = useRef<HTMLElement>(null);
  const railRef = useRef<HTMLElement>(null);
  const versionsBtnRef = useRef<HTMLButtonElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // The doc we opened with: no save until it actually changes. (A "first
  // render" flag is not enough: React's dev StrictMode runs effects twice, so
  // merely opening the editor used to save the doc back — "Saving…" on open.)
  const openedDoc = useRef(doc);

  useEffect(() => {
    setRailOpenRaw(readFlag("loso:rail", true));
    setStoryOpenRaw(readFlag("loso:story", false));
  }, []);
  const setRailOpen = (v: boolean) => {
    setRailOpenRaw(v);
    writeFlag("loso:rail", v);
  };
  const setStoryOpen = (v: boolean) => {
    setStoryOpenRaw(v);
    writeFlag("loso:story", v);
  };

  const { output, layers } = doc;
  const selected = layers.find((l) => l.id === selectedId) ?? null;

  // Picking a piece (from the story strip) brings the rail back to edit it.
  // On a phone that's the Pieces tab.
  useEffect(() => {
    if (!selectedId) return;
    setRailOpenRaw(true);
    if (phone) setPhoneTab("pieces");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);
  // Picking a caption opens the words-on-screen manager at that line;
  // picking anything else goes back to the usual inspector.
  const selectedIsCaption = !!selected && isCaption(selected);
  useEffect(() => {
    if (selectedId) setWordsOpen(selectedIsCaption);
  }, [selectedId, selectedIsCaption]);
  const showWords = wordsOpen && (!selected || selectedIsCaption);
  const changeWords = useCallback(
    (updater: (d: CompositorDoc) => CompositorDoc, label: string) => dispatch({ type: "set", updater, label }),
    []
  );

  // ---- persistence (debounced full-doc save, flushable) ----
  // The latest unsaved doc lives in pendingDoc; flush() writes it now. Export
  // flushes first so it never renders a stale copy, and leaving the page
  // flushes with keepalive so the last edit survives navigation / tab close.
  const pendingDoc = useRef<CompositorDoc | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(
    async (keepalive = false): Promise<boolean> => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = null;
      const d = pendingDoc.current;
      if (!d) return true;
      pendingDoc.current = null;
      if (keepalive) {
        backend.save(d, { keepalive: true }).catch(() => {});
        return true;
      }
      setSaveState("saving");
      try {
        const updatedAt = await backend.save(d, { keepalive: false });
        lastSeen.current = Math.max(lastSeen.current, updatedAt);
        setSaveState(pendingDoc.current ? "dirty" : "saved");
        return true;
      } catch {
        pendingDoc.current ??= d; // keep it queued for retry
        setSaveState("error");
        return false;
      }
    },
    [backend]
  );

  useEffect(() => {
    if (doc === openedDoc.current) return;
    pendingDoc.current = doc;
    setSaveState("dirty");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => flush(), 400);
  }, [doc, flush]);

  useEffect(() => {
    const onHide = () => flush(true);
    window.addEventListener("pagehide", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      flush(true);
    };
  }, [flush]);

  // ---- versions survive a reload ----
  // The history is kept per project in IndexedDB (docs + labels, at most 100).
  // On open the saved versions are put back behind the opened video; after
  // that every change is written a moment later, and right away on leaving.
  const histRef = useRef(hist);
  histRef.current = hist;
  const versionsReady = useRef(false);
  useEffect(() => {
    let cancelled = false;
    loadVersions(backend.kind, backend.projectId).then((saved) => {
      if (cancelled) return;
      if (saved) dispatch({ type: "hydrate", saved });
      versionsReady.current = true;
    });
    return () => {
      cancelled = true;
    };
  }, [backend.kind, backend.projectId]);
  useEffect(() => {
    if (!versionsReady.current) return;
    const t = setTimeout(() => saveVersions(backend.kind, backend.projectId, hist), 600);
    return () => clearTimeout(t);
  }, [hist, backend.kind, backend.projectId]);
  useEffect(() => {
    const save = () => {
      if (versionsReady.current) saveVersions(backend.kind, backend.projectId, histRef.current);
    };
    window.addEventListener("pagehide", save);
    return () => {
      window.removeEventListener("pagehide", save);
      save();
    };
  }, [backend.kind, backend.projectId]);

  // ---- measure the stage's safe area for scaling ----
  // The dock floats over the stage (no reflow); the frame centres in the
  // space left of it.
  const safeRight = phone ? 0 : dockSafeArea(dock.state, dock.width);
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setStageBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setStageBox({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const fit = useMemo(() => {
    if (!stageBox.w || !stageBox.h) return 0;
    return Math.min(stageBox.w / output.width, stageBox.h / output.height);
  }, [stageBox, output.width, output.height]);
  const dispW = output.width * fit;
  const dispH = output.height * fit;

  // ---- versions preview ----
  const versions = useMemo(() => timeline(hist), [hist]);
  const preview = previewIndex !== null ? (versions[previewIndex] ?? null) : null;
  const shownDoc = preview && !preview.current ? preview.doc : doc;
  const previewing = shownDoc !== doc;
  const onPreview = useCallback((i: number | null) => setPreviewIndex(i), []);

  // Asset URLs by ref. Local projects resolve to blob URLs for files in the
  // folder (null = the file is missing); server projects to /api/assets.
  const [assetUrls, setAssetUrls] = useState<Record<string, string | null>>({});
  const refsKey = [...new Set([...mediaRefs(doc), ...mediaRefs(shownDoc)])].join("\u0000");
  useEffect(() => {
    const want = refsKey ? refsKey.split("\u0000") : [];
    const missing = want.filter((r) => !(r in assetUrls));
    if (!missing.length) return;
    let cancelled = false;
    backend.assetUrls(missing).then((urls) => {
      if (!cancelled) setAssetUrls((prev) => ({ ...prev, ...urls }));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refsKey, backend]);
  const resolved = useMemo(() => resolveDocWith(shownDoc, assetUrls), [shownDoc, assetUrls]);

  // ---- doc mutations ----
  const setOutput = useCallback((patch: Partial<CompositorDoc["output"]>) => {
    setDoc((d) => ({ ...d, output: { ...d.output, ...patch } }));
  }, [setDoc]);

  const patchLayer = useCallback((id: string, patch: Partial<Layer>) => {
    setDoc((d) => ({
      ...d,
      layers: d.layers.map((l) => (l.id === id ? ({ ...l, ...patch } as Layer) : l)),
    }));
  }, [setDoc]);

  const addLayer = useCallback(
    (layer: Layer) => {
      setDoc((d) => ({ ...d, layers: [...d.layers, layer] }));
      setSelectedId(layer.id);
    },
    [setDoc]
  );

  const removeLayer = useCallback((id: string) => {
    setDoc((d) => ({ ...d, layers: d.layers.filter((l) => l.id !== id) }));
    setSelectedId((s) => (s === id ? null : s));
  }, [setDoc]);

  const reorder = useCallback((id: string, dir: 1 | -1) => {
    setDoc((d) => {
      const sorted = [...d.layers].sort((a, b) => a.z - b.z);
      const idx = sorted.findIndex((l) => l.id === id);
      const swap = idx + dir;
      if (swap < 0 || swap >= sorted.length) return d;
      const zi = sorted[idx].z;
      sorted[idx] = { ...sorted[idx], z: sorted[swap].z };
      sorted[swap] = { ...sorted[swap], z: zi };
      return { ...d, layers: sorted };
    });
  }, [setDoc]);

  const nextZ = () => (layers.length ? Math.max(...layers.map((l) => l.z)) + 1 : 0);

  function duplicateLayer(l: Layer) {
    addLayer({
      ...l,
      id: newId(l.type),
      name: l.name ? `${l.name} copy` : undefined,
      x: l.x + 20,
      y: l.y + 20,
      z: nextZ(),
    } as Layer);
  }

  // Switching presets rescales existing layers into the new frame so
  // full-frame media doesn't end up stranded off-canvas (undoable).
  function applyPreset(width: number, height: number) {
    setDoc((d) => {
      const sx = width / d.output.width;
      const sy = height / d.output.height;
      return {
        ...d,
        output: { ...d.output, width, height },
        layers: d.layers.map((l) => {
          if (l.type === "audio") return l;
          const scaled = {
            ...l,
            x: Math.round(l.x * sx),
            y: Math.round(l.y * sy),
            width: Math.round(l.width * sx),
            height: Math.round(l.height * sy),
          };
          return l.type === "text"
            ? { ...scaled, fontSize: Math.max(4, Math.round(l.fontSize * Math.min(sx, sy))) }
            : scaled;
        }) as Layer[],
      };
    });
  }

  // ---- changes from outside the editor (the agent, MCP clients) ----
  const docRef = useRef(doc);
  docRef.current = doc;
  const adoptExternal = useCallback((next: CompositorDoc, group: string, label?: string) => {
    const parsed = compositorDocSchema.safeParse(next);
    if (!parsed.success) return;
    if (sameDoc(parsed.data, docRef.current)) return;
    dispatch({ type: "external", doc: parsed.data, group, label });
  }, []);

  const syncFromServer = useCallback(
    async (group: string) => {
      if (pendingDoc.current || !backend.fetchLatest) return;
      try {
        const d = await backend.fetchLatest();
        if (d.updatedAt <= lastSeen.current) return;
        lastSeen.current = d.updatedAt;
        if (d.doc) adoptExternal(d.doc, group);
      } catch {
        /* offline — try again next tick */
      }
    },
    [backend, adoptExternal]
  );

  // Poll for edits made by external agents (MCP) while the tab is idle.
  useEffect(() => {
    if (agentBusy || !backend.fetchLatest) return;
    const t = setInterval(() => {
      if (document.visibilityState === "visible") syncFromServer(`ext-${Date.now() >> 14}`);
    }, 4000);
    return () => clearInterval(t);
  }, [agentBusy, syncFromServer, backend]);

  // Live highlight: the pieces the agent just touched get a lime outline on
  // the stage for a moment (at most 3), with the words in the status line.
  const focusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onAgentDoc = useCallback(
    (next: CompositorDoc, turn: string) => {
      lastSeen.current = Date.now();
      const before = new Map(docRef.current.layers.map((l) => [l.id, JSON.stringify(l)]));
      const touched = next.layers
        .filter((l) => l.type !== "audio" && before.get(l.id) !== JSON.stringify(l))
        .map((l) => l.id)
        .slice(0, 3);
      if (touched.length) {
        setAgentFocus(touched);
        if (focusTimer.current) clearTimeout(focusTimer.current);
        focusTimer.current = setTimeout(() => setAgentFocus([]), 1600);
      }
      adoptExternal(next, `agent-${turn}`);
    },
    [adoptExternal]
  );
  const onAgentBusy = useCallback((b: boolean) => {
    setAgentBusy(b);
    if (b) setSelectedId(null);
  }, []);
  const agentBeforeSend = useCallback(() => flush(), [flush]);
  const canUndoTurn = useCallback((turn: string) => hist.group === `agent-${turn}`, [hist.group]);

  // ---- keyboard ----
  // ⌘Z / ⇧⌘Z undo·redo anywhere outside text fields. Single keys (Delete,
  // arrows, [ ]) only act when focus is on the stage or the pieces list, so
  // they never fire by accident from a button or a speech command.
  const agentBusyRef = useRef(false);
  agentBusyRef.current = agentBusy;
  const onKeyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  onKeyRef.current = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    const typing = !!t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable);
    if (typing || agentBusyRef.current) return;
    const meta = e.metaKey || e.ctrlKey;
    const key = e.key.toLowerCase();
    if (meta && key === "z") {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
      return;
    }
    const scoped =
      !t || t === document.body || !!stageSectionRef.current?.contains(t) || !!t.closest?.("[data-pieces]");
    if (!scoped) return;
    if (e.key === "Escape") {
      setSelectedId(null);
      return;
    }
    if (!selected) return;
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      removeLayer(selected.id);
    } else if (meta && key === "d") {
      e.preventDefault();
      duplicateLayer(selected);
    } else if (e.key === "[") {
      reorder(selected.id, -1);
    } else if (e.key === "]") {
      reorder(selected.id, 1);
    } else if (e.key.startsWith("Arrow") && selected.type !== "audio" && !t?.closest?.("[data-pieces]")) {
      e.preventDefault();
      const step = e.shiftKey ? 10 : 1;
      const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
      const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
      placeSelected(selected.id, { x: selected.x + dx, y: selected.y + dy });
    }
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => onKeyRef.current(e);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ---- adding layers ----
  function addText() {
    addLayer({
      id: newId("text"),
      type: "text",
      x: Math.round(output.width * 0.1),
      y: Math.round(output.height * 0.42),
      width: Math.round(output.width * 0.8),
      height: Math.round(output.height * 0.16),
      rotation: 0,
      opacity: 1,
      z: nextZ(),
      from: 0,
      durationInFrames: output.durationInFrames,
      radius: 0,
      borderWidth: 0,
      borderColor: "#ffffff",
      text: "Your words here",
      fontFamily: FONT_CHOICES[0],
      fontSize: Math.round(output.width * 0.08),
      color: "#ffffff",
      fontWeight: 800,
      italic: false,
      align: "center",
      backgroundColor: null,
    });
  }

  function addMediaLayer(kind: "video" | "image" | "audio", assetHash: string, name?: string) {
    const common = {
      id: newId(kind),
      name,
      rotation: 0,
      opacity: 1,
      z: nextZ(),
      from: 0,
      durationInFrames: output.durationInFrames,
      radius: 0,
      borderWidth: 0,
      borderColor: "#ffffff",
    };
    if (kind === "audio") {
      addLayer({
        ...common,
        type: "audio",
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        assetHash,
        trimStart: 0,
        trimEnd: null,
        volume: 1,
      });
      return;
    }
    // video / image default to full frame
    const base = {
      ...common,
      x: 0,
      y: 0,
      width: output.width,
      height: output.height,
      assetHash,
      objectFit: "cover" as const,
    };
    if (kind === "video") {
      addLayer({ ...base, type: "video", trimStart: 0, trimEnd: null, volume: 1 });
    } else {
      addLayer({ ...base, type: "image" });
    }
  }

  async function uploadFile(file: File): Promise<string | null> {
    try {
      return await backend.importFile(file);
    } catch (e) {
      setError(`Couldn't add ${file.name}. ${(e as Error).message}`);
      return null;
    }
  }

  function kindFromMime(mime: string): "video" | "image" | "audio" | null {
    if (mime.startsWith("video/")) return "video";
    if (mime.startsWith("image/")) return "image";
    if (mime.startsWith("audio/")) return "audio";
    return null;
  }

  async function ingestFiles(files: FileList | File[]) {
    setError(null);
    const all = Array.from(files);
    const usable = all.filter((f) => kindFromMime(f.type));
    const skipped = all.filter((f) => !kindFromMime(f.type)).map((f) => f.name);
    try {
      for (const [i, file] of usable.entries()) {
        setUploading({ i: i + 1, n: usable.length, name: file.name });
        const hash = await uploadFile(file);
        if (hash) addMediaLayer(kindFromMime(file.type)!, hash, file.name.replace(/\.[^.]+$/, ""));
      }
      if (usable.length) announce(`Added ${usable.length === 1 ? usable[0].name : `${usable.length} files`} to your video`);
    } finally {
      setUploading(null);
      setFolderVersion((v) => v + 1);
    }
    if (skipped.length) {
      setError(`Skipped ${skipped.join(", ")}. Only videos, pictures and sounds can go in the video.`);
    }
  }

  function pickFiles() {
    const input = fileInputRef.current;
    if (!input) return;
    input.value = "";
    input.click();
  }

  // ---- drag interactions on the stage ----
  // Captions are one set: moving or resizing one on the stage places them all.
  function placeSelected(id: string, patch: Partial<Pick<Layer, "x" | "y" | "width" | "height">>) {
    if (selectedIsCaption) changeWords((d) => styleAll(d, patch), "Moved the words on screen");
    else patchLayer(id, patch);
  }

  function beginMove(e: React.PointerEvent) {
    if (!selected || selected.type === "audio" || !fit) return;
    e.preventDefault();
    e.stopPropagation();
    const { id, x, y } = selected;
    const sx = e.clientX;
    const sy = e.clientY;
    const move = (ev: PointerEvent) => {
      placeSelected(id, {
        x: Math.round(x + (ev.clientX - sx) / fit),
        y: Math.round(y + (ev.clientY - sy) / fit),
      });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  function beginResize(e: React.PointerEvent, corner: "nw" | "ne" | "sw" | "se") {
    if (!selected || selected.type === "audio" || !fit) return;
    e.preventDefault();
    e.stopPropagation();
    const { id, x, y, width, height } = selected;
    const sx = e.clientX;
    const sy = e.clientY;
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - sx) / fit;
      const dy = (ev.clientY - sy) / fit;
      let nx = x;
      let ny = y;
      let nw = width;
      let nh = height;
      if (corner.includes("e")) nw = Math.max(20, width + dx);
      if (corner.includes("s")) nh = Math.max(20, height + dy);
      if (corner.includes("w")) {
        nw = Math.max(20, width - dx);
        nx = x + (width - nw);
      }
      if (corner.includes("n")) {
        nh = Math.max(20, height - dy);
        ny = y + (height - nh);
      }
      placeSelected(id, {
        x: Math.round(nx),
        y: Math.round(ny),
        width: Math.round(nw),
        height: Math.round(nh),
      });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  // ---- align selected layer to the canvas ----
  function align(edge: "left" | "hcenter" | "right" | "top" | "vcenter" | "bottom") {
    if (!selected || selected.type === "audio") return;
    const patch: Partial<Layer> = {};
    if (edge === "left") patch.x = 0;
    if (edge === "hcenter") patch.x = Math.round((output.width - selected.width) / 2);
    if (edge === "right") patch.x = output.width - selected.width;
    if (edge === "top") patch.y = 0;
    if (edge === "vcenter") patch.y = Math.round((output.height - selected.height) / 2);
    if (edge === "bottom") patch.y = output.height - selected.height;
    patchLayer(selected.id, patch);
  }

  // ---- export ----
  useEffect(() => {
    if (!rendering) return;
    const started = Date.now();
    setRenderElapsed(0);
    const t = setInterval(() => setRenderElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(t);
  }, [rendering]);

  // The tab icon spins with the Onion Skin while Loso works: an agent turn
  // running, or the video being made. Every true gets its matching false.
  const agentWorking = dockStatus.busy || agentBusy;
  useEffect(() => {
    if (!agentWorking) return;
    setFaviconWorking(true);
    return () => setFaviconWorking(false);
  }, [agentWorking]);
  useEffect(() => {
    if (!rendering) return;
    setFaviconWorking(true);
    return () => setFaviconWorking(false);
  }, [rendering]);

  // Announce export progress in 25% steps only.
  const lastQuarter = useRef(-1);
  useEffect(() => {
    if (renderProgress === null) return;
    const q = Math.floor(renderProgress * 4);
    if (q > lastQuarter.current && q > 0 && q < 4) announce(`Making the video, ${q * 25} percent`);
    lastQuarter.current = q;
  }, [renderProgress, announce]);

  async function exportVideo(): Promise<{ savedAs?: string; error?: string }> {
    setError(null);
    // Making the MP4 needs the browser's video encoder (WebCodecs). Say so
    // plainly instead of failing halfway on browsers that don't have it.
    if (typeof window !== "undefined" && !("VideoEncoder" in window)) {
      const msg = phone
        ? "This phone's browser can't make video files yet. Update your phone, or try Chrome."
        : "This browser can't make video files. Use Chrome or Edge.";
      setError(msg);
      return { error: msg };
    }
    // A heavy video for this computer, or clips it can't read: ask first (never blocks).
    const choice = await askBeforeMaking(doc);
    if (choice === "cancel") return { error: "Not made yet: the user chose to wait." };
    const test = choice === "test";
    setRendering(true);
    // Keep the screen on while it works: a phone that locks pauses the tab.
    let wake: { release(): Promise<void> } | null = null;
    try {
      wake = await (navigator as Navigator & { wakeLock?: { request(t: "screen"): Promise<{ release(): Promise<void> }> } }).wakeLock?.request("screen") ?? null;
    } catch {
      wake = null;
    }
    lastQuarter.current = -1;
    announce(phone ? "Making the video. Keep Loso open and the screen on." : "Making the video. Keep this tab open.");
    try {
      // Render reads the saved doc, so make sure the latest edit is saved first.
      if (!(await flush())) throw new Error("Couldn't save your latest changes, so making the video was stopped.");
      const exported = doc;
      const d = await backend.exportVideo(exported, setRenderProgress, test ? { test: true } : undefined);
      if (test) {
        testedDoc.current = exported;
        setReady({ url: d.url, savedAs: d.savedAs ?? null, test: true });
        announce("Your test is ready. It's the first 10 seconds, smaller. If it looks right, make the whole video.");
        return { savedAs: d.savedAs ?? undefined };
      }
      // The previous download link points at an older copy: let it go.
      setRenderUrl((old) => {
        if (old && old !== d.url && old.startsWith("blob:")) setTimeout(() => URL.revokeObjectURL(old), 0);
        return d.url;
      });
      setSavedAs(d.savedAs ?? null);
      setRenderedDoc(exported);
      setReady({ url: d.url, savedAs: d.savedAs ?? null });
      announce(
        `Done. Your video is ready.${d.savedAs && !backend.folder?.inBrowser ? ` It's saved in your folder as ${d.savedAs}.` : ""}`
      );
      return { savedAs: d.savedAs ?? undefined };
    } catch (e) {
      const raw = (e as Error).message;
      // Phones run out of memory on long or big videos; say what to try.
      const msg = phone
        ? `${raw} Phones can struggle with long or big videos: try a shorter one, or close other apps and try again.`
        : raw;
      setError(msg);
      return { error: msg };
    } finally {
      wake?.release().catch(() => {});
      setRendering(false);
      setRenderProgress(null);
    }
  }
  const renderStale = !!renderUrl && renderedDoc !== doc;

  async function askBeforeMaking(d: CompositorDoc): Promise<HeavyChoice> {
    if (backend.kind !== "local") return "full";
    // Already checking or asking (a second click, or the agent): don't stack a second question.
    if (asking.current) return "cancel";
    asking.current = true;
    const est = estimateRender(d);
    const unreadable = (await backend.unreadableClips?.(d).catch(() => [])) ?? [];
    if (!unreadable.length && (est.load === "light" || testedDoc.current === d)) {
      asking.current = false;
      return "full";
    }
    return new Promise<HeavyChoice>((resolve) =>
      setHeavyAsk({
        est,
        unreadable,
        resolve: (c) => {
          asking.current = false;
          setHeavyAsk(null);
          resolve(c);
        },
      })
    );
  }

  // The in-browser agent makes the video with the same button (render_video, after the user confirms).
  const exportRef = useRef(exportVideo);
  exportRef.current = exportVideo;
  const chatApi = useMemo(
    () =>
      backend.chat?.({
        getDoc: () => docRef.current,
        async render() {
          const r = await exportRef.current();
          if (r.error) throw new Error(r.error);
          return r.savedAs ?? "a new video in exports/";
        },
      }),
    [backend]
  );

  const sortedLayers = [...layers].sort((a, b) => b.z - a.z); // top layer first in the list
  const durationSec = output.durationInFrames / output.fps;
  const activePreset = OUTPUT_PRESETS.find((p) => p.width === output.width && p.height === output.height);
  const textFamilies = layers.filter((l) => l.type === "text").map((l) => l.fontFamily);
  const sec = (frames: number) => Math.round((frames / output.fps) * 100) / 100;
  const frames = (s: number) => Math.round(s * output.fps);

  const focusChat = useCallback(() => chat.current?.focus(), []);
  function askLoso(text: string) {
    openChat();
    setTimeout(() => chat.current?.fill(text), 30);
  }

  // Pictures arriving (paste, drop, "Point at it") and the settings sheet.
  const inbox = useLosoInbox({
    backend,
    chat,
    dockState: chatState,
    openDock: openChat,
    ingestFiles: (files) => ingestFiles(files),
    announce,
    setError,
  });
  const settings = useSettingsSheet();
  useSettingsMode(backend.kind);

  const lastStep = versions[versions.length - 1];

  // The top bar's actions, folded into More on a phone.
  const nextTheme = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
  const phoneMenu: MenuItem[] = [
    {
      key: "undo",
      icon: Undo2,
      label: "Undo",
      disabledReason: agentBusy ? "Wait until Loso finishes" : !canUndo ? "Nothing to undo yet" : null,
      onSelect: undo,
    },
    {
      key: "redo",
      icon: Redo2,
      label: "Redo",
      disabledReason: agentBusy ? "Wait until Loso finishes" : !canRedo ? "Nothing to redo" : null,
      onSelect: redo,
    },
    { key: "versions", icon: HistoryIcon, label: "Versions", detail: String(versions.length), onSelect: () => setVersionsOpen(true) },
    {
      key: "point",
      icon: PenLine,
      label: "Point at it",
      disabledReason: agentBusy
        ? "Wait until Loso finishes"
        : previewing
          ? "Go back to your latest version first"
          : layers.length === 0
            ? "Add something to your video first"
            : null,
      onSelect: () => inbox.startMarking(null),
    },
    ...(renderUrl && !rendering
      ? [
          {
            key: "download",
            icon: Download,
            label: renderStale ? "Download old version" : "Download the video",
            href: renderUrl,
            download: `${safeFileName(title)}.mp4`,
            separated: true,
          },
        ]
      : []),
    {
      key: "pieces",
      icon: LayoutGrid,
      label: "Video settings",
      detail: SHAPE_WORD[activePreset?.id ?? ""] ?? "Custom",
      onSelect: () => {
        setSelectedId(null);
        setWordsOpen(false);
        setPhoneTab("pieces");
      },
      separated: !(renderUrl && !rendering),
    },
    {
      key: "theme",
      icon: theme === "dark" ? Moon : theme === "light" ? Sun : Monitor,
      label: `Theme: ${THEME_LABEL[theme]}`,
      detail: `→ ${THEME_LABEL[nextTheme]}`,
      onSelect: () => setTheme(nextTheme),
    },
    { key: "settings", icon: Settings2, label: "Settings and AI key", onSelect: () => settings.open({ opener: null }) },
    { key: "tour", icon: CircleHelp, label: "Show me around", onSelect: () => showTour() },
  ];

  // ---- story strip (bottom drawer; the Story tab on a phone) ----
  const storySection = (
          <section
            aria-labelledby="story-h"
            data-tour="story"
            className={cx("flex shrink-0 flex-col", phone ? "min-h-0 pt-3 [grid-area:panel]" : "border-t border-line")}
            style={phone ? undefined : { paddingRight: safeRight, maxHeight: storyOpen ? "40%" : undefined }}
          >
            {phone && (
              <h2 id="story-h" className="sr-only">
                Story
              </h2>
            )}
            <button
              type="button"
              hidden={phone}
              aria-expanded={storyOpen}
              aria-controls="story-rows"
              onClick={() => setStoryOpen(!storyOpen)}
              className="flex h-10 shrink-0 items-center gap-3 px-6 text-left"
            >
              <span id={phone ? undefined : "story-h"} className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-dim">
                Story
              </span>
              <span className="text-[12.5px] text-ink-dim">
                {durationSec.toFixed(durationSec % 1 ? 1 : 0)} seconds · {layers.length} {layers.length === 1 ? "piece" : "pieces"}
              </span>
              <ChevronUp size={14} className={cx("ml-auto text-ink-dim transition-transform", !storyOpen && "rotate-180")} aria-hidden />
            </button>
            {(storyOpen || phone) && (
              <div id="story-rows" className={cx("min-h-0 overflow-y-auto pb-4", phone ? "overscroll-contain px-4" : "px-6")}>
                {phone && sortedLayers.length === 0 && (
                  <p className="py-4 text-[14px] leading-relaxed text-ink-dim">
                    Nothing in the video yet. Each piece shows up here as a bar: where it starts, and how long it stays.
                  </p>
                )}
                <div className="flex flex-col gap-1">
                  {sortedLayers.map((l) => {
                    // all captions fold into one row that shows their words
                    if (isCaption(l))
                      return l.id === sortedLayers.find(isCaption)?.id ? (
                        <WordsStoryRow key="words-on-screen" doc={doc} activeId={selectedId} onOpen={(id) => setSelectedId(id)} />
                      ) : null;
                    const total = Math.max(1, output.durationInFrames);
                    const left = (l.from / total) * 100;
                    const w = (Math.min(l.durationInFrames, total - l.from) / total) * 100;
                    const Icon = TYPE_ICON[l.type];
                    const label = layerLabel(l);
                    const on = selectedId === l.id;
                    return (
                      <button
                        type="button"
                        key={l.id}
                        aria-pressed={on}
                        aria-label={`${label}, from ${sec(l.from)} to ${sec(l.from + l.durationInFrames)} seconds`}
                        className={cx("relative block w-full cursor-pointer bg-panel", phone ? "h-10" : "h-6")}
                        onClick={() => setSelectedId(l.id)}
                      >
                        <span
                          className={cx(
                            "absolute top-0 flex h-full min-w-0 items-center gap-1 overflow-hidden px-1.5 text-[11.5px]",
                            on ? "bg-lime-fill text-black" : agentFocus.includes(l.id) ? "bg-lime-fill/40 text-ink" : "bg-line-strong text-ink"
                          )}
                          style={{ left: `${left}%`, width: `${Math.max(2, w)}%` }}
                        >
                          <Icon size={10} className="shrink-0" aria-hidden />
                          <span className="truncate">{label}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </section>
  );

  return (
    <div className="relative flex h-full flex-col">
      <FontLoader families={[...FONT_CHOICES, ...textFamilies]} />
      <input
        ref={fileInputRef}
        type="file"
        hidden
        multiple
        accept="video/*,image/*,audio/*"
        onChange={(e) => {
          if (e.target.files?.length) ingestFiles(e.target.files);
        }}
      />
      {/* The one polite status region: phases, export steps, "Done". */}
      <p role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {announcement}
      </p>
      <a
        href="#loso-chat"
        onClick={(e) => {
          e.preventDefault();
          if (chatState !== "open") openChat();
          setTimeout(focusChat, 30);
        }}
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[200] focus:bg-lime-fill focus:px-3 focus:py-2 focus:text-[13px] focus:text-black"
      >
        Skip to Loso chat
      </a>

      {/* ---- the editor bar: one 52px line ----
          Never wraps: below 1280px the labels fold into icons (each keeps
          its name for screen readers and a tooltip), below 1024px Undo and
          Redo move into Versions, and the title truncates. */}
      <header
        className={cx(
          "flex shrink-0 items-center whitespace-nowrap border-b border-line",
          phone
            ? "h-[calc(52px+env(safe-area-inset-top))] gap-1 pl-[max(4px,env(safe-area-inset-left))] pr-[max(8px,env(safe-area-inset-right))] pt-[env(safe-area-inset-top)]"
            : "h-[52px] gap-1.5 pl-3 pr-3 lg:gap-3 lg:pl-4"
        )}
      >
        <Link
          href="/"
          aria-label="Loso: all your videos"
          title="All your videos"
          className={cx(
            "flex shrink-0 items-center gap-1.5 text-ink-dim transition-colors hover:text-lime",
            phone ? "h-11 min-w-11 justify-center" : "h-10 pr-1"
          )}
        >
          <ArrowLeft size={phone ? 18 : 14} aria-hidden />
          {!phone && <LosoLogo size={20} className="text-ink max-lg:[&>span:last-child]:hidden" />}
        </Link>
        {!phone && <span className="h-5 w-px shrink-0 bg-line-strong" aria-hidden />}
        <button
          hidden={phone}
          type="button"
          onClick={() => {
            const next = !railOpen;
            setRailOpen(next);
            // In a narrow window the pieces and the open chat don't both fit beside the video.
            if (next && dock.narrow && dock.state === "open") dock.setState("peek");
          }}
          aria-pressed={railShown}
          aria-controls="pieces-rail"
          title={railShown ? "Hide the pieces" : "Show the pieces"}
          aria-label="Pieces panel"
          className={cx("flex h-10 w-10 shrink-0 items-center justify-center transition-colors", railShown ? "text-ink" : "text-ink-dim hover:text-ink")}
        >
          <PanelLeft size={16} />
        </button>
        <div className="flex min-w-[8ch] max-w-[420px] shrink items-center">
          <EditableTitle
            value={title}
            onSave={async (next) => {
              setTitle(next);
              await backend.rename(next).catch(() => setError("Couldn't rename the video."));
            }}
          />
        </div>
        <span className="hidden min-w-0 shrink items-center gap-1.5 text-[12.5px] text-ink-dim min-[1400px]:flex">
          {backend.folder ? (
            <>
              <span className="shrink-0">saved in</span>
              <FolderOpen size={13} aria-hidden className="shrink-0" />
              <span className="max-w-[160px] truncate text-ink">{backend.folder.name}</span>
            </>
          ) : (
            <span>{backend.kind === "server" ? "saved by Loso" : "on this computer"}</span>
          )}
        </span>
        <SaveStatus
          state={saveState}
          compact={phone}
          onRetry={() => {
            pendingDoc.current ??= doc;
            flush();
          }}
        />
        <div className="min-w-0 flex-1" />

        <div data-tour="versions" className="hidden shrink-0 items-center lg:flex">
          <button
            onClick={undo}
            disabled={!canUndo || agentBusy}
            title="Undo (⌘Z)"
            aria-label="Undo"
            className="flex h-10 items-center gap-1.5 px-2.5 text-[13.5px] text-ink transition-colors hover:text-lime disabled:text-ink-faint"
          >
            <Undo2 size={15} aria-hidden /> <span className="hidden xl:inline">Undo</span>
          </button>
          <button
            onClick={redo}
            disabled={!canRedo || agentBusy}
            title="Redo (⇧⌘Z)"
            aria-label="Redo"
            className="flex h-10 w-9 items-center justify-center text-ink-dim transition-colors hover:text-lime disabled:text-ink-ghost"
          >
            <Redo2 size={15} />
          </button>
        </div>
        <button
          ref={versionsBtnRef}
          type="button"
          data-tour="versions"
          hidden={phone}
          aria-expanded={versionsOpen}
          aria-haspopup="dialog"
          aria-label={`Versions, ${versions.length}`}
          onClick={() => setVersionsOpen((v) => !v)}
          title={lastStep ? `Versions · last change: ${lastStep.meta.label} · ${clock(lastStep.meta.at)}` : "Versions"}
          className={cx(
            "flex h-10 shrink-0 items-center gap-1.5 px-2 text-[13.5px] transition-colors xl:px-2.5",
            versionsOpen ? "text-lime" : "text-ink hover:text-lime"
          )}
        >
          <HistoryIcon size={15} aria-hidden /> <span className="hidden xl:inline">Versions</span>
          <span className="font-mono text-[12px] text-ink-dim" aria-hidden>
            {versions.length}
          </span>
        </button>
        {/* Phones reach these through More (the button stays mounted for its shortcut). */}
        <span className={phone ? "hidden" : "contents"}>
        <PointAtItButton
          active={inbox.marking}
          onStart={inbox.startMarking}
          disabledReason={
            agentBusy
              ? "Wait until Loso finishes"
              : previewing
                ? "Go back to your latest version first"
                : layers.length === 0
                  ? "Add something to your video first"
                  : null
          }
        />
        </span>
        {!phone && <ThemeToggle accentHover />}
        <button
          type="button"
          hidden={phone}
          aria-haspopup="dialog"
          aria-label="Settings"
          data-tour="settings"
          title="Settings and your AI key (⌘ ,)"
          onClick={(e) => settings.open({ opener: e.currentTarget })}
          className="flex h-10 w-10 shrink-0 items-center justify-center text-ink-dim transition-colors hover:text-lime"
        >
          <Settings2 size={16} aria-hidden />
        </button>
        <button
          type="button"
          hidden={phone}
          data-tour="help"
          aria-label="Show me around"
          title="Show me around"
          onClick={() => showTour()}
          className="flex h-10 w-10 shrink-0 items-center justify-center text-ink-dim transition-colors hover:text-lime"
        >
          <CircleHelp size={16} aria-hidden />
        </button>
        {!phone && <span className="mx-1 h-5 w-px shrink-0 bg-line-strong" aria-hidden />}
        {phone && <PhoneMenu items={phoneMenu} />}
        {renderUrl && !rendering && !phone && (
          <a
            href={renderUrl}
            download={`${safeFileName(title)}.mp4`}
            aria-label={renderStale ? "Download old version" : "Download"}
            title={
              renderStale
                ? "This copy is from before your latest changes"
                : savedAs
                  ? `Already saved in your folder as ${savedAs}. This saves one more copy.`
                  : "Download the video"
            }
            className={cx(
              "flex h-10 shrink-0 items-center gap-1.5 px-2 text-[13px] transition-colors hover:text-lime",
              renderStale ? "text-ink-dim" : "text-ink"
            )}
          >
            <Download size={14} aria-hidden />
            <span className="hidden xl:inline">{renderStale ? "Download old version" : "Download"}</span>
          </a>
        )}
        <Button
          ref={makeBtnRef}
          data-tour="make"
          // Busy isn't "unavailable": no dimmed lime while making (it read
          // poorly on paper). The button stays readable and simply waits.
          variant={rendering ? "outline" : "primary"}
          onClick={() => {
            if (!rendering) exportVideo();
          }}
          disabled={!rendering && layers.length === 0}
          aria-disabled={rendering || undefined}
          aria-busy={rendering || undefined}
          title={
            layers.length === 0
              ? "Add something to your video first"
              : rendering
                ? "Keep this tab open while Loso makes your video"
                : renderUrl && renderStale
                  ? "You've changed things since you last made it. This makes a new video with your changes."
                  : undefined
          }
          className={cx("shrink-0", phone && "h-11 px-4 text-[14.5px]", rendering && "pointer-events-none")}
        >
          {rendering && <LosoMark working size={18} />}
          {rendering ? (
            <span className="min-w-[8.5ch] text-left tabular-nums">
              {renderProgress !== null ? `Making… ${Math.round(renderProgress * 100)}%` : `Making… ${renderElapsed}s`}
            </span>
          ) : renderUrl && renderStale ? (
            "Update the video"
          ) : (
            "Make the video"
          )}
        </Button>
      </header>
      {rendering && (
        <p
          className={cx(
            "pointer-events-none absolute z-40 border border-line-strong bg-ground px-3 py-1.5 text-[12.5px] text-ink-dim shadow-[0_12px_30px_-12px_var(--color-shade)]",
            phone ? "left-2 right-2 top-[calc(58px+env(safe-area-inset-top))] text-center" : "right-3 top-[58px]"
          )}
        >
          {phone
            ? "Keep Loso open and the screen on while it makes your video."
            : "Keep this tab open while Loso makes your video."}
        </p>
      )}

      {error && (
        <div className="flex shrink-0 items-start gap-3 border-b border-danger/40 bg-ground px-5 py-2.5">
          <InlineError onDismiss={() => setError(null)} className="flex-1">
            {error}
          </InlineError>
        </div>
      )}

      <div
        className={cx("relative min-h-0 flex-1", phone ? "grid" : "flex")}
        style={
          phone
            ? landscape
              ? {
                  gridTemplateColumns: "minmax(0, 1fr) minmax(280px, 44%)",
                  gridTemplateRows: "auto minmax(0, 1fr)",
                  gridTemplateAreas: '"stage tabs" "stage panel"',
                  paddingRight: "env(safe-area-inset-right)",
                  paddingBottom: "env(safe-area-inset-bottom)",
                }
              : {
                  gridTemplateColumns: "minmax(0, 1fr)",
                  // The video's own shape decides how tall the stage is, up to a bit under half the screen.
                  gridTemplateRows: `clamp(180px, calc((100vw - 24px) * ${(output.height / output.width).toFixed(4)} + 24px), 46dvh) auto minmax(0, 1fr)`,
                  gridTemplateAreas: '"stage" "tabs" "panel"',
                  paddingBottom: "env(safe-area-inset-bottom)",
                }
            : undefined
        }
      >
        {phone && (
          <PhoneTabs
            tab={phoneTab}
            setTab={setPhoneTab}
            status={dockStatus}
            agent={backend.agent}
            pieces={layers.length}
            seconds={durationSec.toFixed(durationSec % 1 ? 1 : 0)}
          />
        )}
        {/* ---- pieces rail ---- */}
        {railShown && (
          <aside
            id="pieces-rail"
            ref={railRef}
            aria-label="Pieces of your video"
            inert={agentBusy || undefined}
            aria-busy={agentBusy}
            className={cx(
              "flex shrink-0 flex-col overflow-y-auto transition-opacity",
              phone ? "min-h-0 min-w-0 overscroll-contain [grid-area:panel]" : cx("border-r border-line", showWords ? "w-[380px]" : "w-[300px]"),
              agentBusy && "opacity-50"
            )}
          >
            {agentBusy && (
              <p className="border-b border-line px-5 py-3 text-[13px] leading-snug text-ink">
                Paused while Loso edits. Press Stop to take over.
              </p>
            )}
            {showWords ? (
              <WordsOnScreen
                doc={doc}
                activeId={selectedIsCaption ? selectedId : null}
                onSelect={(id) => setSelectedId(id)}
                change={changeWords}
                playerRef={playerRef}
                onBack={() => {
                  setWordsOpen(false);
                  setSelectedId(null);
                }}
                onUndo={undo}
                announce={announce}
                onAsk={backend.agent ? () => askLoso("Add words on screen (captions) for what is said in the video") : undefined}
                title={title}
              />
            ) : !selected ? (
              <div className="flex flex-col gap-7 p-5">
                {/* add */}
                <section aria-labelledby="add-h" className="flex flex-col gap-2.5">
                  <RailHeading id="add-h">Add</RailHeading>
                  <div className="flex flex-col border-t border-line">
                    <RailAction
                      icon={Plus}
                      label={phone || backend.folder?.inBrowser ? "Add videos, photos and sounds" : "Add files from your computer"}
                      onClick={pickFiles}
                    />
                    <RailAction icon={TypeIcon} label="Add words" onClick={addText} />
                    <RailAction icon={WordsIcon} label="Words on screen (subtitles)" onClick={() => setWordsOpen(true)} />
                  </div>
                  <p role="status" className="min-h-[18px] text-[12.5px] text-lime">
                    {uploading
                      ? `${backend.kind === "local" ? "Adding" : "Uploading"} ${uploading.n > 1 ? `${uploading.i} of ${uploading.n}: ` : ""}${uploading.name}`
                      : ""}
                  </p>
                </section>

                {backend.folder && (
                  <FolderTray
                    folder={backend.folder}
                    version={folderVersion}
                    used={new Set(mediaRefs(doc))}
                    onAdd={(entry) =>
                      addMediaLayer(entry.kind, backend.folder!.refFor(entry), entry.name.replace(/\.[^.]+$/, ""))
                    }
                  />
                )}

                <TemplatesSection
                  templates={backend.templates}
                  doc={doc}
                  beforeApply={() => flush()}
                  onApplied={(next, name) => adoptExternal(next, `tpl-${Date.now()}`, `Started from ${name}`)}
                />

                {/* pieces list */}
                <section aria-labelledby="pieces-h" className="flex flex-col gap-2.5" data-pieces>
                  <RailHeading id="pieces-h">In your video</RailHeading>
                  {sortedLayers.length === 0 && (
                    <p className="text-[13px] leading-relaxed text-ink-dim">
                      Nothing yet. Drop a video, picture or sound anywhere, or tell Loso what you want.
                    </p>
                  )}
                  <ul className="flex flex-col border-t border-line">
                    {sortedLayers.map((l) => {
                      // all captions fold into one "Words on screen" entry
                      if (isCaption(l))
                        return l.id === sortedLayers.find(isCaption)?.id ? (
                          <WordsPiecesRow key="words-on-screen" doc={doc} onOpen={() => setWordsOpen(true)} />
                        ) : null;
                      const Icon = TYPE_ICON[l.type];
                      const label = layerLabel(l);
                      return (
                        <li key={l.id} className="group flex items-center gap-1 border-b border-line">
                          {renamingId === l.id ? (
                            <input
                              autoFocus
                              defaultValue={label}
                              aria-label="Name"
                              onBlur={(e) => {
                                const name = e.target.value.trim();
                                if (name && name !== label) patchLayer(l.id, { name });
                                setRenamingId(null);
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") e.currentTarget.blur();
                                if (e.key === "Escape") setRenamingId(null);
                              }}
                              className="uline my-1.5 min-w-0 flex-1 !py-1 text-[13.5px]"
                            />
                          ) : (
                            <button
                              type="button"
                              onClick={() => setSelectedId(l.id)}
                              onDoubleClick={() => setRenamingId(l.id)}
                              onKeyDown={(e) => {
                                if (e.key === "F2") {
                                  e.preventDefault();
                                  setRenamingId(l.id);
                                }
                              }}
                              className="flex min-h-10 min-w-0 flex-1 items-center gap-2.5 text-left text-[13.5px] text-ink-dim transition-colors hover:text-ink"
                            >
                              <Icon size={14} className="shrink-0" aria-hidden />
                              <span className="w-[54px] shrink-0 text-[12px] text-ink-faint">{KIND_WORD[l.type]}</span>
                              <span className="min-w-0 flex-1 truncate text-ink">
                                {label}
                                {l.type !== "text" && assetUrls[l.assetHash] === null && (
                                  <span className="ml-1.5 text-danger">missing<span className="sr-only">: file not found in the folder</span></span>
                                )}
                              </span>
                            </button>
                          )}
                          <div className="flex items-center opacity-60 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                            <IconBtn label={`Move ${label} in front`} title="Move in front ( ] )" onClick={() => reorder(l.id, 1)}>
                              <ChevronUp size={14} />
                            </IconBtn>
                            <IconBtn label={`Move ${label} behind`} title="Move behind ( [ )" onClick={() => reorder(l.id, -1)}>
                              <ChevronDown size={14} />
                            </IconBtn>
                            <IconBtn label={`Remove ${label}`} title="Remove (you can undo)" onClick={() => removeLayer(l.id)} danger>
                              <Trash2 size={13} />
                            </IconBtn>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </section>

                {/* video settings, tucked away */}
                <details className="group border-t border-line pt-4">
                  <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between text-[13.5px] text-ink">
                    Video settings
                    <span className="text-[12.5px] text-ink-dim">
                      {SHAPE_WORD[activePreset?.id ?? ""] ?? "Custom"} · {durationSec.toFixed(durationSec % 1 ? 1 : 0)}s
                    </span>
                  </summary>
                  <div className="mt-3 flex flex-col gap-3.5">
                    <label className="flex flex-col gap-1">
                      <span className="text-[12.5px] text-ink-dim">Shape</span>
                      <Select
                        value={activePreset?.id ?? "custom"}
                        onChange={(e) => {
                          const p = OUTPUT_PRESETS.find((x) => x.id === e.target.value);
                          if (p) applyPreset(p.width, p.height);
                        }}
                      >
                        {OUTPUT_PRESETS.map((p) => (
                          <option key={p.id} value={p.id}>
                            {SHAPE_WORD[p.id] ?? p.label}
                          </option>
                        ))}
                        {!activePreset && <option value="custom">Custom</option>}
                      </Select>
                      {layers.length > 0 && (
                        <span className="text-[12px] text-ink-dim">Changing the shape resizes everything to fit.</span>
                      )}
                    </label>
                    <NumRow
                      wide
                      label="Length (s)"
                      step={0.5}
                      min={0.5}
                      value={Number(durationSec.toFixed(2))}
                      onChange={(v) => setOutput({ durationInFrames: Math.max(1, Math.round(v * output.fps)) })}
                    />
                    <label className="flex items-center gap-2">
                      <span className="w-[92px] shrink-0 text-[12.5px] text-ink-dim">Background</span>
                      <input
                        type="color"
                        aria-label="Background colour"
                        value={output.background ?? "#000000"}
                        onChange={(e) => setOutput({ background: e.target.value })}
                      />
                    </label>
                    <details>
                      <summary className="flex min-h-8 cursor-pointer list-none items-center text-[12.5px] text-ink-dim hover:text-ink">
                        Advanced ▸
                      </summary>
                      <div className="mt-2 grid grid-cols-1 gap-2.5">
                        <NumRow wide label="Width (px)" value={output.width} min={16} onChange={(v) => setOutput({ width: Math.max(16, v) })} />
                        <NumRow wide label="Height (px)" value={output.height} min={16} onChange={(v) => setOutput({ height: Math.max(16, v) })} />
                        <NumRow wide label="Frames / sec" value={output.fps} min={1} onChange={(v) => setOutput({ fps: Math.max(1, v) })} />
                      </div>
                    </details>
                  </div>
                </details>
              </div>
            ) : (
              <Inspector
                selected={selected}
                patchLayer={patchLayer}
                removeLayer={removeLayer}
                align={align}
                sec={sec}
                frames={frames}
                onBack={() => setSelectedId(null)}
                onAsk={() => askLoso(`Change the ${KIND_WORD[selected.type].toLowerCase()} “${layerLabel(selected)}” so `)}
                hasAgent={backend.agent}
              />
            )}
          </aside>
        )}

        {/* ---- the stage ---- */}
        <section
          ref={stageSectionRef}
          aria-label="Preview of your video"
          className={cx("relative flex min-w-0 flex-col bg-void", phone ? "min-h-0 [grid-area:stage]" : "flex-1")}
        >
          {/* With footage on it the well goes dark in both themes (a lightbox:
              paper around a video skews how its colours read). Empty, it stays
              the page colour so the invitation reads like the rest of Loso. */}
          <div
            className={cx(
              "relative min-h-0 flex-1 transition-colors duration-300",
              (layers.length > 0 || previewing) && "bg-stage"
            )}
            onPointerDown={() => setSelectedId(null)}
          >
            {/* the safe area: everything left of the floating dock */}
            <div
              ref={stageRef}
              className={cx("absolute flex items-center justify-center", phone ? "bottom-3 left-3" : "bottom-7 left-8")}
              style={{
                right: safeRight + (phone ? 12 : 32),
                top: inbox.marking && markBarH ? markBarH + (phone ? 8 : 20) : phone ? 12 : 28,
              }}
            >
              {dispW > 0 && (layers.length > 0 || previewing) && (
                <div
                  data-tour="stage"
                  className="theme-dark relative shrink-0 shadow-[0_30px_90px_-30px_rgba(0,0,0,0.9)]"
                  style={{ width: dispW, height: dispH }}
                  onPointerDown={(e) => e.stopPropagation()}
                >
                  <Player
                    ref={playerRef}
                    component={CompositorComposition}
                    durationInFrames={Math.max(1, shownDoc.output.durationInFrames)}
                    fps={shownDoc.output.fps}
                    compositionWidth={shownDoc.output.width}
                    compositionHeight={shownDoc.output.height}
                    inputProps={{ doc: resolved }}
                    style={{ width: "100%", height: "100%" }}
                    // open past the intro animations so a paused canvas shows the design, not a black frame 0
                    initialFrame={Math.min(Math.max(0, output.durationInFrames - 1), Math.round(output.fps * 1.5))}
                    controls
                    loop
                  />

                  {previewing && (
                    <div className="pointer-events-none absolute inset-0 z-20 border-2 border-dashed border-lime/70" aria-hidden />
                  )}

                  {/* where Loso is working right now */}
                  {!previewing &&
                    agentFocus.map((id) => {
                      const l = layers.find((x) => x.id === id);
                      if (!l || l.type === "audio") return null;
                      return (
                        <div
                          key={id}
                          aria-hidden
                          className="pointer-events-none absolute z-10 border border-lime motion-safe:transition-opacity"
                          style={{ left: l.x * fit, top: l.y * fit, width: l.width * fit, height: l.height * fit }}
                        >
                          <span className="absolute -top-[22px] left-0 whitespace-nowrap bg-lime-fill px-1.5 py-0.5 text-[11.5px] font-medium text-black">
                            Loso: {layerLabel(l).slice(0, 24)}
                          </span>
                        </div>
                      );
                    })}

                  {/* "Point at it": draw on the frame to show Loso what to fix */}
                  {inbox.marking && (
                    <PointAtIt
                      doc={shownDoc}
                      resolved={resolved}
                      playerRef={playerRef}
                      fit={fit}
                      selected={selected}
                      barHost={stageSectionRef.current}
                      barRight={safeRight}
                      onBarHeight={setMarkBarH}
                      agent={backend.agent}
                      onCancel={inbox.stopMarking}
                      onSend={inbox.onMarked}
                      onSave={backend.saveNote ? (f) => backend.saveNote!(f.name, f) : undefined}
                      announce={announce}
                    />
                  )}

                  {/* selection overlay */}
                  {selected && selected.type !== "audio" && !previewing && (
                    <div
                      role="group"
                      aria-label={`Selected: ${layerLabel(selected)}`}
                      className="absolute z-10 cursor-move border border-lime"
                      style={{
                        left: selected.x * fit,
                        top: selected.y * fit,
                        width: selected.width * fit,
                        height: selected.height * fit,
                        transform: `rotate(${selected.rotation}deg)`,
                        transformOrigin: "center center",
                      }}
                      onPointerDown={beginMove}
                    >
                      {(["nw", "ne", "sw", "se"] as const).map((c) => (
                        // 20px transparent hit area around a 10px visual dot
                        <span
                          key={c}
                          onPointerDown={(e) => beginResize(e, c)}
                          className="absolute flex h-5 w-5 items-center justify-center"
                          style={{
                            left: c.includes("w") ? -10 : undefined,
                            right: c.includes("e") ? -10 : undefined,
                            top: c.includes("n") ? -10 : undefined,
                            bottom: c.includes("s") ? -10 : undefined,
                            cursor: c === "nw" || c === "se" ? "nwse-resize" : "nesw-resize",
                          }}
                        >
                          <span className="h-2.5 w-2.5 rounded-full border border-black bg-lime" />
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* empty video: the stage becomes the invitation. The starter
                  prompts live in one place: in the chat while it's open, here
                  while it's folded away. */}
              {layers.length === 0 && !previewing && (
                <div
                  className={cx("absolute inset-0 z-20 flex items-center justify-center", phone ? "p-2" : "p-6")}
                  onPointerDown={(e) => e.stopPropagation()}
                >
                  <div data-tour="stage" className={cx("flex max-w-[440px] flex-col", phone ? "gap-3" : "gap-5")}>
                    {phone ? (
                      <>
                        <p className="font-serif text-[30px] font-light italic leading-[1.05] tracking-tight text-ink">
                          Start with your clips.
                        </p>
                        <p className="text-[14.5px] leading-relaxed text-ink-dim">
                          {backend.folder?.inBrowser && backend.agent
                            ? "Your clips are in. Tell Loso below what to make, or put one in yourself from Your clips."
                            : backend.agent
                              ? "Put a video or photo in, then tell Loso below what to make."
                              : "Put a video or photo in to start."}
                        </p>
                      </>
                    ) : chatState === "open" && backend.agent ? (
                      <>
                        <p className="font-serif text-[clamp(30px,3.4vw,44px)] font-light italic leading-[1.05] tracking-tight text-ink">
                          Start with your clips.
                        </p>
                        <p className="text-[14.5px] leading-relaxed text-ink-dim">
                          Add the videos, pictures and sounds for this one, then tell Loso what to make in the chat.
                        </p>
                      </>
                    ) : (
                      <>
                        <p className="font-serif text-[clamp(30px,3.4vw,44px)] font-light italic leading-[1.05] tracking-tight text-ink">
                          What are we making?
                        </p>
                        <ul className="flex flex-col border-t border-line">
                          {STARTERS.map((s) => (
                            <li key={s} className="border-b border-line">
                              <button
                                type="button"
                                onClick={() => askLoso(s)}
                                className="group flex min-h-11 w-full items-center gap-3 py-2 text-left font-serif text-[17px] italic text-ink-dim transition-colors hover:text-ink"
                              >
                                <span className="flex-1">“{s}”</span>
                                <span className="text-[12px] not-italic text-ink-faint transition-colors group-hover:text-lime">Ask Loso →</span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                    {phone ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <Button variant="outline" className="h-11 px-5" onClick={pickFiles}>
                          <Plus size={15} aria-hidden /> Add videos and photos
                        </Button>
                        {backend.folder && (
                          <Button variant="ghost" className="h-11 px-3" onClick={() => setPhoneTab("pieces")}>
                            Your clips
                          </Button>
                        )}
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[13.5px] text-ink-dim">
                        <Button size="sm" variant="outline" onClick={pickFiles}>
                          <Plus size={14} aria-hidden /> Add files
                        </Button>
                        <span>or drop videos, pictures and sounds anywhere.</span>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* ribbons: Loso working / looking at an older version */}
            {(agentBusy || previewing) && (
              <div
                className="pointer-events-none absolute left-0 top-3 z-30 flex justify-center"
                style={{ right: safeRight }}
              >
                {previewing && preview ? (
                  <div className="pointer-events-auto flex items-center gap-3 border border-lime/60 bg-ground/95 py-1.5 pl-4 pr-1.5 text-[13px] text-ink">
                    Looking at an earlier version · {clock(preview.meta.at)}
                    <Button
                      size="sm"
                      onClick={() => {
                        if (previewIndex !== null) dispatch({ type: "restore", index: previewIndex });
                        setVersionsOpen(false);
                        announce(`Went back to the version from ${clock(preview.meta.at)}`);
                      }}
                    >
                      Go back to this
                    </Button>
                  </div>
                ) : (
                  <div className="pointer-events-auto flex items-center gap-3 border border-lime/50 bg-ground/95 py-1 pl-4 pr-1 text-[13px] text-ink">
                    <LosoMark working size={18} />
                    <span className="max-w-[340px] truncate">Loso is working · {dockStatus.phase ?? "thinking"}</span>
                    {backend.agent && (
                      <button
                        type="button"
                        onClick={() => chat.current?.stop()}
                        className="flex h-9 items-center gap-1.5 px-3 text-ink transition-colors hover:text-danger"
                      >
                        <Square size={10} fill="currentColor" aria-hidden /> Stop
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {!phone && storySection}
        </section>
        {phone && phoneTab === "story" && storySection}

        {/* ---- Loso, floating ---- */}
        <ChatDock
          state={dock.state}
          setState={dock.setState}
          width={dock.width}
          setWidth={dock.setWidth}
          status={dockStatus}
          focusInside={focusChat}
          phone={phone ? { visible: phoneTab === "loso" } : null}
        >
          {(controls) =>
            backend.agent ? (
              <ChatPanel
                api={chatApi}
                projectId={backend.projectId}
                onDoc={onAgentDoc}
                onBusyChange={onAgentBusy}
                beforeSend={agentBeforeSend}
                canUndoTurn={canUndoTurn}
                onUndoTurn={undo}
                dockControls={controls}
                controlRef={chat}
                onStatus={setDockStatus}
                announce={announce}
                dockOpen={chatState === "open"}
                onPutInVideo={inbox.putInVideo}
              />
            ) : null
          }
        </ChatDock>

        {ready && (
          <VideoReady
            url={ready.url}
            fileName={`${safeFileName(title)}${ready.test ? " (test)" : ""}.mp4`}
            savedAs={ready.savedAs}
            folderName={backend.folder?.name}
            inBrowser={backend.folder?.inBrowser}
            aspect={output.width / output.height}
            right={safeRight}
            onClose={() => {
              // A test copy's link isn't kept anywhere else: free it.
              if (ready.test && ready.url.startsWith("blob:")) URL.revokeObjectURL(ready.url);
              setReady(null);
              requestAnimationFrame(() => makeBtnRef.current?.focus());
            }}
          />
        )}
        {versionsOpen && (
          <VersionsPanel
            hist={hist}
            onPreview={onPreview}
            onRestore={(i) => {
              const at = versions[i]?.meta.at;
              dispatch({ type: "restore", index: i });
              setVersionsOpen(false);
              versionsBtnRef.current?.focus();
              if (at) announce(`Went back to the version from ${clock(at)}`);
            }}
            onUndo={undo}
            onRedo={redo}
            onClose={() => {
              setVersionsOpen(false);
              versionsBtnRef.current?.focus();
            }}
          />
        )}
      </div>

      <Tour id={phone ? "editor-phone" : "editor"} steps={phone ? phoneEditorSteps : editorSteps} />
      {dragTypes && <DropOverlay types={dragTypes} {...inbox.dropProps(dragTypes)} />}
      {inbox.choiceNode(safeRight)}
      {heavyAsk && (
        <HeavyJobAsk
          est={heavyAsk.est}
          unreadable={heavyAsk.unreadable}
          canTest={backend.kind === "local"}
          right={safeRight}
          onChoose={heavyAsk.resolve}
        />
      )}
    </div>
  );
}

// ---------- rail bits ----------

function RailAction({ icon: Icon, label, onClick }: { icon: typeof Film; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex min-h-11 items-center gap-3 border-b border-line text-left text-[13.5px] text-ink transition-colors hover:text-lime"
    >
      <Icon size={15} className="shrink-0 text-ink-dim transition-colors group-hover:text-lime" aria-hidden />
      {label}
    </button>
  );
}

function IconBtn({
  label,
  title,
  onClick,
  danger,
  children,
}: {
  label: string;
  title: string;
  onClick: () => void;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={label}
      className={cx(
        "flex h-8 w-8 items-center justify-center text-ink-dim transition-colors",
        danger ? "hover:text-danger" : "hover:text-ink"
      )}
    >
      {children}
    </button>
  );
}

function AlignBtn({ icon: Icon, title, onClick }: { icon: typeof Film; title: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title={`Line up ${title.toLowerCase()}`}
      aria-label={`Line up ${title.toLowerCase()}`}
      className="flex h-9 w-9 items-center justify-center text-ink-dim transition-colors hover:text-lime"
    >
      <Icon size={15} />
    </button>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 border-t border-line pt-4">
      <h3 className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-dim">{title}</h3>
      {children}
    </div>
  );
}

// ---------- the inspector for one piece ----------

function Inspector({
  selected,
  patchLayer,
  removeLayer,
  align,
  sec,
  frames,
  onBack,
  onAsk,
  hasAgent,
}: {
  selected: Layer;
  patchLayer: (id: string, patch: Partial<Layer>) => void;
  removeLayer: (id: string) => void;
  align: (edge: "left" | "hcenter" | "right" | "top" | "vcenter" | "bottom") => void;
  sec: (frames: number) => number;
  frames: (s: number) => number;
  onBack: () => void;
  onAsk: () => void;
  hasAgent: boolean;
}) {
  const label = layerLabel(selected);
  return (
    <div className="flex flex-col gap-5 p-5">
      <button
        type="button"
        onClick={onBack}
        className="flex min-h-10 items-center gap-1.5 self-start text-[13px] text-ink-dim transition-colors hover:text-ink"
      >
        <ArrowLeft size={14} aria-hidden /> All pieces
      </button>
      <div>
        <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-lime">{KIND_WORD[selected.type]}</p>
        <h2 className="mt-1 truncate font-serif text-[22px] italic leading-tight text-ink">{label}</h2>
      </div>
      {hasAgent && (
        <button
          type="button"
          onClick={onAsk}
          className="flex min-h-10 items-center self-start border-b border-lime/60 text-[13.5px] text-ink transition-colors hover:text-lime"
        >
          Ask Loso about this →
        </button>
      )}

      {selected.type === "text" && (
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[12.5px] text-ink-dim">Words</span>
            <textarea
              rows={3}
              value={selected.text}
              onChange={(e) => patchLayer(selected.id, { text: e.target.value })}
              className="w-full resize-none border border-edge/70 bg-ground px-3 py-2 text-[14px] text-ink outline-none focus:border-lime/70"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[12.5px] text-ink-dim">Font</span>
            <Select value={selected.fontFamily} onChange={(e) => patchLayer(selected.id, { fontFamily: e.target.value })}>
              {FONT_CHOICES.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </Select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <NumRow label="Size" value={selected.fontSize} min={4} onChange={(v) => patchLayer(selected.id, { fontSize: Math.max(4, v) })} />
            <NumRow label="Weight" step={100} value={selected.fontWeight} onChange={(v) => patchLayer(selected.id, { fontWeight: v })} />
          </div>
          <div className="flex items-center justify-between gap-3">
            <label className="flex items-center gap-2">
              <span className="text-[12.5px] text-ink-dim">Colour</span>
              <input
                type="color"
                aria-label="Text colour"
                value={selected.color}
                onChange={(e) => patchLayer(selected.id, { color: e.target.value })}
              />
            </label>
            <button
              onClick={() => patchLayer(selected.id, { italic: !selected.italic })}
              aria-pressed={selected.italic}
              className={cx(
                "flex h-9 items-center px-3 font-serif text-[15px] italic transition-colors",
                selected.italic ? "border-b border-lime text-lime" : "text-ink-dim hover:text-ink"
              )}
            >
              Slanted
            </button>
            <Select
              className="!w-auto"
              aria-label="Line up the words"
              value={selected.align}
              onChange={(e) => patchLayer(selected.id, { align: e.target.value as "left" | "center" | "right" })}
            >
              <option value="left">Left</option>
              <option value="center">Middle</option>
              <option value="right">Right</option>
            </Select>
          </div>
        </div>
      )}

      {(selected.type === "video" || selected.type === "image") && (
        <label className="flex flex-col gap-1">
          <span className="text-[12.5px] text-ink-dim">How it fits</span>
          <Select
            value={selected.objectFit}
            onChange={(e) => patchLayer(selected.id, { objectFit: e.target.value as "cover" | "contain" })}
          >
            <option value="cover">Fill the box</option>
            <option value="contain">Show all of it</option>
          </Select>
        </label>
      )}

      {(selected.type === "video" || selected.type === "audio") && (
        <div className="flex flex-col gap-2.5">
          <SliderRow
            label="Loudness"
            min={0}
            max={1}
            step={0.05}
            value={selected.volume}
            onChange={(v) => patchLayer(selected.id, { volume: v })}
          />
          <NumRow
            wide
            label="Start clip at (s)"
            step={0.1}
            value={sec(selected.trimStart)}
            min={0}
            onChange={(v) => patchLayer(selected.id, { trimStart: Math.max(0, frames(v)) })}
          />
        </div>
      )}

      <Group title="When it shows">
        <div className="grid grid-cols-1 gap-2.5">
          <NumRow
            wide
            label="Shows at (s)"
            step={0.1}
            value={sec(selected.from)}
            min={0}
            onChange={(v) => patchLayer(selected.id, { from: Math.max(0, frames(v)) })}
          />
          <NumRow
            wide
            label="For (s)"
            step={0.1}
            value={sec(selected.durationInFrames)}
            min={0.05}
            onChange={(v) => patchLayer(selected.id, { durationInFrames: Math.max(1, frames(v)) })}
          />
        </div>
      </Group>

      {selected.type !== "audio" && (
        <Group title="Comes in">
          <Select
            aria-label="How it comes in"
            value={selected.anim?.preset ?? "none"}
            onChange={(e) => {
              const preset = e.target.value as Anim["preset"];
              const cur = selected.anim ?? { preset: "none", delay: 0, duration: 18 };
              patchLayer(selected.id, { anim: { ...cur, preset } });
            }}
          >
            <option value="none">Just appears</option>
            <option value="fade">Fade</option>
            <option value="rise">Slide up</option>
            <option value="scale">Pop</option>
            <option value="hero">Big entrance</option>
          </Select>
          {selected.anim && selected.anim.preset !== "none" && (
            <div className="grid grid-cols-1 gap-2.5">
              <NumRow
                wide
                label="Wait (s)"
                step={0.1}
                value={sec(selected.anim.delay)}
                min={0}
                onChange={(v) => patchLayer(selected.id, { anim: { ...(selected.anim as Anim), delay: Math.max(0, frames(v)) } })}
              />
              <NumRow
                wide
                label="Takes (s)"
                step={0.1}
                value={sec(selected.anim.duration)}
                min={0.05}
                onChange={(v) => patchLayer(selected.id, { anim: { ...(selected.anim as Anim), duration: Math.max(1, frames(v)) } })}
              />
            </div>
          )}
        </Group>
      )}

      {selected.type !== "audio" && (
        <Group title="Place">
          <div className="flex items-center">
            <AlignBtn icon={AlignStartVertical} title="Left" onClick={() => align("left")} />
            <AlignBtn icon={AlignCenterVertical} title="Center" onClick={() => align("hcenter")} />
            <AlignBtn icon={AlignEndVertical} title="Right" onClick={() => align("right")} />
            <span className="mx-1 h-4 w-px bg-line-strong" aria-hidden />
            <AlignBtn icon={AlignStartHorizontal} title="Top" onClick={() => align("top")} />
            <AlignBtn icon={AlignCenterHorizontal} title="Middle" onClick={() => align("vcenter")} />
            <AlignBtn icon={AlignEndHorizontal} title="Bottom" onClick={() => align("bottom")} />
          </div>
          <details>
            <summary className="flex min-h-8 cursor-pointer list-none items-center text-[12.5px] text-ink-dim hover:text-ink">More controls ▸</summary>
            <div className="mt-3 flex flex-col gap-2.5">
              <div className="grid grid-cols-2 gap-3">
                <NumRow label="Across" value={selected.x} onChange={(v) => patchLayer(selected.id, { x: v })} />
                <NumRow label="Down" value={selected.y} onChange={(v) => patchLayer(selected.id, { y: v })} />
                <NumRow label="Width" value={selected.width} min={1} onChange={(v) => patchLayer(selected.id, { width: Math.max(1, v) })} />
                <NumRow label="Height" value={selected.height} min={1} onChange={(v) => patchLayer(selected.id, { height: Math.max(1, v) })} />
                <NumRow label="Turn" value={selected.rotation} onChange={(v) => patchLayer(selected.id, { rotation: v })} />
                <NumRow label="Corners" value={selected.radius ?? 0} min={0} onChange={(v) => patchLayer(selected.id, { radius: Math.max(0, v) })} />
                <NumRow label="Outline" value={selected.borderWidth ?? 0} min={0} onChange={(v) => patchLayer(selected.id, { borderWidth: Math.max(0, v) })} />
                <label className="flex items-center gap-2">
                  <span className="w-[58px] shrink-0 text-[12.5px] text-ink-dim">Outline colour</span>
                  <input
                    type="color"
                    aria-label="Outline colour"
                    value={selected.borderColor ?? "#ffffff"}
                    onChange={(e) => patchLayer(selected.id, { borderColor: e.target.value })}
                  />
                </label>
              </div>
              <SliderRow
                label="See-through"
                min={0}
                max={1}
                step={0.05}
                value={selected.opacity}
                onChange={(v) => patchLayer(selected.id, { opacity: v })}
              />
              <label className="flex flex-col gap-1" title="Marks the part that changes per video when this is saved as a starting point">
                <span className="text-[12.5px] text-ink-dim">Changes every video (name it)</span>
                <input
                  value={selected.slot ?? ""}
                  placeholder="stays the same"
                  onChange={(e) => patchLayer(selected.id, { slot: e.target.value.replace(/\s+/g, "_").toLowerCase() || undefined })}
                  className="uline !py-1 font-mono text-[12.5px]"
                />
              </label>
            </div>
          </details>
        </Group>
      )}

      <Button variant="danger" size="sm" className="self-start" onClick={() => removeLayer(selected.id)}>
        <Trash2 size={13} aria-hidden /> Remove this (you can undo)
      </Button>
    </div>
  );
}
