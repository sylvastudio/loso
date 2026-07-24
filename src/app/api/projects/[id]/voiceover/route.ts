import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { getApiKey, getProject, getPronunciations, updateProject, bumpUsage } from "@/lib/repo";
import { storeAsset } from "@/lib/assets";
import { normalizeForSpeech, MODEL_CHAR_LIMITS, DEFAULT_TTS_MODEL } from "@/lib/normalize";
import { synthesize, DEFAULT_VOICE_SETTINGS, type VoiceSettings } from "@/lib/providers/elevenlabs";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = getProject(id);
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const key = getApiKey("elevenlabs");
  if (!key) {
    return NextResponse.json({ error: "missing_key", provider: "elevenlabs" }, { status: 409 });
  }

  const body = (await req.json()) as { voiceId?: string; settings?: Partial<VoiceSettings> };
  const voiceId = body.voiceId ?? project.settings.voiceId;
  if (!voiceId) return NextResponse.json({ error: "No voice selected" }, { status: 400 });

  const settings = { ...DEFAULT_VOICE_SETTINGS, ...body.settings };
  const normalized = normalizeForSpeech(project.script, getPronunciations());
  const limit = MODEL_CHAR_LIMITS[DEFAULT_TTS_MODEL];
  if (normalized.length === 0) {
    return NextResponse.json({ error: "Script is empty" }, { status: 400 });
  }
  if (normalized.length > limit) {
    return NextResponse.json(
      { error: `Normalized script is ${normalized.length} characters — over the ${limit} cap.` },
      { status: 400 }
    );
  }

  try {
    const audio = await synthesize(key, {
      voiceId,
      text: normalized,
      modelId: DEFAULT_TTS_MODEL,
      settings,
    });
    const asset = storeAsset(audio, "audio/mpeg", `voiceover-${id}.mp3`, "voiceover");
    bumpUsage("elevenlabs", "characters", normalized.length);

    const scriptHash = crypto.createHash("sha1").update(project.script).digest("hex").slice(0, 12);
    const updated = updateProject(id, {
      settings: { ...project.settings, voiceId },
      artifacts: {
        ...project.artifacts,
        voiceover: {
          assetHash: asset.hash,
          voiceId,
          modelId: DEFAULT_TTS_MODEL,
          settings,
          normalizedChars: normalized.length,
          scriptHash,
          createdAt: Date.now(),
        },
        // A new voiceover invalidates the old word timings.
        transcript: undefined,
      },
    });
    return NextResponse.json({ project: updated });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
