import { NextResponse } from "next/server";
import { PRESETS, publicAiConfig, saveAiConfig, sharedKeysAvailable, type AiConfigPatch } from "@/lib/ai";
import { localWhisperAvailable, resolveTranscriptionEngine } from "@/lib/ai/transcribe";
import { getApiKey } from "@/lib/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function payload() {
  return {
    config: publicAiConfig(),
    presets: PRESETS,
    sharedKeys: sharedKeysAvailable(),
    transcription: {
      ...resolveTranscriptionEngine(),
      localWhisper: localWhisperAvailable(),
      groqKey: getApiKey("groq") !== null,
    },
  };
}

export async function GET() {
  return NextResponse.json(payload());
}

export async function PUT(req: Request) {
  let body: AiConfigPatch;
  try {
    body = (await req.json()) as AiConfigPatch;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Expected an object" }, { status: 400 });
  }
  const patch: AiConfigPatch = {};
  if (body.reset === true) patch.reset = true;
  if (typeof body.preset === "string") patch.preset = body.preset;
  if (typeof body.baseUrl === "string") patch.baseUrl = body.baseUrl;
  if (typeof body.model === "string") patch.model = body.model;
  if (typeof body.vision === "boolean") patch.vision = body.vision;
  if (typeof body.tools === "boolean") patch.tools = body.tools;
  if (body.transcription === "provider" || body.transcription === "local" || body.transcription === "groq") {
    patch.transcription = body.transcription;
  }
  if (typeof body.apiKey === "string" || body.apiKey === null) patch.apiKey = body.apiKey;
  try {
    saveAiConfig(patch);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
  return NextResponse.json(payload());
}
