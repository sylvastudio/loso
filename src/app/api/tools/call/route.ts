import { NextResponse } from "next/server";
import { getTool, runTool, toContract } from "@/lib/studio/tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 900;

export async function POST(req: Request) {
  let body: { projectId?: string; name?: string; args?: Record<string, unknown>; vision?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ content: [{ type: "text", text: "Body must be JSON" }], isError: true }, { status: 400 });
  }
  const tool = body.name ? getTool(body.name) : undefined;
  if (!tool || tool.interactive) {
    return NextResponse.json(
      { content: [{ type: "text", text: `Unknown tool "${body.name}"` }], isError: true },
      { status: 404 }
    );
  }
  const out = await runTool(tool.name, {
    projectId: body.projectId,
    baseUrl: new URL(req.url).origin,
    vision: body.vision !== false,
  }, body.args ?? {});
  return NextResponse.json(toContract(out));
}
