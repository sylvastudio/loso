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
import { folderPermission, freeName, readText, requestFolderPermission, writeFile } from "./folder";

export const PROJECT_EXT = ".loso";

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
  const all = await idbAll<LocalProjectRecord>("projects");
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

export const getLocalProject = (id: string) => idbGet<LocalProjectRecord>("projects", id);

// Forget a project in this browser. The .loso file and media stay in the folder.
export const forgetLocalProject = (id: string) => idbDelete("projects", id);

function recordFor(dir: FileSystemDirectoryHandle, fileName: string, f: LosoFile): LocalProjectRecord {
  return {
    id: f.id,
    title: f.title,
    fileName,
    folderName: dir.name,
    dir,
    updatedAt: f.updatedAt,
    exported: !!f.export,
    width: f.doc.output.width,
    height: f.doc.output.height,
  };
}

export async function createLocalProject(
  dir: FileSystemDirectoryHandle,
  title: string,
  doc: CompositorDoc = emptyCompositorDoc()
): Promise<LocalProjectRecord> {
  const now = Date.now();
  const file: LosoFile = {
    app: "loso",
    version: 1,
    id: newProjectId(),
    title: title.trim() || "Untitled",
    createdAt: now,
    updatedAt: now,
    doc,
    export: null,
  };
  const fileName = await freeName(dir, "", `${safeFileStem(file.title)}${PROJECT_EXT}`);
  await writeFile(dir, fileName, JSON.stringify(file, null, 2));
  const record = recordFor(dir, fileName, file);
  await idbPut("projects", record.id, record);
  return record;
}

/**
 * Add an existing .loso file (found in a folder the user opened) to this
 * browser's list. Returns null when the file isn't a Loso project.
 */
export async function adoptLocalProject(
  dir: FileSystemDirectoryHandle,
  fileName: string
): Promise<LocalProjectRecord | null> {
  const text = await readText(dir, fileName);
  if (!text) return null;
  let parsed;
  try {
    parsed = losoFileSchema.safeParse(JSON.parse(text));
  } catch {
    return null;
  }
  if (!parsed.success) return null;
  const record = recordFor(dir, fileName, parsed.data);
  await idbPut("projects", record.id, record);
  return record;
}

export type FolderAccess = "granted" | "prompt" | "denied";

export async function projectAccess(record: LocalProjectRecord): Promise<FolderAccess> {
  try {
    return (await folderPermission(record.dir)) as FolderAccess;
  } catch {
    return "denied";
  }
}

// Must run inside a click (a user gesture) when access is "prompt".
export const askProjectAccess = (record: LocalProjectRecord) => requestFolderPermission(record.dir);

export class ProjectFileError extends Error {}

export async function openLocalProject(record: LocalProjectRecord): Promise<OpenProject> {
  const text = await readText(record.dir, record.fileName);
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
  const record = recordFor(open.record.dir, open.record.fileName, file);
  await idbPut("projects", record.id, record);
  return { record, file };
}
