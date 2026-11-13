"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowRight, FolderOpen, X } from "lucide-react";
import { Thumbnail } from "@remotion/player";
import { Button, Field, InlineError, Input, cx } from "@/components/ui";
import { LosoMark } from "@/components/logo";
import { CompositorComposition } from "@/remotion/compositor";
import { mediaRefs, resolveDocWith, type CompositorDoc, type ResolvedCompositorDoc } from "@/lib/compositor";
import { folderAccessSupported, folderPermission, listFiles, pickFolder, requestFolderPermission } from "@/lib/local/folder";
import { localAssetUrls } from "@/lib/local/assets";
import { idbPut } from "@/lib/local/db";
import { moveServerProject } from "@/lib/local/migrate";
import {
  PROJECT_EXT,
  adoptLocalProject,
  askProjectAccess,
  createLocalProject,
  forgetLocalProject,
  listLocalProjects,
  openLocalProject,
  projectAccess,
  type FolderAccess,
  type LocalProjectRecord,
} from "@/lib/local/projects";

function timeAgo(ts: number) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

const isAbort = (e: unknown) => (e as Error)?.name === "AbortError";

// Live poster: one representative frame of the project (past its intro
// animation), drawn from the files in its folder. Only possible once the
// browser has granted access to that folder this visit.
function LocalThumb({ record }: { record: LocalProjectRecord }) {
  const [doc, setDoc] = useState<ResolvedCompositorDoc | null>(null);
  useEffect(() => {
    let cancelled = false;
    openLocalProject(record)
      .then(async ({ file }) => {
        if (!file.doc.layers.length) return;
        const urls = await localAssetUrls(record.dir, record.id, mediaRefs(file.doc));
        if (!cancelled) setDoc(resolveDocWith(file.doc, urls));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [record]);
  if (!doc) return null;
  const total = Math.max(1, doc.output.durationInFrames);
  return (
    <Thumbnail
      component={CompositorComposition}
      inputProps={{ doc }}
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

// Shared dialog behavior: Escape closes, Tab is trapped inside, ⌘/Ctrl+Enter
// submits, and focus returns to whatever opened the dialog.
function useDialog(
  ref: React.RefObject<HTMLDivElement | null>,
  onClose: () => void,
  onSubmit: () => void,
  opener: HTMLElement | null
) {
  const submitRef = useRef(onSubmit);
  submitRef.current = onSubmit;
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeRef.current();
        return;
      }
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        submitRef.current();
        return;
      }
      if (e.key !== "Tab" || !ref.current) return;
      const focusable = ref.current.querySelectorAll<HTMLElement>(
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
      // back to the button that opened the dialog (captured before it mounted)
      if (opener?.isConnected) opener.focus();
    };
  }, [ref, opener]);
}

function NewProjectModal({
  initialFolder,
  opener,
  onClose,
}: {
  initialFolder: FileSystemDirectoryHandle | null;
  opener: HTMLElement | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [dir, setDir] = useState<FileSystemDirectoryHandle | null>(initialFolder);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  async function choose() {
    try {
      setDir(await pickFolder());
    } catch (e) {
      if (!isAbort(e)) setCreateError((e as Error).message);
    }
  }

  async function create() {
    if (!dir || creating) return;
    setCreating(true);
    setCreateError(null);
    try {
      const record = await createLocalProject(dir, title || "Untitled");
      router.push(`/edit?id=${record.id}`);
    } catch (e) {
      setCreateError(`Couldn't create the project — ${(e as Error).message}`);
      setCreating(false);
    }
  }

  useDialog(dialogRef, onClose, create, opener);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-scrim p-6 backdrop-blur-[2px]"
      onMouseDown={(e) => e.target === e.currentTarget && !title.trim() && onClose()}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-project-title"
        className="rise max-h-full w-full max-w-lg overflow-y-auto border border-line-strong bg-ground shadow-[0_40px_120px_-30px_var(--color-shade)]"
      >
        <header className="border-b border-line px-7 pb-5 pt-6">
          <h2 id="new-project-title" className="font-serif text-[26px] italic tracking-tight">
            New video
          </h2>
          <p className="mt-1 text-[13.5px] text-ink-dim">
            Pick the folder with your clips. Loso saves the video there too, and never uploads anything.
          </p>
        </header>
        <form
          className="flex flex-col gap-6 px-7 py-6"
          onSubmit={(e) => {
            e.preventDefault();
            create();
          }}
        >
          <Field label="Name (optional)">
            <Input value={title} placeholder="Sunday highlight" onChange={(e) => setTitle(e.target.value)} autoFocus />
          </Field>
          <div className="flex flex-col gap-2">
            <span className="micro">Folder</span>
            <button
              type="button"
              onClick={choose}
              className={cx(
                "flex items-center gap-3 border px-4 py-3.5 text-left transition-colors",
                dir ? "border-lime/60 bg-lime/5" : "border-dashed border-edge hover:border-lime/70"
              )}
            >
              <FolderOpen size={18} className={dir ? "text-lime" : "text-ink-dim"} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] text-ink">{dir ? dir.name : "Choose a folder…"}</span>
                <span className="block text-[12.5px] text-ink-dim">
                  {dir ? "Click to pick a different one" : "Where your videos, pictures and sounds are"}
                </span>
              </span>
            </button>
          </div>
          <button type="submit" hidden />
        </form>
        <footer className="flex items-center justify-end gap-3 border-t border-line px-7 py-4">
          {createError ? (
            <InlineError className="mr-auto" onDismiss={() => setCreateError(null)}>
              {createError}
            </InlineError>
          ) : (
            <span id="create-hint" className="mr-auto text-[12.5px] text-ink-dim">
              {dir ? "" : "Choose a folder first."}
            </span>
          )}
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={create} disabled={!dir || creating} aria-describedby="create-hint">
            {creating ? "Creating…" : "Create"}
          </Button>
        </footer>
      </div>
    </div>
  );
}

