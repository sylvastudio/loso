import { NextResponse, type NextRequest } from "next/server";

// The dev/server API is for this machine only. Websites open in the same
// browser can still send requests to localhost, so every call must:
// - name a local Host (blocks DNS rebinding),
// - come from Loso itself, not another site (Origin / Sec-Fetch-Site),
// - send writes as JSON or a file upload (no "simple" cross-site form posts).
// LOSO_NO_API=1 switches the API off entirely, to prove the browser-only app
// works without it (the public site is plain static files with no /api).

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function hostname(host: string | null): string {
  if (!host) return "";
  return host.startsWith("[") ? host.slice(0, host.indexOf("]") + 1) : host.split(":")[0];
}

function deny(message: string) {
  return NextResponse.json({ error: message }, { status: 403 });
}

export function middleware(req: NextRequest) {
  if (process.env.LOSO_NO_API === "1") {
    return NextResponse.json({ error: "API disabled (LOSO_NO_API=1)" }, { status: 503 });
  }
  const host = req.headers.get("host");
  if (!LOCAL_HOSTS.has(hostname(host).toLowerCase())) return deny("Loso's API only answers on localhost.");

  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return deny("Requests from other websites are blocked.");
  const origin = req.headers.get("origin");
  if (origin && origin !== "null") {
    try {
      const o = new URL(origin);
      if (!LOCAL_HOSTS.has(o.hostname === "::1" ? "[::1]" : o.hostname) || o.host !== host) {
        return deny("Requests from other websites are blocked.");
      }
    } catch {
      return deny("Bad origin.");
    }
  } else if (origin === "null") {
    return deny("Requests from other websites are blocked.");
  }

  if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    const type = (req.headers.get("content-type") ?? "").toLowerCase();
    const len = req.headers.get("content-length");
    const empty = !type && (len === null || len === "0");
    if (!empty && !type.startsWith("application/json") && !type.startsWith("multipart/form-data")) {
      return NextResponse.json({ error: "Send JSON or a file upload." }, { status: 415 });
    }
  }
  return NextResponse.next();
}

export const config = { matcher: "/api/:path*" };
