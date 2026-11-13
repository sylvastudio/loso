// Local projects: each project is a `<title>.loso` JSON file inside the
// user's footage folder. Media layers reference files by their path inside
// that folder (the layer's `assetHash` holds the path, e.g. "IMG_0731.MOV" or
// "loso-media/logo.png"), so a project folder is self-contained and can be
// moved, zipped or backed up like any other folder.
//
// The browser keeps a small index of recent projects (id → folder handle +
// file name) so the home page can list them without asking for every folder.

import { z } from "zod";
import { compositorDocSchema, emptyCompositorDoc, type CompositorDoc } from "../compositor";
import { idbAll, idbDelete, idbGet, idbPut } from "./db";
import { folderPermission, freeName, importIntoFolder, readText, requestFolderPermission, writeFile } from "./folder";

export const PROJECT_EXT = ".loso";
/** A .loso file is a few KB to a few MB; anything bigger isn't one (or would hang the tab). */
const MAX_PROJECT_BYTES = 20 * 1024 * 1024;

export const losoFileSchema = z.object({
  app: z.literal("loso"),
  version: z.literal(1),
  id: z.string(),
  title: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
  doc: compositorDocSchema,
  // The last export: its path in the folder and when it was made.
  export: z.object({ path: z.string(), exportedAt: z.number() }).nullable().default(null),
});
export type LosoFile = z.infer<typeof losoFileSchema>;

export interface LocalProjectRecord {
  id: string;
  title: string;
  fileName: string; // "<title>.loso", in the folder's top level
  folderName: string;
  dir: FileSystemDirectoryHandle;
  updatedAt: number;
  exported: boolean;
  // Output size, so the home page can draw a correctly-shaped card.
  width: number;
  height: number;
  /**
   * "browser": the project lives in the browser's own storage (OPFS), not a
   * folder the user picked. Phones have no folder picker, so this is how
   * Loso works there. Its folder handle isn't stored (Safari can't keep one
   * in IndexedDB); it's looked up again from BROWSER_DIR/<id> on read.
   */
  storage?: "browser";
}

/** Where browser-stored projects live inside the browser's private storage. */
export const BROWSER_DIR = "loso-projects";

async function browserRoot(create = false): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(BROWSER_DIR, { create });
}

async function hydrate(r: LocalProjectRecord): Promise<LocalProjectRecord> {
  if (r.storage !== "browser") return r;
  try {
    return { ...r, dir: await (await browserRoot()).getDirectoryHandle(r.id) };
  } catch {
    // Its storage is gone (cleared by the browser): reads will say so.
    return r;
  }
}

/** Save an index entry. Browser projects are stored without their folder handle. */
export function putProjectRecord(r: LocalProjectRecord): Promise<void> {
  if (r.storage !== "browser") return idbPut("projects", r.id, r);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { dir, ...rest } = r;
  return idbPut("projects", r.id, rest);
}

export interface OpenProject {
  record: LocalProjectRecord;
  file: LosoFile;
}

