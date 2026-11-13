import { NextResponse } from "next/server";
import { compositorDocSchema } from "@/lib/compositor";
import { createProject, listProjects } from "@/lib/repo";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ projects: listProjects() });
}

/** Create a compositor project: { title?, settings?: { compositor? } }. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    title?: string;
    settings?: { compositor?: unknown };
  };
  const parsed = body.settings?.compositor === undefined ? null : compositorDocSchema.safeParse(body.settings.compositor);
  if (parsed && !parsed.success) {
    return NextResponse.json({ error: "settings.compositor isn't a valid composition" }, { status: 400 });
  }
  const project = createProject({
    title: (body.title ?? "").trim() || "Untitled project",
    doc: parsed?.data,
  });
  return NextResponse.json({ project }, { status: 201 });
}
