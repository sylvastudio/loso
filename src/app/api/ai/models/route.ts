import { NextResponse } from "next/server";
import { listModels, type AiConfig } from "@/lib/ai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function respond(draft?: Partial<AiConfig>) {
  try {
    const models = await listModels(draft);
    return NextResponse.json({ models });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}

/** Models for the saved config. */
export async function GET() {
  return respond();
}

/** Models for an unsaved draft ({preset, baseUrl?, apiKey?}); a blank key falls back to the saved one. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Partial<AiConfig>;
  return respond(pickDraft(body));
}

function pickDraft(b: Partial<AiConfig>): Partial<AiConfig> {
  const d: Partial<AiConfig> = {};
  if (typeof b.preset === "string") d.preset = b.preset;
  if (typeof b.baseUrl === "string") d.baseUrl = b.baseUrl;
  if (typeof b.apiKey === "string" && b.apiKey.trim()) d.apiKey = b.apiKey.trim();
  return d;
}
