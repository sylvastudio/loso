import { NextResponse } from "next/server";
import { runAgent, type AgentEvent, type AgentInput } from "@/lib/studio/agent";
import { clearAgentMessages, listAgentMessages } from "@/lib/studio/store";
import { getProject } from "@/lib/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 1800;

type Ctx = { params: Promise<{ id: string }> };

/** Chat history for the panel (stored, provider-neutral messages). */
export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  return NextResponse.json({ messages: listAgentMessages(id) });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  clearAgentMessages(id);
  return NextResponse.json({ ok: true });
}

/** Send a message or resume a paused tool call; progress streams back as SSE. */
export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  if (!getProject(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  let input: AgentInput;
  try {
    input = (await req.json()) as AgentInput;
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }
  const baseUrl = new URL(req.url).origin;
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let open = true;
      const emit = (e: AgentEvent) => {
        if (!open) return;
        try {
          controller.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`));
        } catch {
          open = false;
        }
      };
      // keep proxies/browsers from timing out during long tool calls
      const ping = setInterval(() => {
        if (open) {
          try {
            controller.enqueue(enc.encode(": ping\n\n"));
          } catch {
            open = false;
          }
        }
      }, 15000);
      try {
        await runAgent(id, input, { baseUrl, emit, signal: req.signal });
      } finally {
        clearInterval(ping);
        open = false;
        try {
          controller.close();
        } catch {}
      }
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
