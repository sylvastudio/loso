import fs from "node:fs";
import { NextResponse } from "next/server";
import { getAsset } from "@/lib/repo";
import { assetPath } from "@/lib/assets";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ hash: string }> }
) {
  const { hash } = await params;
  const meta = getAsset(hash);
  if (!meta) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const filePath = assetPath(meta.hash, meta.ext);
  if (!fs.existsSync(filePath)) {
    return NextResponse.json({ error: "File missing on disk" }, { status: 404 });
  }
  const data = fs.readFileSync(filePath);
  return new NextResponse(new Uint8Array(data), {
    headers: {
      "Content-Type": meta.mime,
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