function newProjectId() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function safeFileStem(title: string) {
  return title.replace(/[\\/:*?"<>|]+/g, "").trim().slice(0, 80) || "Untitled";
}

export async function listLocalProjects(): Promise<LocalProjectRecord[]> {
  const all = await Promise.all((await idbAll<LocalProjectRecord>("projects")).map(hydrate));
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getLocalProject(id: string): Promise<LocalProjectRecord | undefined> {
  const r = await idbGet<LocalProjectRecord>("projects", id);
  return r && hydrate(r);
}

// Forget a project in this browser. The .loso file and media stay in the folder.
export const forgetLocalProject = (id: string) =>
  Promise.all([idbDelete("projects", id), idbDelete("versions", `local:${id}`).catch(() => {})]).then(() => undefined);

function recordFor(
  dir: FileSystemDirectoryHandle,
  fileName: string,
  f: LosoFile,
  id = f.id,
  extra: Partial<LocalProjectRecord> = {}
): LocalProjectRecord {
  return {
    id,
    title: f.title,
    fileName,
    folderName: dir.name,
    dir,
    updatedAt: f.updatedAt,
    exported: !!f.export,
    width: f.doc.output.width,
    height: f.doc.output.height,
    ...extra,
  };
}

export async function createLocalProject(
  dir: FileSystemDirectoryHandle,
  title: string,
  doc: CompositorDoc = emptyCompositorDoc(),
  browser?: { id: string; folderName: string }
): Promise<LocalProjectRecord> {
  const now = Date.now();
  const file: LosoFile = {
    app: "loso",
    version: 1,
    id: browser?.id ?? newProjectId(),
    title: title.trim() || "Untitled",
    createdAt: now,
    updatedAt: now,
    doc,
    export: null,
  };
  const fileName = await freeName(dir, "", `${safeFileStem(file.title)}${PROJECT_EXT}`);
  await writeFile(dir, fileName, JSON.stringify(file, null, 2));
  const record = recordFor(
    dir,
    fileName,
    file,
    file.id,
    browser ? { storage: "browser", folderName: browser.folderName } : {}
  );
  await putProjectRecord(record);
  return record;
}

/** What to call the browser's storage in words: "this phone" on a touch device. */
export function browserStorageName(): string {
  if (typeof window === "undefined") return "This browser";
  return window.matchMedia("(pointer: coarse)").matches ? "This phone" : "This browser";
}

/**
 * A new project kept in the browser's own storage, with the picked videos
 * and photos copied in (to loso-media/, like files dropped on a folder
 * project). For phones, which can't open a folder.
 */
export async function createBrowserProject(
  title: string,
  files: File[],
  onProgress?: (i: number, n: number, name: string) => void
): Promise<LocalProjectRecord> {
  // Ask the browser not to clear Loso's storage when space runs low.
  await navigator.storage.persist?.().catch(() => false);
  const id = newProjectId();
  const dir = await (await browserRoot(true)).getDirectoryHandle(id, { create: true });
  try {
    for (let i = 0; i < files.length; i++) {
      onProgress?.(i + 1, files.length, files[i].name);
      await importIntoFolder(dir, files[i]);
    }
    return await createLocalProject(dir, title, emptyCompositorDoc(), { id, folderName: browserStorageName() });
  } catch (e) {
    await (await browserRoot()).removeEntry(id, { recursive: true }).catch(() => {});
    if ((e as Error)?.name === "QuotaExceededError") {
      throw new Error("There isn't enough space on this device for those files. Try fewer or shorter videos.");
    }
    throw e;
  }
}

/** Delete a browser-stored project's files for good (its index entry too). */
export async function deleteBrowserProject(id: string): Promise<void> {
  await forgetLocalProject(id);
  await (await browserRoot()).removeEntry(id, { recursive: true }).catch(() => {});
}

/**
 * Browser-stored folders no project points at any more (the tab closed
 * before a removal was final). Run once when the home page opens.
 */
export async function sweepBrowserProjects(keep: Set<string>): Promise<void> {
  let root: FileSystemDirectoryHandle;
  try {
    root = await browserRoot();
  } catch {
    return; // never used
  }
  const names: string[] = [];
  for await (const [name] of (root as unknown as { entries(): AsyncIterable<[string, unknown]> }).entries()) {
    if (!keep.has(name)) names.push(name);
  }
  await Promise.all(names.map((n) => root.removeEntry(n, { recursive: true }).catch(() => {})));
}

/**
 * Add an existing .loso file (found in a folder the user opened) to this
 * browser's list. Returns null when the file isn't a Loso project.
 */
export async function adoptLocalProject(
  dir: FileSystemDirectoryHandle,
  fileName: string
): Promise<LocalProjectRecord | null> {
  const text = await readText(dir, fileName, MAX_PROJECT_BYTES);
  if (!text) return null;
  let parsed;
  try {
    parsed = losoFileSchema.safeParse(JSON.parse(text));
  } catch {
    return null;
  }
  if (!parsed.success) return null;
  let file = parsed.data;
  // A copied (or crafted) file can carry another project's id: give it its own
  // instead of overwriting that project's entry, chat and settings.
  const existing = await idbGet<LocalProjectRecord>("projects", file.id);
  if (existing) {
    const same = existing.fileName === fileName && (await existing.dir?.isSameEntry(dir).catch(() => false));
    if (!same) {
      file = { ...file, id: crypto.randomUUID() };
      await writeFile(dir, fileName, JSON.stringify(file, null, 2));
    }
  }
  const record = recordFor(dir, fileName, file);
  await putProjectRecord(record);
  return record;
}

export type FolderAccess = "granted" | "prompt" | "denied";

export async function projectAccess(record: LocalProjectRecord): Promise<FolderAccess> {
  if (record.storage === "browser") return record.dir ? "granted" : "denied";
  try {
    return (await folderPermission(record.dir)) as FolderAccess;
  } catch {
    return "denied";
  }
}

// Must run inside a click (a user gesture) when access is "prompt".
export const askProjectAccess = (record: LocalProjectRecord) =>
  record.dir ? requestFolderPermission(record.dir) : Promise.resolve(false);

export class ProjectFileError extends Error {}

export async function openLocalProject(record: LocalProjectRecord): Promise<OpenProject> {
  if (!record.dir) {
    throw new ProjectFileError(`“${record.title}” was kept in this browser, and the browser has cleared it.`);
  }
  const text = await readText(record.dir, record.fileName, MAX_PROJECT_BYTES);
  if (text === null) {
    throw new ProjectFileError(`“${record.fileName}” is no longer in the folder “${record.folderName}”.`);
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new ProjectFileError(`“${record.fileName}” is damaged and can't be read.`);
  }
  const parsed = losoFileSchema.safeParse(json);
  if (!parsed.success) throw new ProjectFileError(`“${record.fileName}” isn't a Loso project this version can open.`);
  return { record, file: parsed.data };
}

/** Write changes to the .loso file and refresh the browser's index entry. */
export async function saveLocalProject(
  open: OpenProject,
  patch: Partial<Pick<LosoFile, "title" | "doc" | "export">>
): Promise<OpenProject> {
  const file: LosoFile = { ...open.file, ...patch, updatedAt: Date.now() };
  await writeFile(open.record.dir, open.record.fileName, JSON.stringify(file, null, 2));
  const { storage, folderName } = open.record;
  const record = recordFor(
    open.record.dir,
    open.record.fileName,
    file,
    open.record.id,
    storage === "browser" ? { storage, folderName } : {}
  );
  await putProjectRecord(record);
  return { record, file };
}
