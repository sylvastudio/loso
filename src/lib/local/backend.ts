// The browser-only editor backend: the project is a .loso file in the user's
// folder, media is read from that folder, exports render in this tab and are
// saved to the folder's exports/ subfolder. No server involved.

import type { EditorBackend, TemplateInfo } from "@/components/compositor/backend";
import { applyTemplate, type Template } from "../templates-core";
import { resolveDocWith, mediaRefs } from "../compositor";
import { localAssetUrls } from "./assets";
import { localChatApi } from "./agent/chat-api";
import { discardRenderTemp, exportInTab } from "./export";
import { EXPORTS_DIR, NOTES_DIR, fileAt, freeName, importIntoFolder, listMedia, writeFile } from "./folder";
import { saveLocalProject, type OpenProject } from "./projects";
import { deleteLocalTemplate, getLocalTemplate, listLocalTemplates, saveLocalTemplate } from "./templates";

function info(t: Template): TemplateInfo {
  return {
    id: t.id,
    name: t.name,
    description: t.description,
    builtin: t.builtin,
    width: t.doc.output.width,
    height: t.doc.output.height,
    slots: t.slots,
  };
}

function exportFileName(title: string) {
  return `${title.replace(/[\\/:*?"<>|]+/g, "").trim().slice(0, 80) || "Loso export"}.mp4`;
}

export function localBackend(initial: OpenProject, exportUrl: string | null): EditorBackend {
  // Saves are serialized so two quick edits can't write the file out of order.
  let current = initial;
  let chain: Promise<unknown> = Promise.resolve();
  const enqueue = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = chain.then(fn, fn);
    chain = next.catch(() => {});
    return next;
  };
  const { dir, id } = initial.record;
  const exp = initial.file.export;

  return {
    kind: "local",
    projectId: id,
    title: initial.file.title,
    updatedAt: initial.file.updatedAt,
    doc: initial.file.doc,
    lastExport:
      exp && exportUrl
        ? { url: exportUrl, exportedAt: exp.exportedAt, savedAs: exp.path, current: initial.file.updatedAt - exp.exportedAt < 2000 }
        : null,

    save(doc) {
      // The page closing can't wait for disk writes either way; the editor's
      // debounced saves keep the file at most ~0.4 s behind.
      return enqueue(async () => {
        current = await saveLocalProject(current, { doc });
        return current.file.updatedAt;
      });
    },

    async rename(title) {
      await enqueue(async () => {
        current = await saveLocalProject(current, { title });
      });
    },

    importFile: (file) => importIntoFolder(dir, file),

    assetUrls: (refs) => localAssetUrls(dir, id, refs),

    async exportVideo(doc, onProgress) {
      const urls = await localAssetUrls(dir, id, mediaRefs(doc));
      const missing = Object.entries(urls).filter(([, u]) => !u).map(([p]) => p);
      if (missing.length) {
        throw new Error(`Some files are missing from the folder: ${missing.slice(0, 3).join(", ")}${missing.length > 3 ? "…" : ""}`);
      }
      const { blob } = await exportInTab(resolveDocWith(doc, urls), { onProgress });
      onProgress(null);
      const name = await freeName(dir, EXPORTS_DIR, exportFileName(current.file.title));
      const path = `${EXPORTS_DIR}/${name}`;
      await writeFile(dir, path, blob);
      // Serve the download from the copy in the folder, then drop the temp.
      const saved = await (await fileAt(dir, path)).getFile();
      await discardRenderTemp();
      const exportedAt = Date.now();
      await enqueue(async () => {
        current = await saveLocalProject(current, { doc, export: { path, exportedAt } });
      });
      return { url: URL.createObjectURL(saved), exportedAt, savedAs: path };
    },

    templates: {
      list: async () => (await listLocalTemplates()).map(info),
      async apply(templateId) {
        const t = await getLocalTemplate(templateId);
        if (!t) throw new Error("That template no longer exists.");
        return applyTemplate(t, {});
      },
      async save(name, doc) {
        const t = await saveLocalTemplate(name, doc);
        return { name: t.name, slots: t.slots.length };
      },
      remove: deleteLocalTemplate,
    },

    folder: {
      name: dir.name,
      list: () => listMedia(dir),
      refFor: (entry) => entry.path,
    },

    async saveNote(name, data) {
      const free = await freeName(dir, NOTES_DIR, name);
      const path = `${NOTES_DIR}/${free}`;
      await writeFile(dir, path, data);
      return path;
    },

    // Loso runs in this tab with the user's own Claude key.
    agent: true,
    chat: (env) => localChatApi({ projectId: id, dir, ...env }),
  };
}
