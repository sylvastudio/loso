import fs from "node:fs";
import { NextResponse } from "next/server";
import { getApiKey, getAsset, getProject, updateProject, bumpUsage } from "@/lib/repo";
import { assetPath } from "@/lib/assets";
import { transcribe } from "@/lib/providers/groq";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = getProject(id);
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const key = getApiKey("groq");
  if (!key) {
    return NextResponse.json({ error: "missing_key", provider: "groq" }, { status: 409 });
  }

  const voiceover = project.artifacts.voiceover as { assetHash: string } | undefined;
  if (!voiceover) {
    return NextResponse.json({ error: "Generate a voiceover first" }, { status: 400 });
  }
  const meta = getAsset(voiceover.assetHash);
  if (!meta) return NextResponse.json({ error: "Voiceover file missing" }, { status: 404 });

  try {
    const audio = fs.readFileSync(assetPath(meta.hash, meta.ext));
    const result = await transcribe(key, audio, `voiceover-${id}.mp3`);
    bumpUsage("groq", "audioSeconds", Math.round(result.durationSec));

    const updated = updateProject(id, {
      artifacts: {
        ...project.artifacts,
        transcript: {
          words: result.words,
          text: result.text,
          durationSec: result.durationSec,
          createdAt: Date.now(),
        },
      },
    });
    return NextResponse.json({ project: updated });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
