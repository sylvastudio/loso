// Rank a provider's model list so Loso can pick a sensible default without
// hardcoding model ids (they go stale). Client-safe.

export interface RankedModel {
  id: string;
  score: number;
  /** A hint from the name only — the Test button is the real check. */
  vision: boolean;
}

const NOT_CHAT =
  /whisper|tts|orpheus|playai|speech|audio|transcri|guard|safeguard|moderation|embed|rerank|dall-e|image|imagen|imagine|sora|distil|search-preview|realtime|computer-use|(^|[-/])live([-_]|$)|omni|banana|aqa/i;
const TOOL_FAMILY =
  /gpt-oss|qwen3|qwen-?3|qwen2\.5|llama-3\.3|llama-4|kimi-k2|minimax-m\d|gpt-4\.1|gpt-4o|gpt-[56]|(^|\/)o\d|claude-(sonnet|opus|haiku|fable|mythos)|claude-\d|gemini-\d|grok-[2-9]|mistral-(large|medium)|devstral|command-r|deepseek-(v3|chat)/i;
const VISION =
  /vision|(^|[-_/])vl([-_]|$)|llava|llama-4|gemma-?3|pixtral|gpt-4o|gpt-4\.1|gpt-[56]|claude|gemini|grok-.*(vision|4)/i;

export function isChatModel(id: string): boolean {
  return !NOT_CHAT.test(id);
}

/** A chat model from a family known to call tools well enough for Loso's agent (names only). */
export function canCallTools(id: string): boolean {
  return isChatModel(id) && TOOL_FAMILY.test(id);
}

/** Small or "lite" models: they can call tools but often get multi-step video edits wrong. */
export function weakAtEditing(id: string): boolean {
  const size = sizeB(id);
  if (size !== null && size <= 30) return true;
  return /(^|[-_/.])(nano|lite|luna|mini|instant|tiny|small)([-_.]|$)/i.test(id);
}

function sizeB(id: string): number | null {
  const m = id.match(/(\d+(?:\.\d+)?)b(?![a-z])/i);
  return m ? Number(m[1]) : null;
}

export function rankModels(ids: string[]): { chat: RankedModel[]; other: string[] } {
  const chatIds = ids.filter(isChatModel);
  const other = ids.filter((id) => !isChatModel(id));
  const chat = chatIds.map((id): RankedModel => {
    let score = 0;
    if (TOOL_FAMILY.test(id)) score += 40;
    const size = sizeB(id);
    if (size !== null) score += Math.min(size, 120) / 4;
    if (/mini|nano|small|tiny|lite/i.test(id) && (size === null || size < 10)) score -= 25;
    if (/preview|exp(erimental)?|beta/i.test(id)) score -= 10;
    // Claude tiers: the flagship models first, Haiku is the fast/cheap option.
    if (/claude-.*(opus|fable)/i.test(id)) score += 8;
    else if (/claude-.*sonnet/i.test(id)) score += 6;
    else if (/claude-.*haiku/i.test(id)) score -= 5;
    const dated = /-\d{8}$|-\d{4}-\d{2}-\d{2}$/.test(id);
    if (dated && chatIds.includes(id.replace(/-\d{8}$|-\d{4}-\d{2}-\d{2}$/, ""))) score -= 5;
    const ver = id.match(/(\d+)(?:[.-](\d)(?!\d))?/); // "4.1", "5-5" (Claude ids) → 5.5
    if (ver) score += Math.min(Number(ver[2] ? `${ver[1]}.${ver[2]}` : ver[1]), 10) * 0.2; // gentle tie-break toward newer versions
    return { id, score: Math.round(score * 10) / 10, vision: VISION.test(id) };
  });
  chat.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  return { chat, other };
}

/** The model to pre-select: keep the current choice if it's a valid chat model, else the top-ranked one. */
export function pickDefaultModel(ids: string[], current?: string): string {
  const { chat } = rankModels(ids);
  if (current && chat.some((m) => m.id === current)) return current;
  return chat[0]?.id ?? "";
}

/** The best few models for a short list: only the newest of each family (no "Opus 5" next to "Opus 5.5"). */
export function topPicks(chat: RankedModel[], n: number): RankedModel[] {
  const seen = new Set<string>();
  const out: RankedModel[] = [];
  for (const m of chat) {
    const family = m.id.toLowerCase().replace(/[-.:@]?\d.*$/, "");
    if (seen.has(family)) continue;
    seen.add(family);
    out.push(m);
    if (out.length === n) break;
  }
  return out;
}
