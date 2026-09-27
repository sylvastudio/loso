import { NextResponse } from "next/server";
import { toolInfos } from "@/lib/studio/tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Tool catalogue for external agents (MCP). Interactive tools (ask_user,
// propose_storyboard) are omitted — outside agents ask their own user.
export async function GET() {
  return NextResponse.json({ tools: toolInfos({ includeInteractive: false }) });
}
