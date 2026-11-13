import fs from "node:fs";
import { NextResponse } from "next/server";
import { getAsset } from "@/lib/repo";
import { assetPath } from "@/lib/assets";
import { webStreamFromFile } from "@/lib/filestream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ hash: string }> }
) {
  const { hash } = await params;
  const meta = getAsset(hash);
  if (!meta) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const filePath = assetPath(meta.hash, meta.ext);
  if (!fs.existsSync(filePath)) {
    return NextResponse.json({ error: "File missing on disk" }, { status: 404 });
  }

  const size = fs.statSync(filePath).size;
  const cache = "public, max-age=31536000, immutable";
  // Never let a stored file run as a page on this origin.
  const safety = {
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "sandbox; default-src 'none'",
    ...(meta.ext === "svg" ? { "Content-Disposition": "attachment" } : {}),
  };
  const range = req.headers.get("range");

  // Range support is required for browsers to stream/seek video & audio —
  // without a 206 response the media element often refuses to play.
  if (range) {
    const match = /bytes=(\d*)-(\d*)/.exec(range);
    const start = match?.[1] ? Number(match[1]) : 0;
    const end = match?.[2] ? Number(match[2]) : size - 1;
    if (start >= size || end >= size || start > end) {
      return new NextResponse(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${size}`, "Accept-Ranges": "bytes" },
      });
    }
    const stream = fs.createReadStream(filePath, { start, end });
    return new Response(webStreamFromFile(stream), {
      status: 206,
      headers: {
        "Content-Type": meta.mime,
        "Content-Range": `bytes ${start}-${end}/${size}`,
        "Accept-Ranges": "bytes",
        "Content-Length": String(end - start + 1),
        "Cache-Control": cache,
        ...safety,
      },
    });
  }

  const stream = fs.createReadStream(filePath);
  return new Response(webStreamFromFile(stream), {
    headers: {
      "Content-Type": meta.mime,
      "Content-Length": String(size),
      "Accept-Ranges": "bytes",
      "Cache-Control": cache,
      ...safety,
    },
  });
}
