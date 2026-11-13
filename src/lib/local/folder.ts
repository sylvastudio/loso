// Local-first folder access (File System Access API, Chrome/Edge).
// The user's footage folder is read in place; Loso writes its project file
// and exports back into the same folder. Each project's folder handle is
// remembered with the project (see projects.ts), so a return visit only needs
// a one-click permission prompt.

export const MEDIA_EXT = {
  video: ["mp4", "mov", "m4v", "webm", "mkv"],
  audio: ["mp3", "wav", "m4a", "aac", "flac", "ogg"],
  image: ["png", "jpg", "jpeg", "webp", "gif"],
} as const;

export type MediaKind = keyof typeof MEDIA_EXT;

export interface FolderEntry {
  name: string;
  /** Path inside the folder that was listed, e.g. "loso-media/logo.png". */
  path: string;
  kind: MediaKind;
  handle: FileSystemFileHandle;
}

// Files Loso copies into a project folder (drag-and-drop from elsewhere).
export const MEDIA_DIR = "loso-media";
export const EXPORTS_DIR = "exports";
// Pictures for Loso (marked-up frames, screenshots), kept out of the video.
export const NOTES_DIR = "notes";

export function folderAccessSupported(): boolean {
  return typeof window !== "undefined" && "showDirectoryPicker" in window;
}

export async function pickFolder(id = "loso-footage"): Promise<FileSystemDirectoryHandle> {
  const handle = await (window as unknown as {
    showDirectoryPicker: (o: object) => Promise<FileSystemDirectoryHandle>;
  }).showDirectoryPicker({ id, mode: "readwrite" });
  return handle;
}

type PermissionHandle = FileSystemDirectoryHandle & {
  queryPermission(o: { mode: "readwrite" }): Promise<PermissionState>;
  requestPermission(o: { mode: "readwrite" }): Promise<PermissionState>;
};

export function folderPermission(h: FileSystemDirectoryHandle): Promise<PermissionState> {
  return (h as PermissionHandle).queryPermission({ mode: "readwrite" });
}

export async function requestFolderPermission(h: FileSystemDirectoryHandle): Promise<boolean> {
  return (await (h as PermissionHandle).requestPermission({ mode: "readwrite" })) === "granted";
}

export function mediaKind(name: string): MediaKind | null {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  for (const kind of Object.keys(MEDIA_EXT) as MediaKind[]) {
    if ((MEDIA_EXT[kind] as readonly string[]).includes(ext)) return kind;
  }
  return null;
}

type Entries = { entries(): AsyncIterable<[string, FileSystemHandle]> };

// Media in the folder's top level, plus anything Loso copied into loso-media/.
export async function listMedia(dir: FileSystemDirectoryHandle): Promise<FolderEntry[]> {
  const out: FolderEntry[] = [];
  const scan = async (d: FileSystemDirectoryHandle, prefix: string) => {
    for await (const [name, handle] of (d as unknown as Entries).entries()) {
      if (name.startsWith(".")) continue;
      if (handle.kind === "directory") {
        if (!prefix && name === MEDIA_DIR) await scan(handle as FileSystemDirectoryHandle, `${MEDIA_DIR}/`);
        continue;
      }
      const kind = mediaKind(name);
      if (kind) out.push({ name, path: prefix + name, kind, handle: handle as FileSystemFileHandle });
    }
  };
  await scan(dir, "");
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

export async function listFiles(dir: FileSystemDirectoryHandle, ext: string): Promise<string[]> {
  const out: string[] = [];
  for await (const [name, handle] of (dir as unknown as Entries).entries()) {
    if (handle.kind === "file" && name.toLowerCase().endsWith(ext)) out.push(name);
  }
  return out.sort();
}

// "loso-media/clip.mp4" → the file handle inside `dir` (subfolders allowed).
export async function fileAt(
  dir: FileSystemDirectoryHandle,
  path: string,
  create = false
): Promise<FileSystemFileHandle> {
  const parts = path.split("/").filter(Boolean);
  let d = dir;
  for (const p of parts.slice(0, -1)) d = await d.getDirectoryHandle(p, { create });
  return d.getFileHandle(parts[parts.length - 1], { create });
}

export async function exists(dir: FileSystemDirectoryHandle, path: string): Promise<boolean> {
  try {
    await fileAt(dir, path);
    return true;
  } catch {
    return false;
  }
}

export async function writeFile(
  dir: FileSystemDirectoryHandle,
  path: string,
  data: Blob | string
): Promise<void> {
  const w = await (await fileAt(dir, path, true)).createWritable();
  await w.write(data);
  await w.close();
}

export async function readText(dir: FileSystemDirectoryHandle, path: string, maxBytes = Infinity): Promise<string | null> {
  try {
    const file = await (await fileAt(dir, path)).getFile();
    if (file.size > maxBytes) return null;
    return await file.text();
  } catch {
    return null;
  }
}

// A name not yet taken in `sub`: "clip.mp4" → "clip 2.mp4" → …
export async function freeName(dir: FileSystemDirectoryHandle, sub: string, name: string): Promise<string> {
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  for (let i = 1; ; i++) {
    const candidate = i === 1 ? name : `${stem} ${i}${ext}`;
    if (!(await exists(dir, sub ? `${sub}/${candidate}` : candidate))) return candidate;
  }
}

/**
 * Bring a dropped/picked file into the project folder and return its path
 * there. A file already sitting in the folder's top level (same name and
 * size) is used in place; anything else is copied into loso-media/.
 */
export async function importIntoFolder(dir: FileSystemDirectoryHandle, file: File): Promise<string> {
  try {
    const here = await (await dir.getFileHandle(file.name)).getFile();
    if (here.size === file.size) return file.name;
  } catch {
    /* not in the folder */
  }
  const name = await freeName(dir, MEDIA_DIR, file.name);
  await writeFile(dir, `${MEDIA_DIR}/${name}`, file);
  return `${MEDIA_DIR}/${name}`;
}
