"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { PlayerRef } from "@remotion/player";
import { ArrowLeft, Download, Minus, Play, Plus, Scissors, Trash2, Upload } from "lucide-react";
import { cx } from "@/components/ui";
import { FONT_CHOICES } from "@/lib/brand";
import type { CompositorDoc, TextLayer } from "@/lib/compositor";
import {
  MAX_LINE,
  POSITIONS,
  addLineAt,
  captionsOf,
  clockTime,
  lineBounds,
  longLines,
  mergeWithPrevious,
  nudgeLine,
  parseSrt,
  positionY,
  replaceWithCues,
  retimeLine,
  setLineText,
  shiftAll,
  shortenAll,
  splitLine,
  spokenTime,
  styleAll,
  toSrt,
  type CaptionLook,
  type CaptionPosition,
} from "@/lib/caption-set";

// ---------- "Words on screen": every caption as one editable list ----------
// Lives in the pieces rail. Each line is its words plus its time; the line
// you're on is selected in the editor, so the stage outlines it and the player
// jumps there. All edits go through the editor's undo history with plain labels.

type Change = (updater: (d: CompositorDoc) => CompositorDoc, label: string) => void;

/** The frame where a line is fully in (past its entrance), so a seek shows it. */
export function visibleFrame(c: TextLayer): number {
  const settle = (c.anim && c.anim.preset !== "none" ? c.anim.delay + c.anim.duration : 0) + 1;
  return c.from + Math.max(0, Math.min(c.durationInFrames - 1, settle));
}

/** The playhead, read a few times a second (cheap, and survives the Player remounting). */
function usePlayhead(playerRef: React.RefObject<PlayerRef | null>) {
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    const read = () => {
      const p = playerRef.current;
      if (!p) return;
      setFrame(p.getCurrentFrame());
      setPlaying(p.isPlaying());
    };
    read();
    const t = setInterval(read, 200);
    return () => clearInterval(t);
  }, [playerRef]);
  return { frame, playing };
}

