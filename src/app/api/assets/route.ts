import { NextResponse } from "next/server";
import { storeAsset } from "@/lib/assets";

export const dynamic = "force-dynamic";

const MAX_BYTES = 25 * 1024 * 1024;

export async function POST(req: Request) {
  const form = await req.formData();
  const file = form.get("file");
  const kind = (form.get("kind") as string) || "upload";
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing file" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "File too large (max 25 MB)" }, { status: 413 });
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  const meta = storeAsset(buffer, file.type || "application/octet-stream", file.name, kind);
  return NextResponse.json({ asset: { ...meta, url: `/api/assets/${meta.hash}` } });
}
