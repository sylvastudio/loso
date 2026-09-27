import { NextResponse } from "next/server";
import { getAiConfig, saveAiConfig, testModel, type AiConfig } from "@/lib/ai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Probe a model for tool calling + vision. Body is an optional draft
 * ({preset, baseUrl, apiKey, model}); omitted fields fall back to the saved
 * config. When the probed model is the saved one, the detected capabilities
 * are persisted.
 */
export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as Partial<AiConfig>;
  const draft: Partial<AiConfig> = {};
  if (typeof b.preset === "string") draft.preset = b.preset;
  if (typeof b.baseUrl === "string") draft.baseUrl = b.baseUrl;
  if (typeof b.model === "string" && b.model.trim()) draft.model = b.model.trim();
  if (typeof b.apiKey === "string" && b.apiKey.trim()) draft.apiKey = b.apiKey.trim();

  const result = await testModel(Object.keys(draft).length ? draft : undefined);

  let persisted = false;
  const saved = getAiConfig();
  if (
    result.ok &&
    saved &&
    saved.model === result.model &&
    (!draft.preset || draft.preset === saved.preset) &&
    (!draft.baseUrl || draft.baseUrl.trim() === saved.baseUrl) &&
    (!draft.apiKey || draft.apiKey === saved.apiKey)
  ) {
    saveAiConfig({ vision: result.vision, tools: result.tools });
    persisted = true;
  }
  return NextResponse.json({ ...result, persisted });
}
