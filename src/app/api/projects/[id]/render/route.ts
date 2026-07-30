import { NextResponse } from "next/server";
import { getProject, updateProject } from "@/lib/repo";
import { compositorDocSchema } from "@/lib/compositor";
import { renderCompositor } from "@/lib/render";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const baseUrl = new URL(req.url).origin;
  const project = getProject(id);
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (project.settings.kind !== "compositor") {
    return NextResponse.json({ error: "Not a compositor project" }, { status: 400 });
  }

  const parsed = compositorDocSchema.safeParse(project.settings.compositor);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid composition" }, { status: 400 });
  }
  if (parsed.data.layers.length === 0) {
    return NextResponse.json({ error: "Add at least one layer before exporting" }, { status: 400 });
  }

  try {
    await renderCompositor(id, parsed.data, baseUrl);
    const renderedAt = Date.now();
    const url = `/api/renders/${id}?v=${renderedAt}`;
    updateProject(id, {
      artifacts: { ...project.artifacts, render: { url: `/api/renders/${id}`, renderedAt } },
    });
    return NextResponse.json({ status: "done", url });
  } catch (e) {
    return NextResponse.json({ status: "error", error: (e as Error).message }, { status: 500 });
  }
}
