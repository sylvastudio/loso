import { NextResponse } from "next/server";
import { normalizeForSpeech, MODEL_CHAR_LIMITS, DEFAULT_TTS_MODEL } from "@/lib/normalize";
import { getPronunciations } from "@/lib/repo";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const { text = "" } = (await req.json()) as { text?: string };
  const normalized = normalizeForSpeech(text, getPronunciations());
  return NextResponse.json({
    normalized,
    count: normalized.length,
    limit: MODEL_CHAR_LIMITS[DEFAULT_TTS_MODEL],
  });
}
