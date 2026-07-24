import { NextResponse } from "next/server";
import { PROVIDERS, maskKey, type ProviderId } from "@/lib/providers";
import { getApiKey, setApiKey } from "@/lib/repo";

export const dynamic = "force-dynamic";

export async function GET() {
  const statuses = PROVIDERS.map((p) => {
    const key = getApiKey(p.id);
    return { id: p.id, set: key !== null, masked: key ? maskKey(key) : null };
  });
  return NextResponse.json({ keys: statuses });
}

export async function PUT(req: Request) {
  const body = (await req.json()) as { id?: string; value?: string };
  const provider = PROVIDERS.find((p) => p.id === body.id);
  if (!provider || typeof body.value !== "string") {
    return NextResponse.json({ error: "Invalid provider or value" }, { status: 400 });
  }
  setApiKey(provider.id as ProviderId, body.value);
  const key = getApiKey(provider.id);
  return NextResponse.json({
    id: provider.id,
    set: key !== null,
    masked: key ? maskKey(key) : null,
  });
}