// ---------- dev only: projects still on the local server ----------

interface ServerProject {
  id: string;
  title: string;
  updatedAt: number;
  settings: { kind?: string; compositor?: CompositorDoc };
}

function ServerProjects({ onMoved }: { onMoved: (id: string) => void }) {
  const [projects, setProjects] = useState<ServerProject[] | null>(null);
  const [busy, setBusy] = useState<{ id: string; status: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (process.env.NEXT_PUBLIC_LOSO_STATIC) return; // the public site has no server projects
    fetch("/api/projects")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: { projects: ServerProject[] }) =>
        setProjects(d.projects.filter((p) => p.settings?.kind === "compositor"))
      )
      .catch(() => setProjects(null)); // no dev server: nothing to show
  }, []);

  if (!projects?.length) return null;

  async function move(p: ServerProject) {
    setError(null);
    try {
      const dir = await pickFolder();
      setBusy({ id: p.id, status: "Starting…" });
      const record = await moveServerProject(p, dir, (status) => setBusy({ id: p.id, status }));
      onMoved(record.id);
    } catch (e) {
      if (!isAbort(e)) setError(`Couldn't move “${p.title}” — ${(e as Error).message}`);
      setBusy(null);
    }
  }

  return (
    <details className="group mt-16 border-t border-line pt-6">
      <summary className="flex min-h-10 cursor-pointer list-none items-center gap-2 text-[13.5px] text-ink-dim hover:text-ink">
        <span className="transition-transform group-open:rotate-90" aria-hidden>▸</span>
        Older projects (dev server) · {projects.length}
      </summary>
      <p className="mt-2 max-w-xl text-[13px] leading-relaxed text-ink-dim">
        Projects made before Loso moved into the browser. Move one into a folder to keep editing it here; the server copy
        stays as it is.
      </p>
      {error && (
        <InlineError className="mt-4" onDismiss={() => setError(null)}>
          {error}
        </InlineError>
      )}
      <ul className="mt-5 flex flex-col">
        {projects.map((p) => (
          <li key={p.id} className="flex items-center gap-4 border-b border-line py-3">
            <span className="min-w-0 flex-1 truncate font-serif text-[16px] italic">{p.title}</span>
            <span className="font-mono text-[11px] text-ink-dim">{timeAgo(p.updatedAt)}</span>
            {busy?.id === p.id ? (
              <span role="status" className="micro flex items-center gap-2 text-lime">
                <LosoMark working size={16} /> {busy.status}
              </span>
            ) : (
              <>
                <Link href={`/project/${p.id}`} className="flex min-h-10 items-center text-[13px] text-ink-dim transition-colors hover:text-ink">
                  Server copy
                </Link>
                <Button size="sm" variant="outline" onClick={() => move(p)} disabled={!!busy}>
                  Move to a folder <ArrowRight size={12} />
                </Button>
              </>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}

// ---------- home ----------

const TRY_SAYING = [
  "Put a big title that says SUNDAY",
  "Make the words pop in one by one",
  "Line up my sound with my video",
  "Make it look like this picture",
];

type DroppedHandle = { kind: string; name: string };
type DropItem = DataTransferItem & { getAsFileSystemHandle?: () => Promise<DroppedHandle | null> };

export default function ProjectsPage() {
  const router = useRouter();
  const [supported, setSupported] = useState(true);
  const [projects, setProjects] = useState<LocalProjectRecord[] | null>(null);
  const [access, setAccess] = useState<Record<string, FolderAccess>>({});
  const [newIn, setNewIn] = useState<{ folder: FileSystemDirectoryHandle | null; opener: HTMLElement | null } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [removed, setRemoved] = useState<LocalProjectRecord | null>(null);
  const [dropOver, setDropOver] = useState(false);
  const [needsAllow, setNeedsAllow] = useState<FileSystemDirectoryHandle | null>(null);
  const [copied, setCopied] = useState(false);
  const removeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastHold = useRef(false);

  const refresh = useCallback(async () => {
    const list = await listLocalProjects();
    setProjects(list);
    const entries = await Promise.all(list.map(async (r) => [r.id, await projectAccess(r)] as const));
    setAccess(Object.fromEntries(entries));
  }, []);

  useEffect(() => {
    setSupported(folderAccessSupported());
    refresh().catch((e: Error) => setError(e.message));
  }, [refresh]);

  // Dev-only hook for automated checks, which can't click the native folder
  // picker: the browser's private file system stands in for a real folder.
  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;
    (window as unknown as { __losoDev: object }).__losoDev = {
      testFolder: async (name: string) =>
        (await navigator.storage.getDirectory()).getDirectoryHandle(name, { create: true }),
      moveServerProject: async (id: string, folder: FileSystemDirectoryHandle) => {
        const { project } = await (await fetch(`/api/projects/${id}`)).json();
        return (await moveServerProject(project, folder)).id;
      },
      createLocalProject: async (folder: FileSystemDirectoryHandle, title: string) =>
        (await createLocalProject(folder, title)).id,
      openFolder: (folder: FileSystemDirectoryHandle) => startFromFolder(folder),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * One gesture: a folder with one video opens it, several list them, none
   * starts a new video named after the folder (renamable in the editor).
   */
  async function startFromFolder(dir: FileSystemDirectoryHandle) {
    setError(null);
    setNotice(null);
    setNeedsAllow(null);
    setBusy(`Opening “${dir.name}”…`);
    try {
      const files = await listFiles(dir, PROJECT_EXT);
      const adopted = (await Promise.all(files.map((f) => adoptLocalProject(dir, f)))).filter(
        (r): r is LocalProjectRecord => !!r
      );
      if (adopted.length === 1) return router.push(`/edit?id=${adopted[0].id}`);
      if (adopted.length > 1) {
        setNotice(`“${dir.name}” has ${adopted.length} videos. Pick one below.`);
        setBusy(null);
        return refresh();
      }
      const record = await createLocalProject(dir, dir.name);
      router.push(`/edit?id=${record.id}`);
    } catch (e) {
      setError(`Couldn't open “${dir.name}”. ${(e as Error).message}`);
      setBusy(null);
    }
  }

  async function openFolder() {
    let dir: FileSystemDirectoryHandle;
    try {
      dir = await pickFolder();
    } catch (e) {
      if (!isAbort(e)) setError((e as Error).message);
      return;
    }
    await startFromFolder(dir);
  }

  // Folder dropped on the page: Chrome hands us the folder itself.
  async function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDropOver(false);
    const item = Array.from(e.dataTransfer.items).find((i) => i.kind === "file") as DropItem | undefined;
    const handlePromise = item?.getAsFileSystemHandle?.(); // must start inside the drop event
    if (!handlePromise) return setError("Drop a folder here, or use Open your folder.");
    const handle = await handlePromise;
    if (!handle || handle.kind !== "directory") {
      return setError("That's a file. Drop the whole folder that holds your videos, or use Open your folder.");
    }
    const dir = handle as unknown as FileSystemDirectoryHandle;
    // A drop doesn't count as permission to change files; ask with a click.
    if ((await folderPermission(dir)) === "granted") await startFromFolder(dir);
    else setNeedsAllow(dir);
  }

  async function openProject(r: LocalProjectRecord) {
    // Asking for access must happen inside this click.
    if (access[r.id] !== "granted" && !(await askProjectAccess(r))) {
      setError(`Loso didn't get permission to open “${r.folderName}”. Try again and choose Allow (or Edit files).`);
      return;
    }
    router.push(`/edit?id=${r.id}`);
  }

  function armToastTimer() {
    if (removeTimer.current) clearTimeout(removeTimer.current);
    removeTimer.current = setTimeout(() => {
      if (!toastHold.current) setRemoved(null);
      else armToastTimer();
    }, 20000);
  }

  async function remove(r: LocalProjectRecord) {
    await forgetLocalProject(r.id);
    setRemoved(r);
    armToastTimer();
    refresh();
  }

  async function undoRemove() {
    if (!removed) return;
    await idbPut("projects", removed.id, removed);
    setRemoved(null);
    refresh();
  }

  const hasProjects = !!projects?.length;

  return (
    <div
      className="relative mx-auto max-w-5xl px-8 pb-24"
      onDragOver={(e) => {
        if (!supported || !e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        setDropOver(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDropOver(false);
      }}
      onDrop={(e) => supported && onDrop(e)}
    >
      {/* ---- hero ---- */}
      <header className={cx("border-b border-line", hasProjects ? "pb-10 pt-12" : "pb-14 pt-16")}>
        <p className="rise mb-5 font-mono text-[11px] uppercase tracking-[0.14em] text-ink-dim">Tell it the video you want</p>
        <h1
          className={cx(
            "rise font-serif font-light leading-[1.0] tracking-[-0.02em]",
            hasProjects ? "text-[clamp(38px,5vw,58px)]" : "text-[clamp(44px,7vw,84px)]"
          )}
          style={{ animationDelay: "60ms" }}
        >
          Say what you want.{" "}
          <br />
          <em className="text-lime">Loso makes the video.</em>
        </h1>

        {supported ? (
          <div className="rise mt-10" style={{ animationDelay: "120ms" }}>
            <div
              className={cx(
                "flex flex-col gap-5 border border-dashed px-6 py-6 transition-colors sm:flex-row sm:items-center",
                dropOver ? "border-lime bg-lime/[0.06]" : "border-edge/70"
              )}
            >
              <div className="min-w-0 flex-1">
                <p className="font-serif text-[22px] italic leading-snug text-ink">
                  {dropOver ? "Let go to open it." : "Drop the folder with your videos here"}
                </p>
                <p className="mt-1 text-[13.5px] leading-relaxed text-ink-dim">
                  Your browser will ask if Loso can use the folder. Say <span className="text-ink">Allow</span>. Loso only
                  looks inside that folder.
                </p>
              </div>
              <Button onClick={openFolder} disabled={!!busy} className="h-12 shrink-0 px-6 text-[15px]">
                {busy ? <LosoMark working size={18} /> : <FolderOpen size={16} aria-hidden />}
                {busy ? "Opening…" : "Open your folder"}
              </Button>
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <p className="text-[13px] text-ink-dim">Everything stays on your computer. Nothing is uploaded.</p>
              <button
                type="button"
                onClick={(e) => setNewIn({ folder: null, opener: e.currentTarget })}
                className="min-h-10 text-[13px] text-ink-dim underline-offset-4 transition-colors hover:text-ink hover:underline"
              >
                Make another video in a folder
              </button>
            </div>
          </div>
        ) : (
          <div className="rise mt-10 max-w-xl border-l-2 border-lime pl-5" style={{ animationDelay: "120ms" }}>
            <p className="font-serif text-[22px] italic leading-snug text-ink">Open Loso in Chrome or Edge on a computer.</p>
            <p className="mt-2 text-[14px] leading-relaxed text-ink-dim">
              Loso opens your folder right on your machine, and only those browsers can do that. Phones and iPads
              can&rsquo;t yet.
            </p>
            <Button
              variant="outline"
              className="mt-4"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(window.location.href);
                  setCopied(true);
                } catch {
                  setCopied(false);
                }
              }}
            >
              {copied ? "Copied. Paste it into Chrome" : "Copy this link"}
            </Button>
          </div>
        )}

        <div role="status" className="mt-2 text-[13.5px] text-lime">
          {notice ?? ""}
        </div>
        {needsAllow && (
          <div className="flex flex-wrap items-center gap-4 border-l-2 border-lime py-1 pl-4">
            <p className="text-[14px] text-ink">
              Found <span className="font-serif italic">“{needsAllow.name}”</span>. Let Loso use it?
            </p>
            <Button
              size="sm"
              onClick={async () => {
                if (await requestFolderPermission(needsAllow)) await startFromFolder(needsAllow);
                else setError(`Loso didn't get permission for “${needsAllow.name}”. Try again and choose Allow.`);
              }}
            >
              Allow Loso to use this folder
            </Button>
          </div>
        )}
        {error && (
          <InlineError className="mt-2" onDismiss={() => setError(null)}>
            {error}
          </InlineError>
        )}
      </header>

      {/* ---- try saying ---- */}
      <section aria-labelledby="try-h" className="border-b border-line py-9">
        <h2 id="try-h" className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-dim">
          Try saying
        </h2>
        <ul className="mt-5 grid grid-cols-1 gap-x-10 gap-y-3 sm:grid-cols-2">
          {TRY_SAYING.map((t) => (
            <li key={t} className="font-serif text-[clamp(18px,2vw,23px)] font-light italic leading-snug text-ink-dim">
              “{t}”
            </li>
          ))}
        </ul>
      </section>

      {/* ---- your videos: an index, not a grid ---- */}
      <section aria-labelledby="videos-h" className="pt-9">
        <h2 id="videos-h" className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-dim">
          Your videos
        </h2>
        {projects === null && (
          <p className="flex items-center gap-2.5 py-10 text-[13.5px] text-ink-dim" role="status">
            <LosoMark working size={18} />
            Looking for your videos…
          </p>
        )}
        {projects !== null && projects.length === 0 && (
          <p className="mt-4 max-w-md text-[14px] leading-relaxed text-ink-dim">
            None yet. Open the folder with your clips and your first video starts there.
          </p>
        )}
        {hasProjects && (
          <ol className="mt-4 border-t border-line">
            {projects!.map((p, i) => {
              const granted = access[p.id] === "granted";
              return (
                <li key={p.id} className="rise group flex items-center border-b border-line" style={{ animationDelay: `${i * 30}ms` }}>
                  <button
                    type="button"
                    onClick={() => openProject(p)}
                    className="flex min-w-0 flex-1 items-center gap-5 py-3 text-left"
                  >
                    <span className="w-6 shrink-0 font-mono text-[12px] text-ink-dim">{String(i + 1).padStart(2, "0")}</span>
                    <span
                      className="relative block h-14 shrink-0 overflow-hidden bg-stage outline outline-1 outline-line-strong transition-[outline-color] group-hover:outline-lime/70"
                      style={{ aspectRatio: `${p.width} / ${p.height}` }}
                      aria-hidden
                    >
                      {granted && <LocalThumb record={p} />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-serif text-[21px] italic leading-tight tracking-tight text-ink transition-colors group-hover:text-lime">
                        {p.title}
                      </span>
                      <span className="mt-0.5 flex items-center gap-1.5 text-[12.5px] text-ink-dim">
                        <FolderOpen size={12} aria-hidden /> {p.folderName}
                        {!granted && <span className="text-ink-dim">· click to let Loso open the folder</span>}
                      </span>
                    </span>
                    <span className="hidden shrink-0 text-right text-[12.5px] text-ink-dim sm:block">
                      {p.exported ? "made" : "draft"} · {timeAgo(p.updatedAt)}
                    </span>
                    <ArrowRight size={16} className="shrink-0 text-ink-dim transition-colors group-hover:text-lime" aria-hidden />
                  </button>
                  <button
                    aria-label={`Remove ${p.title} from this list (the file stays in your folder)`}
                    title="Remove from this list (the file stays in your folder)"
                    className="ml-2 flex h-10 w-10 shrink-0 items-center justify-center text-ink-dim opacity-60 transition-opacity hover:text-danger hover:opacity-100 focus-visible:opacity-100"
                    onClick={() => remove(p)}
                  >
                    <X size={15} />
                  </button>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      <ServerProjects onMoved={(id) => router.push(`/edit?id=${id}`)} />

      {newIn && <NewProjectModal initialFolder={newIn.folder} opener={newIn.opener} onClose={() => setNewIn(null)} />}

      {/* Undo toast for removals: 20s, held while hovered or focused */}
      <div
        className={cx(
          "pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center pb-6 transition-all duration-300",
          removed ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0"
        )}
        aria-live="polite"
      >
        {removed && (
          <div
            onMouseEnter={() => (toastHold.current = true)}
            onMouseLeave={() => (toastHold.current = false)}
            onFocus={() => (toastHold.current = true)}
            onBlur={() => (toastHold.current = false)}
            className="pointer-events-auto flex items-center gap-4 border border-line-strong bg-ground/95 py-2 pl-5 pr-2 backdrop-blur-md"
          >
            <span className="max-w-[340px] truncate text-[13.5px] text-ink-dim">
              Removed <span className="font-serif italic text-ink">{removed.title}</span> · the file stays in your folder
            </span>
            <Button size="sm" onClick={undoRemove}>
              Undo
            </Button>
            <button
              type="button"
              aria-label="Dismiss"
              onClick={() => setRemoved(null)}
              className="flex h-9 w-9 items-center justify-center text-ink-dim hover:text-ink"
            >
              <X size={14} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
