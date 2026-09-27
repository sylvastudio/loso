import { NextResponse } from "next/server";
import { getAiConfig, recordLastTest, saveAiConfig, testModel, type AiConfig } from "@/lib/ai";

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
  // Remember the outcome for the saved model (pass or fail) so the Agent tab
  // can show "not tested / failed / ready" without re-testing.
  if (saved && saved.model === result.model && (!draft.preset || draft.preset === saved.preset)) {
    recordLastTest({
      model: result.model, ok: result.ok, tools: result.tools, vision: result.vision,
      error: result.error, latencyMs: result.latencyMs,
    });
  }
  return NextResponse.json({ ...result, persisted });
}
