// Each local project's chat with Loso, kept in this browser (IndexedDB
// "chats", one record per project). Not in the .loso file on purpose: the
// chat holds pictures (snapshots, contact sheets) that would bloat a file
// meant to be small and shareable, and a shared project shouldn't carry the
// owner's conversation with it.

import type { ToolCall } from "../../ai/types";
import { idbDelete, idbGet, idbPut } from "../db";

/** Pictures are kept inline (base64); old ones lose their pixels to bound the size. */
export type LocalImage = { type: "image"; mime: string; hash: string; data?: string };
export type LocalPart = { type: "text"; text: string } | LocalImage;
export type LocalChatMessage =
  | { role: "user"; content: LocalPart[] }
  | { role: "assistant"; content: LocalPart[]; toolCalls?: ToolCall[] }
  | { role: "tool"; toolCallId: string; name: string; content: string; images?: LocalImage[]; isError?: boolean };

export interface LocalStored {
  seq: number;
  turn: string;
  message: LocalChatMessage;
  createdAt: number;
}

const KEEP_MESSAGES = 400;
const KEEP_PICTURES = 24;

export async function loadChat(projectId: string): Promise<LocalStored[]> {
  try {
    return (await idbGet<LocalStored[]>("chats", projectId)) ?? [];
  } catch {
    return [];
  }
}

export async function clearChat(projectId: string) {
  await idbDelete("chats", projectId);
}

function bound(list: LocalStored[]): LocalStored[] {
  let out = list;
  if (out.length > KEEP_MESSAGES) {
    // Cut at a user message so tool calls stay paired with their results.
    const cut = out.findIndex((m, i) => i >= out.length - KEEP_MESSAGES && m.message.role === "user");
    if (cut > 0) out = out.slice(cut);
  }
  const withPictures = out
    .map((m, i) => ({ m, i }))
    .filter(({ m }) =>
      m.message.role === "tool" ? m.message.images?.some((im) => im.data) : m.message.content.some((p) => p.type === "image" && p.data)
    );
  const drop = new Set(withPictures.slice(0, Math.max(0, withPictures.length - KEEP_PICTURES)).map(({ i }) => i));
  if (!drop.size) return out;
  const strip = (p: LocalPart): LocalPart => (p.type === "image" ? { type: "image", mime: p.mime, hash: p.hash } : p);
  return out.map((s, i) => {
    if (!drop.has(i)) return s;
    const m = s.message;
    if (m.role === "tool") return { ...s, message: { ...m, images: m.images?.map((im) => strip(im) as LocalImage) } };
    return { ...s, message: { ...m, content: m.content.map(strip) } as LocalChatMessage };
  });
}

/** Append messages (one IndexedDB write). Returns the stored list. */
export async function appendChat(projectId: string, turn: string, messages: LocalChatMessage[]): Promise<LocalStored[]> {
  const cur = await loadChat(projectId);
  let seq = cur.at(-1)?.seq ?? 0;
  const next = bound([...cur, ...messages.map((message) => ({ seq: ++seq, turn, message, createdAt: Date.now() }))]);
  await idbPut("chats", projectId, next);
  return next;
}
