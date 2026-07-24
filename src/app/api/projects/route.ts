import { NextResponse } from "next/server";
import { createProject, listProjects } from "@/lib/repo";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ projects: listProjects() });
}

export async function POST(req: Request) {
  const body = (await req.json()) as {
    title?: string;
    script?: string;
    settings?: Record<string, unknown>;
  };
  const script = (body.script ?? "").trim();
  const title =
    (body.title ?? "").trim() ||
    (script ? script.split(/\s+/).slice(0, 6).join(" ") : "Untitled project");
  const project = createProject({ title, script, settings: body.settings as never });
  return NextResponse.json({ project }, { status: 201 });
}
