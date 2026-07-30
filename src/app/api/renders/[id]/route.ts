import fs from "node:fs";
import { NextResponse } from "next/server";
import { renderPath } from "@/lib/render";
import { webStreamFromFile } from "@/lib/filestream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Ctx) {
  const { id } = await params;
  const filePath = renderPath(id);
  if (!fs.existsSync(filePath)) {
    return NextResponse.json({ error: "Not rendered yet" }, { status: 404 });
  }

  const size = fs.statSync(filePath).size;
  const range = req.headers.get("range");

  // Range support so <video> can seek without buffering the whole file.
  if (range) {
    const match = /bytes=(\d*)-(\d*)/.exec(range);
    const start = match?.[1] ? Number(match[1]) : 0;
    const end = match?.[2] ? Number(match[2]) : size - 1;
    const stream = fs.createReadStream(filePath, { start, end });
    return new Response(webStreamFromFile(stream), {
      status: 206,
      headers: {
        "Content-Type": "video/mp4",
        "Content-Range": `bytes ${start}-${end}/${size}`,
        "Accept-Ranges": "bytes",
        "Content-Length": String(end - start + 1),
      },
    });
  }

  const stream = fs.createReadStream(filePath);
  return new Response(webStreamFromFile(stream), {
    headers: {
      "Content-Type": "video/mp4",
      "Content-Length": String(size),
      "Accept-Ranges": "bytes",
    },
  });
}
