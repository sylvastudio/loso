import fs from "node:fs";
import { frameAt } from "@/lib/studio/footage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// A single footage frame as JPEG — used by storyboard cards in the agent chat.
export async function GET(req: Request) {
  const u = new URL(req.url);
  const folder = u.searchParams.get("folder") ?? "";
  const clip = u.searchParams.get("clip") ?? "";
  const t = Number(u.searchParams.get("t") ?? 0);
  try {
    const file = await frameAt(folder, clip, t, 320);
    return new Response(new Uint8Array(fs.readFileSync(file)), {
      headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=3600" },
    });
  } catch (e) {
    return new Response((e as Error).message, { status: 404 });
  }
}
