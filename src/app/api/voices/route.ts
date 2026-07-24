import { NextResponse } from "next/server";
import { getApiKey } from "@/lib/repo";
import { listVoices } from "@/lib/providers/elevenlabs";

export const dynamic = "force-dynamic";

export async function GET() {
  const key = getApiKey("elevenlabs");
  if (!key) {
    return NextResponse.json({ error: "missing_key", provider: "elevenlabs" }, { status: 409 });
  }
  try {
    const voices = await listVoices(key);
    return NextResponse.json({ voices });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
