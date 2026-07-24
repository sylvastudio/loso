import { NextResponse } from "next/server";
import { brandSchema } from "@/lib/brand";
import { getBrand, setBrand } from "@/lib/repo";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ brand: getBrand() });
}

export async function PUT(req: Request) {
  const body = await req.json();
  const parsed = brandSchema.safeParse(body.brand);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  setBrand(parsed.data);
  return NextResponse.json({ brand: parsed.data });
}
