import { fetchJson, jsonInit } from "@/lib/fetch-json";
import type { CompositorDoc } from "@/lib/compositor";
import type { EditorBackend, TemplateInfo } from "./backend";

// The dev setup: projects in SQLite behind the Next /api routes, so the
// studio agent, MCP clients and the server-side renderer keep working.

export interface ServerProject {
  id: string;
  title: string;
  updatedAt: number;
  settings: { kind?: string; compositor?: CompositorDoc };
  artifacts: { render?: { url: string; renderedAt: number } };
}

export function serverBackend(project: ServerProject): EditorBackend {
  const url = `/api/projects/${project.id}`;
  const render = project.artifacts.render;
  return {
    kind: "server",
    projectId: project.id,
    title: project.title,
    updatedAt: project.updatedAt,
    doc: project.settings.compositor,
    // An export is current only if nothing was saved after it (render writes updatedAt ≈ renderedAt).
    lastExport: render
      ? { url: render.url, exportedAt: render.renderedAt, current: project.updatedAt - render.renderedAt < 2000 }
      : null,

    async save(doc, { keepalive }) {
      const init = jsonInit("PATCH", { settings: { kind: "compositor", compositor: doc } });
      if (keepalive) {
        fetch(url, { ...init, keepalive: true }).catch(() => {});
        return Date.now();
      }
      const saved = await fetchJson<{ project: { updatedAt: number } }>(url, init);
      return saved.project.updatedAt;
    },

    async rename(title) {
      await fetchJson(url, jsonInit("PATCH", { title }));
    },

    async importFile(file) {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("kind", "compositor");
      const d = await fetchJson<{ asset: { hash: string } }>("/api/assets", { method: "POST", body: fd });
      return d.asset.hash;
    },

    async assetUrls(refs) {
      return Object.fromEntries(refs.map((r) => [r, `/api/assets/${r}`]));
    },

    async exportVideo() {
      const d = await fetchJson<{ url: string }>(`${url}/render`, { method: "POST" });
      return { url: d.url, exportedAt: Date.now() };
    },

    async fetchLatest() {
      const d = await fetchJson<{ project: ServerProject }>(url);
      return { updatedAt: d.project.updatedAt, doc: d.project.settings.compositor };
    },

    templates: {
      list: () => fetchJson<{ templates: TemplateInfo[] }>("/api/templates").then((d) => d.templates),
      apply: (templateId) =>
        fetchJson<{ doc: CompositorDoc }>("/api/templates/apply", jsonInit("POST", { projectId: project.id, templateId })).then(
          (d) => d.doc
        ),
      save: (name, doc) =>
        fetchJson<{ template: { name: string; slots: unknown[] } }>("/api/templates", jsonInit("POST", { name, doc })).then(
          (d) => ({ name: d.template.name, slots: d.template.slots.length })
        ),
      remove: async (templateId) => {
        await fetch(`/api/templates?id=${templateId}`, { method: "DELETE" });
      },
    },

    agent: true,
  };
}
