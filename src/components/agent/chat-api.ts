"use client";

import { createContext, useContext } from "react";
import { fetchJson, jsonInit } from "@/lib/fetch-json";
import type { CompositorDoc } from "@/lib/compositor";
import type { RankedModel } from "@/lib/ai/models";
import type { ConfigPayload } from "@/components/agent/connect-card";

// Where the chat panel's agent lives. The dev setup talks to the server
// (/api/projects/:id/agent, /api/ai/*); the browser-only app runs the agent
// in this tab with the user's own Claude key (lib/local/agent). The panel,
// model chip and cards only see this interface.

export type StoredImage = { type: "image"; mime: string; hash: string; data?: string };
export type StoredPart = { type: "text"; text: string } | StoredImage;
export type ToolCall = { id: string; name: string; args: Record<string, unknown> };
export type Msg =
  | { role: "user"; content: StoredPart[] }
  | { role: "assistant"; content: StoredPart[]; toolCalls?: ToolCall[] }
  | { role: "tool"; toolCallId: string; name: string; content: string; images?: StoredImage[]; isError?: boolean };
export type Stored = { seq: number; turn: string; message: Msg };

export type LiveEvent =
  | { type: "turn"; turn: string }
  | { type: "text"; text: string }
  | { type: "tool_start"; id: string; name: string; args: Record<string, unknown> }
  | { type: "tool_end"; id: string; name: string; ok: boolean; summary: string; images: string[] }
  | { type: "doc"; doc: CompositorDoc; turn: string }
  | { type: "waiting"; id: string; name: string; args: Record<string, unknown> }
  | { type: "progress"; text: string }
  | { type: "done" }
  | { type: "error"; message: string; code?: string; retryAfterSec?: number };

export type AgentBody =
  | { kind: "message"; text: string; images?: Array<{ mime: string; data: string }> }
  | { kind: "resume"; toolCallId: string; approved?: boolean; answer?: unknown; note?: string };

export interface ChatApi {
  /** true: the agent runs in this browser with the user's own key. */
  local: boolean;
  config(): Promise<ConfigPayload>;
  history(): Promise<Stored[]>;
  clear(): Promise<void>;
  /** Run a turn; events stream to `onEvent` until it resolves. */
  run(body: AgentBody, onEvent: (e: LiveEvent) => void, signal: AbortSignal): Promise<void>;
  models(): Promise<string[]>;
  /** Re-check the saved setup (server: a real test call; local: the key check). */
  test(): Promise<void>;
  switchModel(m: RankedModel): Promise<void>;
  imageUrl(img: StoredImage): string;
  /** A frame of a footage clip for the storyboard card, if this agent can serve one by URL. */
  clipFrameUrl(folder: string | undefined, clip: string, t: number): string | null;
  /** Rank model ids for a picker, when the provider says more than the names do (pictures). */
  rank?(ids: string[]): RankedModel[];
  /** Tokens and estimated cost of this chat, overall and per turn (local only). */
  usage?(): Promise<ChatUsage>;
}

export interface UsageSum {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  /** Estimated USD of the calls with a known price. */
  cost: number;
  /** Calls without a known price (cost leaves them out). */
  unpriced: number;
}
export interface ChatUsage {
  chat: UsageSum;
  turns: Record<string, UsageSum>;
  /** This month's estimate across all projects, and the soft limit the user set (null = none). */
  monthCost: number;
  budget: number | null;
}

export function serverChatApi(projectId: string): ChatApi {
  const url = `/api/projects/${projectId}/agent`;
  return {
    local: false,
    config: () => fetchJson<ConfigPayload>("/api/ai/config"),
    async history() {
      return (await fetchJson<{ messages: Stored[] }>(url)).messages;
    },
    async clear() {
      await fetch(url, { method: "DELETE" });
    },
    async run(body, onEvent, signal) {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal,
      });
      if (!res.ok || !res.body) {
        const t = await res.text();
        throw new Error((() => { try { return JSON.parse(t).error; } catch { return t || `Request failed (${res.status})`; } })());
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const chunk = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const line = chunk.split("\n").find((l) => l.startsWith("data: "));
          if (line) onEvent(JSON.parse(line.slice(6)) as LiveEvent);
        }
      }
    },
    async models() {
      return (await fetchJson<{ models: string[] }>("/api/ai/models")).models;
    },
    async test() {
      await fetchJson("/api/ai/test", jsonInit("POST", {}));
    },
    async switchModel(m) {
      await fetchJson("/api/ai/config", jsonInit("PUT", { model: m.id, vision: m.vision }));
      // The key check runs by itself after a switch; the result shows in the dock.
      await fetchJson("/api/ai/test", jsonInit("POST", {})).catch(() => {});
    },
    imageUrl: (img) => (img.data ? `data:${img.mime};base64,${img.data}` : `/api/assets/${img.hash}`),
    clipFrameUrl: (folder, clip, t) =>
      folder ? `/api/studio/frame?folder=${encodeURIComponent(folder)}&clip=${encodeURIComponent(clip)}&t=${t}` : null,
  };
}

export const ChatApiContext = createContext<ChatApi | null>(null);

/** The chat's agent; null outside a chat panel. */
export const useChatApi = () => useContext(ChatApiContext);
