// Blob URLs for media in a project folder. createObjectURL on a File handle
// doesn't read the file into memory — the browser streams it from disk — so
// even long clips are cheap to preview and export.

import { fileAt } from "./folder";

const cache = new Map<string, Promise<string>>();

export function localAssetUrl(dir: FileSystemDirectoryHandle, projectId: string, path: string): Promise<string> {
  const key = `${projectId}\u0000${path}`;
  let p = cache.get(key);
  if (!p) {
    p = fileAt(dir, path)
      .then((h) => h.getFile())
      .then((f) => URL.createObjectURL(f));
    p.catch(() => cache.delete(key));
    cache.set(key, p);
  }
  return p;
}

/** Resolve many paths; missing files map to null instead of failing the lot. */
export async function localAssetUrls(
  dir: FileSystemDirectoryHandle,
  projectId: string,
  paths: string[]
): Promise<Record<string, string | null>> {
  const out: Record<string, string | null> = {};
  await Promise.all(
    paths.map(async (p) => {
      out[p] = await localAssetUrl(dir, projectId, p).catch(() => null);
    })
  );
  return out;
}
