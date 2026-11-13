import { NextResponse } from "next/server";

// LOSO_NO_API=1 switches the server API off, to prove the browser-only app
// works without it (the public site is plain static files with no /api).
export function middleware() {
  if (process.env.LOSO_NO_API === "1") {
    return NextResponse.json({ error: "API disabled (LOSO_NO_API=1)" }, { status: 503 });
  }
  return NextResponse.next();
}

export const config = { matcher: "/api/:path*" };
