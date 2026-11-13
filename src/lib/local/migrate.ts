// One-time move of a project from the dev server (SQLite + ./data/assets)
// into a folder on this computer. Only works while the dev server runs; the
// server copy is left untouched.

import { compositorDocSchema, mediaRefs, type CompositorDoc } from "../compositor";
import { MEDIA_DIR, freeName, writeFile } from "./folder";
import { createLocalProject, type LocalProjectRecord } from "./projects";

const EXT: Record<string, string> = {
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/svg+xml": "svg",
};

export async function moveServerProject(
  project: { title: string; settings: { compositor?: CompositorDoc } },
  dir: FileSystemDirectoryHandle,
  onStatus: (s: string) => void = () => {}
): Promise<LocalProjectRecord> {
  const doc = compositorDocSchema.parse(project.settings.compositor ?? {});
  const refs = mediaRefs(doc).filter((r) => r !== "PLACEHOLDER");
  const paths: Record<string, string> = {};
  for (const [i, hash] of refs.entries()) {
    onStatus(`Copying media ${i + 1} of ${refs.length}…`);
    const res = await fetch(`/api/assets/${hash}`);
    if (!res.ok) continue; // the layer will show as missing
    const blob = await res.blob();
    const ext = EXT[blob.type.split(";")[0]] ?? "bin";
    const name = await freeName(dir, MEDIA_DIR, `${hash.slice(0, 12)}.${ext}`);
    await writeFile(dir, `${MEDIA_DIR}/${name}`, blob);
    paths[hash] = `${MEDIA_DIR}/${name}`;
  }
  onStatus("Saving the project file…");
  const moved: CompositorDoc = {
    ...doc,
    layers: doc.layers.map((l) => (l.type === "text" || !paths[l.assetHash] ? l : { ...l, assetHash: paths[l.assetHash] })),
  };
  return createLocalProject(dir, project.title, moved);
}
