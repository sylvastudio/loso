import { NextResponse } from "next/server";
import { compositorDocSchema } from "@/lib/compositor";
import { allTemplates, templateFromDoc } from "@/lib/studio/templates";
import { deleteTemplate } from "@/lib/studio/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const templates = allTemplates().map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    builtin: t.builtin,
    width: t.doc.output.width,
    height: t.doc.output.height,
    slots: t.slots,
    updatedAt: t.updatedAt,
  }));
  return NextResponse.json({ templates });
}

/** Save a composition as a template: { name, description?, doc } — slot layers are already marked in the doc. */
export async function POST(req: Request) {
  const body = (await req.json()) as { name?: string; description?: string; doc?: unknown };
  const parsed = compositorDocSchema.safeParse(body.doc);
  if (!body.name?.trim() || !parsed.success) {
    return NextResponse.json({ error: "A name and a valid composition are required" }, { status: 400 });
  }
  const t = templateFromDoc(parsed.data, { name: body.name.trim(), description: body.description });
  return NextResponse.json({ template: { id: t.id, name: t.name, slots: t.slots } }, { status: 201 });
}

export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (id) deleteTemplate(id);
  return NextResponse.json({ ok: true });
}
