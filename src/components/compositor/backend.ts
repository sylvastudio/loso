import type { CompositorDoc } from "@/lib/compositor";
import type { FolderEntry } from "@/lib/local/folder";
import type { ChatApi } from "@/components/agent/chat-api";

// Where an open project lives. The editor only talks to this interface:
// the browser-only app uses the local backend (the user's folder), the dev
// setup keeps a server backend (SQLite + /api routes, MCP).

export interface TemplateInfo {
  id: string;
  name: string;
  description: string;
  builtin: boolean;
  width: number;
  height: number;
  slots: Array<{ name: string; kind: string }>;
}

export interface TemplateBackend {
  list(): Promise<TemplateInfo[]>;
  /** The composition a template produces (slots keep their examples). */
  apply(templateId: string): Promise<CompositorDoc>;
  save(name: string, doc: CompositorDoc): Promise<{ name: string; slots: number }>;
  remove(templateId: string): Promise<void>;
}

export interface ExportedVideo {
  url: string;
  exportedAt: number;
  /** Where it was saved, for the user ("exports/My video.mp4 in Sunday"). */
  savedAs?: string;
}

export interface EditorBackend {
  kind: "local" | "server";
  projectId: string;
  title: string;
  updatedAt: number;
  doc: CompositorDoc | undefined;
  /** The last export, and whether it was made from the doc as saved now. */
  lastExport: (ExportedVideo & { current: boolean }) | null;

  /** Persist the doc. `keepalive` = the page is closing: fire and forget. Returns updatedAt. */
  save(doc: CompositorDoc, opts: { keepalive: boolean }): Promise<number>;
  rename(title: string): Promise<void>;
  /** Bring a dropped/picked file into the project; returns its asset ref. */
  importFile(file: File): Promise<string>;
  /** URLs the Player and export can load, by asset ref (null = missing). */
  assetUrls(refs: string[]): Promise<Record<string, string | null>>;
  exportVideo(doc: CompositorDoc, onProgress: (p: number | null) => void): Promise<ExportedVideo>;
  /** Newer saved copy written by someone else (MCP, another tab), if any. */
  fetchLatest?(): Promise<{ updatedAt: number; doc: CompositorDoc | undefined }>;
  templates: TemplateBackend;
  /** The project's folder: clips that can be added without copying. */
  folder?: {
    name: string;
    /** Kept in the browser's own storage (phones), not a folder the user can see. */
    inBrowser?: boolean;
    list(): Promise<FolderEntry[]>;
    refFor(entry: FolderEntry): string;
  };
  /** Keep a picture beside the project, out of the video (local: the folder's notes/). Returns where. */
  saveNote?(name: string, data: Blob): Promise<string>;
  /** The studio agent runs on this backend. */
  agent: boolean;
  /** Where the agent runs, if not the dev server: the editor hands it the live doc and the export button. */
  chat?(env: { getDoc(): CompositorDoc; render(): Promise<string> }): ChatApi;
}