export function WordsOnScreen({
  doc,
  activeId,
  onSelect,
  change,
  playerRef,
  onBack,
  onUndo,
  announce,
  onAsk,
  title,
}: {
  doc: CompositorDoc;
  activeId: string | null;
  onSelect: (id: string | null) => void;
  change: Change;
  playerRef: React.RefObject<PlayerRef | null>;
  onBack: () => void;
  onUndo: () => void;
  announce: (s: string) => void;
  onAsk?: () => void;
  title: string;
}) {
  const { fps, durationInFrames: total } = doc.output;
  const caps = useMemo(() => captionsOf(doc), [doc]);
  const active = caps.find((c) => c.id === activeId) ?? null;
  const [tab, setTab] = useState<"lines" | "look">("lines");
  const { frame, playing } = usePlayhead(playerRef);
  const lineRefs = useRef(new Map<string, HTMLTextAreaElement>());
  const pendingFocus = useRef<{ id: string; caret: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [removed, setRemoved] = useState<{ doc: CompositorDoc; text: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const seek = useCallback(
    (f: number) => {
      const p = playerRef.current;
      if (!p) return;
      p.pause();
      p.seekTo(Math.max(0, Math.min(total - 1, f)));
    },
    [playerRef, total],
  );

  // A new active line (picked here, on the timeline, or on the stage): jump the
  // player to it and bring it into view.
  const lastActive = useRef<string | null>(null);
  useEffect(() => {
    if (!active || lastActive.current === active.id) return;
    lastActive.current = active.id;
    if (!playerRef.current?.isPlaying()) seek(visibleFrame(active));
    // picked from outside (timeline, stage): show it in the list
    if (!rootRef.current?.contains(document.activeElement)) {
      setTab("lines");
      pendingFocus.current = { id: active.id, caret: active.text.length };
    } else lineRefs.current.get(active.id)?.scrollIntoView({ block: "nearest" });
  }, [active, seek, playerRef]);

  // Put the caret where a split or a join left it, once the new lines exist.
  useLayoutEffect(() => {
    const want = pendingFocus.current;
    if (!want) return;
    const el = lineRefs.current.get(want.id);
    if (!el) return;
    pendingFocus.current = null;
    el.focus({ preventScroll: true });
    el.scrollIntoView({ block: "nearest" });
    el.setSelectionRange(want.caret, want.caret);
  });

  // The undo offer for a removed line stays until something else changes.
  useEffect(() => {
    if (removed && doc !== removed.doc) setRemoved(null);
  }, [doc, removed]);

  const focusLine = (id: string, caret: number) => {
    pendingFocus.current = { id, caret };
    onSelect(id);
  };

  // ---- line actions ----
  function split(c: TextLayer, at: number) {
    // Work from the doc on screen: dispatch runs updaters later, not now.
    const r = splitLine(doc, c.id, at);
    if (r) {
      change(() => r.doc, "Split a line of the words on screen in two");
      focusLine(r.newId, 0);
      announce("Split the line in two");
    } else announce("This line is too short to split");
  }

  function merge(c: TextLayer) {
    const r = mergeWithPrevious(doc, c.id);
    if (r) {
      change(() => r.doc, "Joined two lines of the words on screen");
      focusLine(r.intoId, r.caret);
      announce("Joined with the line before");
    }
  }

  function remove(c: TextLayer) {
    const i = caps.findIndex((x) => x.id === c.id);
    const neighbour = caps[i + 1] ?? caps[i - 1] ?? null;
    const after = { ...doc, layers: doc.layers.filter((l) => l.id !== c.id) };
    change(() => after, "Removed a line from the words on screen");
    setRemoved({ doc: after, text: c.text });
    onSelect(neighbour?.id ?? null);
    announce(`Removed “${c.text.slice(0, 40)}”. You can undo it.`);
  }

  function addAtPlayhead() {
    const f = playerRef.current?.getCurrentFrame() ?? frame;
    const r = addLineAt(doc, f);
    if (r) {
      const made = r.newId;
      change(() => r.doc, "Added a line to the words on screen");
      pendingFocus.current = { id: made, caret: 0 };
      onSelect(made);
      requestAnimationFrame(() => lineRefs.current.get(made)?.select());
      announce(`Added a line at ${spokenTime(f, fps)}`);
    } else {
      setNotice("There's no room here. Move the playhead to a gap between lines.");
      announce("No room for a new line at the playhead");
    }
  }

  function onLineKey(e: React.KeyboardEvent<HTMLTextAreaElement>, c: TextLayer, i: number) {
    if (e.nativeEvent.isComposing) return;
    const el = e.currentTarget;
    const atStart = el.selectionStart === 0 && el.selectionEnd === 0;
    const atEnd = el.selectionStart === el.value.length && el.selectionEnd === el.value.length;
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      split(c, el.selectionStart);
    } else if (e.key === "Backspace" && atStart && i > 0) {
      e.preventDefault();
      merge(c);
    } else if (e.key === "Delete" && atEnd && caps[i + 1]) {
      e.preventDefault();
      merge(caps[i + 1]);
    } else if ((e.key === "ArrowUp" || e.key === "ArrowDown") && !e.shiftKey && !e.altKey) {
      const to = caps[i + (e.key === "ArrowUp" ? -1 : 1)];
      if (!to) return;
      e.preventDefault();
      focusLine(to.id, Math.min(el.selectionStart, to.text.length));
    } else if (e.key === "Escape") {
      el.blur();
    }
  }

  // ---- whole set ----
  const long = longLines(doc);
  const first = caps[0];
  const last = caps[caps.length - 1];
  const nowId = caps.find((c) => frame >= c.from && frame < c.from + c.durationInFrames)?.id ?? null;

  function downloadSrt() {
    const blob = new Blob([toSrt(doc)], { type: "application/x-subrip" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${title.replace(/[^\w\- ]+/g, "").trim() || "loso"} words.srt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    announce("Saved the words as a .srt file");
  }

  async function importSrt(file: File) {
    const cues = parseSrt(await file.text());
    if (!cues.length) {
      setNotice(`Couldn't find any timed words in ${file.name}. Is it a .srt file?`);
      return;
    }
    change((d) => replaceWithCues(d, cues), `Brought in the words from ${file.name}`);
    onSelect(null);
    setNotice(`Brought in ${cues.length} lines from ${file.name}. Undo puts the old ones back.`);
    announce(`Brought in ${cues.length} lines`);
  }

  return (
    <div ref={rootRef} className="flex flex-col">
      <input
        ref={fileRef}
        type="file"
        hidden
        accept=".srt,.vtt,text/plain,application/x-subrip,text/vtt"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) importSrt(f);
          e.target.value = "";
        }}
      />
      {/* ---- head ---- */}
      <div className="flex flex-col gap-4 px-5 pt-5">
        <button
          type="button"
          onClick={onBack}
          className="flex min-h-10 items-center gap-1.5 self-start text-[13px] text-ink-dim transition-colors hover:text-ink"
        >
          <ArrowLeft size={14} aria-hidden /> All pieces
        </button>
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-lime">Subtitles</p>
          <h2 className="mt-1 font-serif text-[28px] font-light italic leading-[1.05] tracking-tight text-ink">
            Words on screen
          </h2>
          <p className="mt-1.5 text-[13px] text-ink-dim">
            {caps.length ? (
              <>
                {caps.length} {caps.length === 1 ? "line" : "lines"} · {clockTime(first.from, fps)} to{" "}
                {clockTime(last.from + last.durationInFrames, fps)}
              </>
            ) : (
              "Nothing yet"
            )}
          </p>
        </div>
      </div>

      {/* ---- Lines | Look ---- */}
      <div className="sticky top-0 z-10 mt-4 bg-black">
        <div role="tablist" aria-label="Words on screen" className="flex gap-6 border-b border-line px-5">
          {(
            [
              ["lines", "Lines"],
              ["look", "Look of all lines"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              id={`wos-tab-${id}`}
              aria-selected={tab === id}
              aria-controls={`wos-panel-${id}`}
              tabIndex={tab === id ? 0 : -1}
              onClick={() => {
                setTab(id);
                if (id === "look" && caps.length && !nowId) seek(visibleFrame(active ?? caps[0]));
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                  e.preventDefault();
                  const next = tab === "lines" ? "look" : "lines";
                  setTab(next);
                  document.getElementById(`wos-tab-${next}`)?.focus();
                }
              }}
              className={cx(
                "-mb-px flex min-h-11 items-center border-b-2 font-serif text-[17px] italic transition-colors",
                tab === id ? "border-lime text-ink" : "border-transparent text-ink-dim hover:text-ink",
              )}
            >
              {label}
            </button>
          ))}
        </div>
        {removed && (
          <div
            role="status"
            className="flex items-center gap-3 border-b border-line bg-panel px-5 py-2.5 text-[13px] text-ink"
          >
            <span className="min-w-0 flex-1 truncate">Removed a line: {removed.text}</span>
            <button
              type="button"
              onClick={() => {
                onUndo();
                setRemoved(null);
                announce("Put the line back");
              }}
              className="flex min-h-9 items-center px-2 font-medium text-lime hover:underline"
            >
              Undo
            </button>
          </div>
        )}
      </div>

      {notice && (
        <p
          role="status"
          className="flex items-start gap-3 border-b border-line px-5 py-3 text-[13px] leading-snug text-ink"
        >
          <span className="flex-1">{notice}</span>
          <button
            type="button"
            onClick={() => setNotice(null)}
            className="min-h-8 text-[12.5px] text-ink-dim hover:text-ink"
          >
            OK
          </button>
        </p>
      )}

      {tab === "lines" ? (
        <div id="wos-panel-lines" role="tabpanel" aria-labelledby="wos-tab-lines" className="flex flex-col">
          {long.length > 0 && (
            <div className="flex items-center gap-3 border-b border-line px-5 py-3">
              <p className="flex-1 text-[13px] leading-snug text-ink">
                {long.length === 1 ? "1 line is" : `${long.length} lines are`} long and hard to read in time.
              </p>
              <button
                type="button"
                onClick={() => {
                  const r = shortenAll(doc);
                  const n = r.split;
                  change(() => r.doc, "Made the words on screen shorter");
                  announce(`Split ${n} long ${n === 1 ? "line" : "lines"}`);
                }}
                className="flex min-h-10 items-center gap-1.5 border-b border-lime/70 text-[13px] text-ink transition-colors hover:text-lime"
              >
                <Scissors size={13} aria-hidden /> Make them shorter
              </button>
            </div>
          )}

          {caps.length === 0 ? (
            <div className="flex flex-col gap-4 px-5 py-6">
              <p className="font-serif text-[20px] italic leading-snug text-ink">No words on screen yet.</p>
              <p className="text-[13.5px] leading-relaxed text-ink-dim">
                Words on screen help people follow along with the sound off. Add them one line at a time, or bring in a
                subtitle file.
              </p>
              <div className="flex flex-col border-t border-line">
                <BigAction icon={Plus} onClick={addAtPlayhead}>
                  Add a line at {clockTime(frame, fps)}
                </BigAction>
                <BigAction icon={Upload} onClick={() => fileRef.current?.click()}>
                  Bring in a subtitle file (.srt)
                </BigAction>
                {onAsk && (
                  <BigAction icon={ArrowLeft} flip onClick={onAsk}>
                    Ask Loso to write them from the speech
                  </BigAction>
                )}
              </div>
            </div>
          ) : (
            <ol aria-label="Lines, in time order" className="flex flex-col">
              {caps.map((c, i) => (
                <LineRow
                  key={c.id}
                  c={c}
                  i={i}
                  fps={fps}
                  active={c.id === activeId}
                  now={c.id === nowId}
                  playing={playing}
                  refFn={(el) => {
                    if (el) lineRefs.current.set(c.id, el);
                    else lineRefs.current.delete(c.id);
                  }}
                  onFocus={() => c.id !== activeId && onSelect(c.id)}
                  onText={(text) => change((d) => setLineText(d, c.id, text), "Edited the words on screen")}
                  onKey={(e) => onLineKey(e, c, i)}
                  onPlay={() => {
                    onSelect(c.id);
                    const p = playerRef.current;
                    if (!p) return;
                    p.seekTo(c.from);
                    p.play();
                  }}
                >
                  {c.id === activeId && (
                    <LineTiming doc={doc} c={c} playhead={frame} change={change} onRemove={() => remove(c)} />
                  )}
                </LineRow>
              ))}
            </ol>
          )}

          {caps.length > 0 && (
            <div className="border-b border-line px-5 py-1">
              <BigAction icon={Plus} onClick={addAtPlayhead} bare>
                Add a line at {clockTime(frame, fps)}
                <span className="ml-auto text-[12px] text-ink-faint">where the video is now</span>
              </BigAction>
            </div>
          )}

          {caps.length > 0 && <ShiftAll doc={doc} change={change} announce={announce} />}

          <section aria-labelledby="wos-files-h" className="flex flex-col gap-1 px-5 pb-6 pt-5">
            <h3 id="wos-files-h" className="font-serif text-[17px] italic text-ink">
              Subtitle files
            </h3>
            <p className="text-[12.5px] leading-snug text-ink-dim">
              A .srt file works with YouTube, Facebook and most church streaming tools.
            </p>
            <div className="mt-1 flex flex-col border-t border-line">
              <BigAction icon={Upload} onClick={() => fileRef.current?.click()}>
                Bring in a .srt file{caps.length ? " (replaces these lines)" : ""}
              </BigAction>
              {caps.length > 0 && (
                <BigAction icon={Download} onClick={downloadSrt}>
                  Save these lines as a .srt file
                </BigAction>
              )}
            </div>
          </section>
        </div>
      ) : (
        <div id="wos-panel-look" role="tabpanel" aria-labelledby="wos-tab-look">
          {caps.length ? (
            <LookPanel doc={doc} caps={caps} change={change} />
          ) : (
            <p className="px-5 py-6 text-[13.5px] text-ink-dim">
              Add a line first, then pick how all the lines look here.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ---------- one line ----------

function LineRow({
  c,
  i,
  fps,
  active,
  now,
  playing,
  refFn,
  onFocus,
  onText,
  onKey,
  onPlay,
  children,
}: {
  c: TextLayer;
  i: number;
  fps: number;
  active: boolean;
  now: boolean;
  playing: boolean;
  refFn: (el: HTMLTextAreaElement | null) => void;
  onFocus: () => void;
  onText: (t: string) => void;
  onKey: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onPlay: () => void;
  children?: React.ReactNode;
}) {
  const start = clockTime(c.from, fps);
  const end = clockTime(c.from + c.durationInFrames, fps);
  const tooLong = c.text.trim().length > MAX_LINE;
  return (
    <li
      className={cx(
        "relative border-b border-line pl-5 pr-3 transition-colors",
        active ? "bg-panel" : "hover:bg-panel/50",
      )}
      aria-current={active || undefined}
    >
      {/* the lime rule marks the line you're on */}
      <span
        aria-hidden
        className={cx(
          "absolute inset-y-0 left-0 w-[3px]",
          active ? "bg-lime" : now && playing ? "bg-lime/40" : "bg-transparent",
        )}
      />
      <div className="flex items-center gap-2 pt-2.5">
        <span aria-hidden className="w-5 font-mono text-[11px] text-ink-faint">
          {String(i + 1).padStart(2, "0")}
        </span>
        <span className={cx("font-mono text-[12px] tabular-nums", active ? "text-lime" : "text-ink-dim")}>
          {start} → {end}
        </span>
        {tooLong && <span className="text-[11.5px] text-ink-dim">· a bit long</span>}
        <button
          type="button"
          onClick={onPlay}
          aria-label={`Play from ${start}`}
          title={`Play from ${start}`}
          className="ml-auto flex h-9 w-9 items-center justify-center text-ink-dim transition-colors hover:text-lime"
        >
          <Play size={13} fill="currentColor" aria-hidden />
        </button>
      </div>
      <textarea
        ref={refFn}
        rows={1}
        value={c.text}
        spellCheck
        aria-label={`Line ${i + 1}, ${spokenTime(c.from, fps)} to ${spokenTime(c.from + c.durationInFrames, fps)}`}
        aria-describedby="wos-keys"
        onFocus={onFocus}
        onChange={(e) => onText(e.target.value.replace(/\n/g, " "))}
        onKeyDown={onKey}
        className="-mt-0.5 mb-2 block w-full resize-none bg-transparent pl-7 text-[15.5px] leading-snug text-ink caret-lime outline-none [field-sizing:content] placeholder:text-ink-faint focus-visible:outline-none"
        placeholder="(empty line)"
      />
      {active && (
        <p id="wos-keys" className="pb-2 pl-7 text-[11.5px] leading-snug text-ink-dim">
          Enter splits the line · Backspace at the start joins it to the one above · ↑ ↓ move between lines
        </p>
      )}
      {children}
    </li>
  );
}

// ---------- timing for the line you're on ----------

function LineTiming({
  doc,
  c,
  playhead,
  change,
  onRemove,
}: {
  doc: CompositorDoc;
  c: TextLayer;
  playhead: number;
  change: Change;
  onRemove: () => void;
}) {
  const { fps } = doc.output;
  const step = Math.max(1, Math.round(fps * 0.1));
  const { lo, hi } = lineBounds(doc, c.id);
  const end = c.from + c.durationInFrames;
  const nudge = (edge: "start" | "end" | "both", d: number) =>
    change((x) => nudgeLine(x, c.id, edge, d), "Retimed the words on screen");
  const gapBefore = c.from - lo;
  const gapAfter = hi - end;
  const small = Math.round(fps * 1.5); // only offer "close the gap" for small gaps
  return (
    <div className="flex flex-col gap-2 pb-3 pl-7">
      <TimeStrip doc={doc} c={c} playhead={playhead} change={change} />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <Nudger
          label="Starts"
          value={clockTime(c.from, fps)}
          onLess={() => nudge("start", -step)}
          onMore={() => nudge("start", step)}
          lessName="Start 0.1 seconds earlier"
          moreName="Start 0.1 seconds later"
        />
        <Nudger
          label="Ends"
          value={clockTime(end, fps)}
          onLess={() => nudge("end", -step)}
          onMore={() => nudge("end", step)}
          lessName="End 0.1 seconds earlier"
          moreName="End 0.1 seconds later"
        />
      </div>
      <div className="flex flex-wrap items-center gap-x-4 text-[12.5px]">
        {gapBefore > 0 && gapBefore <= small && (
          <button
            type="button"
            onClick={() => change((x) => retimeLine(x, c.id, lo, end), "Retimed the words on screen")}
            className="min-h-9 text-ink-dim transition-colors hover:text-lime"
          >
            ← Start right after the line before
          </button>
        )}
        {gapAfter > 0 && gapAfter <= small && (
          <button
            type="button"
            onClick={() => change((x) => retimeLine(x, c.id, c.from, hi), "Retimed the words on screen")}
            className="min-h-9 text-ink-dim transition-colors hover:text-lime"
          >
            Stay until the next line →
          </button>
        )}
        <button
          type="button"
          onClick={onRemove}
          className="ml-auto flex min-h-9 items-center gap-1.5 text-ink-dim transition-colors hover:text-danger"
        >
          <Trash2 size={13} aria-hidden /> Remove this line
        </button>
      </div>
    </div>
  );
}

function Nudger({
  label,
  value,
  onLess,
  onMore,
  lessName,
  moreName,
}: {
  label: string;
  value: string;
  onLess: () => void;
  onMore: () => void;
  lessName: string;
  moreName: string;
}) {
  return (
    <div className="flex items-center gap-1" role="group" aria-label={`${label} at ${value}`}>
      <span className="w-[44px] text-[12.5px] text-ink-dim">{label}</span>
      <button
        type="button"
        onClick={onLess}
        aria-label={lessName}
        title="0.1s earlier"
        className="flex h-9 w-8 items-center justify-center text-ink-dim hover:text-lime"
      >
        <Minus size={13} aria-hidden />
      </button>
      <span className="w-[48px] text-center font-mono text-[12.5px] tabular-nums text-ink">{value}</span>
      <button
        type="button"
        onClick={onMore}
        aria-label={moreName}
        title="0.1s later"
        className="flex h-9 w-8 items-center justify-center text-ink-dim hover:text-lime"
      >
        <Plus size={13} aria-hidden />
      </button>
    </div>
  );
}

/**
 * A zoomed strip around the line: drag the middle to move it, drag an edge to
 * make it longer or shorter. Edges snap to the neighbours and the playhead;
 * it can never overlap another line. (The ± buttons do the same by keyboard.)
 */
function TimeStrip({
  doc,
  c,
  playhead,
  change,
}: {
  doc: CompositorDoc;
  c: TextLayer;
  playhead: number;
  change: Change;
}) {
  const { fps, durationInFrames: total } = doc.output;
  const caps = captionsOf(doc);
  const end = c.from + c.durationInFrames;
  const pad = Math.round(fps * 2);
  const ref = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ win: [number, number] } | null>(null);
  // Freeze the window while dragging, so the strip doesn't slide under the pointer.
  const win: [number, number] = drag?.win ?? [Math.max(0, c.from - pad), Math.min(Math.max(total, end), end + pad)];
  const span = Math.max(1, win[1] - win[0]);
  const pct = (f: number) => `${((f - win[0]) / span) * 100}%`;

  function begin(e: React.PointerEvent, mode: "move" | "start" | "end") {
    const el = ref.current;
    if (!el) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = el.getBoundingClientRect();
    const perPx = span / rect.width;
    const sx = e.clientX;
    const from0 = c.from;
    const end0 = end;
    const { lo, hi } = lineBounds(doc, c.id);
    const snapTo = [lo, hi, playhead].filter((f) => f >= win[0] && f <= win[1]);
    const near = (f: number) => {
      const tol = perPx * 7;
      let best = f;
      let d = tol;
      for (const s of snapTo) if (Math.abs(s - f) <= d) [best, d] = [s, Math.abs(s - f)];
      return best;
    };
    setDrag({ win });
    const move = (ev: PointerEvent) => {
      const df = Math.round((ev.clientX - sx) * perPx);
      let a = from0;
      let b = end0;
      if (mode === "start") a = near(from0 + df);
      else if (mode === "end") b = near(end0 + df);
      else {
        a = from0 + df;
        b = end0 + df;
        const sa = near(a);
        const sb = near(b);
        if (sa !== a) [a, b] = [sa, sa + (end0 - from0)];
        else if (sb !== b) [a, b] = [sb - (end0 - from0), sb];
      }
      change((d) => retimeLine(d, c.id, a, b), "Retimed the words on screen");
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setDrag(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  const ticks: number[] = [];
  const half = fps / 2;
  for (let f = Math.ceil(win[0] / half) * half; f <= win[1]; f += half) ticks.push(Math.round(f));

  return (
    <div aria-hidden className="select-none overflow-hidden pl-2 pr-3">
      <div ref={ref} className="relative h-11 touch-none border-y border-line">
        {ticks.map((f) => (
          <span key={f} className="absolute top-0 h-full border-l border-line" style={{ left: pct(f) }}>
            {f % fps === 0 && (
              <span className="absolute -top-0.5 left-1 font-mono text-[10.5px] text-ink-faint">
                {clockTime(f, fps).replace(/\.0$/, "")}
              </span>
            )}
          </span>
        ))}
        {caps
          .filter((x) => x.id !== c.id && x.from < win[1] && x.from + x.durationInFrames > win[0])
          .map((x) => (
            <span
              key={x.id}
              className="absolute bottom-1 flex h-5 items-center overflow-hidden bg-line-strong/70 px-1.5 text-[11px] text-ink-dim"
              style={{
                left: pct(Math.max(win[0], x.from)),
                width: `calc(${pct(Math.min(win[1], x.from + x.durationInFrames))} - ${pct(Math.max(win[0], x.from))})`,
              }}
            >
              <span className="truncate">{x.text}</span>
            </span>
          ))}
        <span
          onPointerDown={(e) => begin(e, "move")}
          className={cx(
            "absolute bottom-1 flex h-7 cursor-grab items-center bg-lime text-[11.5px] font-medium text-black",
            drag && "cursor-grabbing",
          )}
          style={{ left: pct(c.from), width: `calc(${pct(end)} - ${pct(c.from)})` }}
        >
          <span
            onPointerDown={(e) => begin(e, "start")}
            className="absolute -left-2 top-0 flex h-full w-4 cursor-ew-resize items-center justify-center"
          >
            <span className="h-4 w-[3px] bg-black/70" />
          </span>
          <span className="mx-3 truncate">{c.text}</span>
          <span
            onPointerDown={(e) => begin(e, "end")}
            className="absolute -right-2 top-0 flex h-full w-4 cursor-ew-resize items-center justify-center"
          >
            <span className="h-4 w-[3px] bg-black/70" />
          </span>
        </span>
        {playhead >= win[0] && playhead <= win[1] && (
          <span className="pointer-events-none absolute -top-1 bottom-0 w-px bg-ink" style={{ left: pct(playhead) }} />
        )}
      </div>
      <p className="mt-1 text-[11.5px] text-ink-dim">
        Drag the lime line to move it, or its ends to change how long it stays.
      </p>
    </div>
  );
}

// ---------- shift all ----------

function ShiftAll({ doc, change, announce }: { doc: CompositorDoc; change: Change; announce: (s: string) => void }) {
  const { fps } = doc.output;
  const [secs, setSecs] = useState("0.5");
  const n = Math.abs(Number(secs.replace(",", ".")));
  const ok = Number.isFinite(n) && n > 0;
  const go = (dir: -1 | 1) => {
    if (!ok) return;
    const r = shiftAll(doc, dir * Math.round(n * fps));
    const applied = r.applied;
    if (applied)
      change(
        () => r.doc,
        `Moved all the words on screen ${Math.abs(applied / fps).toFixed(1)}s ${applied < 0 ? "earlier" : "later"}`,
      );
    if (!applied) announce("They can't go any earlier: the first line already starts at the beginning");
    else
      announce(`Moved every line ${Math.abs(applied / fps).toFixed(1)} seconds ${applied < 0 ? "earlier" : "later"}`);
  };
  return (
    <section aria-labelledby="wos-shift-h" className="flex flex-col gap-2 border-b border-line px-5 pb-4 pt-5">
      <h3 id="wos-shift-h" className="font-serif text-[17px] italic text-ink">
        Words out of sync?
      </h3>
      <p className="text-[12.5px] leading-snug text-ink-dim">
        Move every line together, so they match the voice again.
      </p>
      <div className="flex flex-wrap items-center gap-2 text-[13.5px] text-ink">
        <span>Move all by</span>
        <input
          value={secs}
          inputMode="decimal"
          aria-label="Seconds to move every line"
          onChange={(e) => setSecs(e.target.value)}
          className="uline w-14 !py-1 text-center font-mono text-[13px] tabular-nums"
        />
        <span>seconds</span>
        <span className="ml-auto flex items-center">
          <button
            type="button"
            disabled={!ok}
            onClick={() => go(-1)}
            className="min-h-10 px-2 text-ink-dim transition-colors hover:text-lime disabled:opacity-40"
          >
            ← Earlier
          </button>
          <button
            type="button"
            disabled={!ok}
            onClick={() => go(1)}
            className="min-h-10 px-2 text-ink-dim transition-colors hover:text-lime disabled:opacity-40"
          >
            Later →
          </button>
        </span>
      </div>
    </section>
  );
}

// ---------- the look of every line ----------

const COLOURS: Array<[string, string]> = [
  ["White", "#ffffff"],
  ["Cream", "#f2ead3"],
  ["Yellow", "#ffd84a"],
  ["Lime", "#d4f53c"],
  ["Black", "#0a0a0b"],
];
const BOXES: Array<[string, string | null]> = [
  ["No box", null],
  ["See-through dark", "rgba(8,8,10,0.62)"],
  ["Solid black", "#000000"],
  ["White", "rgba(255,255,255,0.92)"],
];
const ENTRANCES: Array<[string, "none" | "fade" | "scale", number]> = [
  ["Just appear", "none", 0],
  ["Fade in", "fade", 6],
  ["Pop in", "scale", 8],
];

function LookPanel({ doc, caps, change }: { doc: CompositorDoc; caps: TextLayer[]; change: Change }) {
  const ref = caps[0];
  const same = <K extends keyof TextLayer>(k: K) => caps.every((c) => JSON.stringify(c[k]) === JSON.stringify(ref[k]));
  const mixed = !(["fontFamily", "fontSize", "color", "backgroundColor", "y", "anim"] as const).every(same);
  const set = (look: CaptionLook) => change((d) => styleAll(d, look), "Restyled the words on screen");
  const H = doc.output.height;
  const where: CaptionPosition | null =
    POSITIONS.find((p) => Math.abs(positionY(doc, p, ref.height) - ref.y) <= H * 0.01) ?? null;

  return (
    <div className="flex flex-col gap-6 px-5 pb-8 pt-5">
      <p className="text-[13px] leading-snug text-ink-dim">
        Changes here apply to all {caps.length} lines at once.
        {mixed && " Right now some lines look different; picking something makes them match."}
      </p>

      <Fieldset legend="Letters">
        <div className="grid grid-cols-2 border-t border-line">
          {FONT_CHOICES.map((f) => {
            const on = ref.fontFamily === f;
            return (
              <label
                key={f}
                className={cx(
                  "flex min-h-11 cursor-pointer items-center gap-2 border-b border-line pr-2 text-[16px] transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-lime",
                  on ? "text-lime" : "text-ink hover:text-lime",
                )}
              >
                <input
                  type="radio"
                  name="wos-font"
                  className="sr-only"
                  checked={on}
                  onChange={() => set({ fontFamily: f })}
                />
                <span
                  aria-hidden
                  className={cx("h-1.5 w-1.5 shrink-0 rounded-full", on ? "bg-lime" : "bg-transparent")}
                />
                <span style={{ fontFamily: `'${f}', sans-serif` }} className="truncate">
                  {f}
                </span>
              </label>
            );
          })}
        </div>
      </Fieldset>

      <Fieldset legend="Size">
        <div className="flex items-center gap-3">
          <span aria-hidden className="text-[12px] text-ink-dim">
            A
          </span>
          <input
            type="range"
            min={16}
            max={140}
            step={1}
            value={ref.fontSize}
            aria-label="Letter size"
            aria-valuetext={`${ref.fontSize} pixels`}
            onChange={(e) => {
              const fontSize = Number(e.target.value);
              const height = Math.max(ref.height, Math.round(fontSize * 1.15 * 2 + 24));
              set({ fontSize, height });
            }}
            className="min-w-0 flex-1 accent-lime"
          />
          <span aria-hidden className="text-[20px] text-ink-dim">
            A
          </span>
          <span className="w-9 text-right font-mono text-[12.5px] tabular-nums text-ink">{ref.fontSize}</span>
        </div>
      </Fieldset>

      <Fieldset legend="Colour of the letters">
        <div className="flex flex-wrap items-center gap-2.5">
          {COLOURS.map(([name, hex]) => (
            <Swatch
              key={hex}
              name={name}
              group="wos-colour"
              on={ref.color.toLowerCase() === hex}
              onPick={() => set({ color: hex })}
            >
              <span className="h-full w-full rounded-full border border-edge" style={{ background: hex }} />
            </Swatch>
          ))}
          <label className="flex min-h-10 items-center gap-2 text-[12.5px] text-ink-dim">
            Any colour
            <input
              type="color"
              aria-label="Pick any colour for the letters"
              value={/^#[0-9a-f]{6}$/i.test(ref.color) ? ref.color : "#ffffff"}
              onChange={(e) => set({ color: e.target.value })}
            />
          </label>
        </div>
      </Fieldset>

      <Fieldset legend="Box behind the words">
        <div className="flex flex-wrap gap-2.5">
          {BOXES.map(([name, bg]) => (
            <Swatch
              key={name}
              name={name}
              group="wos-box"
              wide
              on={(ref.backgroundColor ?? null) === bg}
              onPick={() => set({ backgroundColor: bg })}
            >
              <span
                className="flex h-full w-full items-center justify-center border border-edge text-[11px] font-semibold"
                style={{
                  background: bg ?? "repeating-linear-gradient(135deg,#1e1e23 0 4px,transparent 4px 8px)",
                  color: bg && bg.startsWith("rgba(255") ? "#0a0a0b" : "#f2f1ec",
                }}
              >
                Aa
              </span>
            </Swatch>
          ))}
        </div>
      </Fieldset>

      <Fieldset legend="Where on the screen">
        <div className="flex gap-4">
          <PositionPad doc={doc} c={ref} onY={(y) => set({ y })} />
          <div role="radiogroup" aria-label="Place all lines" className="flex flex-1 flex-col border-t border-line">
            {POSITIONS.map((p) => {
              const on = where === p;
              return (
                <button
                  key={p}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => set({ y: positionY(doc, p, ref.height) })}
                  className={cx(
                    "flex min-h-11 items-center gap-2 border-b border-line text-left font-serif text-[16px] italic transition-colors",
                    on ? "text-lime" : "text-ink hover:text-lime",
                  )}
                >
                  <span aria-hidden className={cx("h-1.5 w-1.5 rounded-full", on ? "bg-lime" : "bg-transparent")} />
                  {p === "top" ? "Top" : p === "middle" ? "Middle" : "Bottom"}
                </button>
              );
            })}
            <p className="pt-2 text-[11.5px] leading-snug text-ink-dim">
              Or drag the band in the little screen. Dragging a line on the big screen moves them all too.
            </p>
          </div>
        </div>
      </Fieldset>

      <Fieldset legend="How each line comes in">
        <div role="radiogroup" aria-label="How each line comes in" className="flex flex-col border-t border-line">
          {ENTRANCES.map(([name, preset, duration]) => {
            const cur = ref.anim?.preset ?? "none";
            const on = cur === preset;
            return (
              <button
                key={preset}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() =>
                  set({
                    anim:
                      preset === "none" ? { preset: "none", delay: 0, duration: 18 } : { preset, delay: 0, duration },
                  })
                }
                className={cx(
                  "flex min-h-11 items-center gap-2 border-b border-line text-left font-serif text-[16px] italic transition-colors",
                  on ? "text-lime" : "text-ink hover:text-lime",
                )}
              >
                <span aria-hidden className={cx("h-1.5 w-1.5 rounded-full", on ? "bg-lime" : "bg-transparent")} />
                {name}
              </button>
            );
          })}
        </div>
      </Fieldset>
    </div>
  );
}

function Fieldset({ legend, children }: { legend: string; children: React.ReactNode }) {
  return (
    <fieldset className="flex min-w-0 flex-col gap-2.5">
      <legend className="mb-2.5 font-mono text-[11px] uppercase tracking-[0.12em] text-ink-dim">{legend}</legend>
      {children}
    </fieldset>
  );
}

function Swatch({
  name,
  group,
  on,
  onPick,
  wide,
  children,
}: {
  name: string;
  group: string;
  on: boolean;
  onPick: () => void;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label
      title={name}
      className={cx(
        "flex cursor-pointer flex-col items-center gap-1 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-lime",
      )}
    >
      <input type="radio" name={group} className="sr-only" checked={on} onChange={onPick} aria-label={name} />
      <span
        className={cx(
          "flex p-[3px]",
          wide ? "h-10 w-14" : "h-10 w-10 rounded-full",
          on ? "ring-2 ring-lime" : "ring-1 ring-transparent",
        )}
      >
        {children}
      </span>
      {wide && (
        <span className={cx("max-w-[64px] text-center text-[11px] leading-tight", on ? "text-lime" : "text-ink-dim")}>
          {name}
        </span>
      )}
    </label>
  );
}

/** A little screen with the caption band: drag it up or down (or use the arrow keys). */
function PositionPad({ doc, c, onY }: { doc: CompositorDoc; c: TextLayer; onY: (y: number) => void }) {
  const { width: W, height: H } = doc.output;
  const padH = 132;
  const padW = Math.round((padH * W) / H);
  const scale = padH / H;
  const ref = useRef<HTMLDivElement>(null);
  const maxY = Math.max(0, H - c.height);
  const clampY = (y: number) => Math.round(Math.max(0, Math.min(maxY, y)));
  const pctFromTop = Math.round((c.y / H) * 100);

  function begin(e: React.PointerEvent) {
    e.preventDefault();
    const sy = e.clientY;
    const y0 = c.y;
    const move = (ev: PointerEvent) => onY(clampY(y0 + (ev.clientY - sy) / scale));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  return (
    <div ref={ref} className="relative shrink-0 border border-edge bg-void" style={{ width: padW, height: padH }}>
      <div
        role="slider"
        tabIndex={0}
        aria-label="Height of the words on the screen"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pctFromTop}
        aria-valuetext={`${pctFromTop} percent down from the top`}
        onPointerDown={begin}
        onKeyDown={(e) => {
          const step = H * (e.shiftKey ? 0.1 : 0.02);
          if (e.key === "ArrowUp") {
            e.preventDefault();
            onY(clampY(c.y - step));
          } else if (e.key === "ArrowDown") {
            e.preventDefault();
            onY(clampY(c.y + step));
          }
        }}
        className="absolute flex cursor-ns-resize touch-none items-center justify-center bg-lime"
        style={{
          left: c.x * scale,
          width: Math.max(8, c.width * scale),
          top: c.y * scale,
          height: Math.max(6, c.height * scale),
        }}
      >
        <span aria-hidden className="h-px w-1/2 bg-black/60" />
      </div>
    </div>
  );
}

function BigAction({
  icon: Icon,
  onClick,
  children,
  flip,
  bare,
}: {
  icon: typeof Plus;
  onClick: () => void;
  children: React.ReactNode;
  flip?: boolean;
  bare?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        "group flex min-h-11 w-full items-center gap-3 text-left text-[13.5px] text-ink transition-colors hover:text-lime",
        !bare && "border-b border-line",
      )}
    >
      <Icon
        size={15}
        className={cx("shrink-0 text-ink-dim transition-colors group-hover:text-lime", flip && "rotate-180")}
        aria-hidden
      />
      {children}
    </button>
  );
}
