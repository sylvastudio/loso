import { NextResponse } from "next/server";
import { getProject, updateProject } from "@/lib/repo";
import { applyTemplate, ensureBuiltinTemplates } from "@/lib/studio/templates";
import { getTemplate } from "@/lib/studio/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Replace a project's composition with a template (slots keep their example text; unfilled media is dropped). */
export async function POST(req: Request) {
  const { projectId, templateId, fills } = (await req.json()) as {
    projectId?: string;
    templateId?: string;
    fills?: Record<string, string>;
  };
  ensureBuiltinTemplates();
  const t = templateId ? getTemplate(templateId) : null;
  if (!t) return NextResponse.json({ error: "Template not found" }, { status: 404 });
  if (!projectId || !getProject(projectId)) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  const doc = applyTemplate(t, fills ?? {});
  const project = updateProject(projectId, { settings: { kind: "compositor", compositor: doc } as never });
  return NextResponse.json({ doc, updatedAt: project?.updatedAt });
}
