// Loso's notes about what went wrong: a small diary kept in this browser
// (errors, failed steps, slow replies) so a person can send it with a problem
// report. Nothing is sent by itself. Keys, long base64 (pictures) and
// data: URLs are cut out before anything is written.

export interface LogEntry {
  t: number;
  level: "error" | "warn" | "info";
  where: string;
  msg: string;
}

const KEY = "loso-log";
const MAX_ENTRIES = 300;
const MAX_MSG = 600;

const SECRETS: RegExp[] = [
  /sk-ant-[A-Za-z0-9_-]+/g,
  /\bsk-[A-Za-z0-9_-]{16,}/g,
  /\bgsk_[A-Za-z0-9]+/g,
  /\bxai-[A-Za-z0-9]+/g,
  /\bAIza[0-9A-Za-z_-]{20,}/g,
  /\bsk-or-[A-Za-z0-9_-]+/g,
  /(Bearer|x-api-key|api[_-]?key)["':=\s]+[A-Za-z0-9._-]{12,}/gi,
];

export function redact(s: string): string {
  let out = s;
  for (const re of SECRETS) out = out.replace(re, "[key removed]");
  return out
    .replace(/data:[a-z]+\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+/gi, "[picture removed]")
    .replace(/[A-Za-z0-9+/=]{400,}/g, "[long data removed]");
}

function read(): LogEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as LogEntry[]) : [];
  } catch {
    return [];
  }
}

function write(entries: LogEntry[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(entries.slice(-MAX_ENTRIES)));
  } catch {
    /* storage full or blocked: keep going without notes */
  }
}

function text(x: unknown): string {
  if (x instanceof Error) return `${x.name}: ${x.message}${x.stack ? `\n${x.stack.split("\n").slice(1, 4).join("\n")}` : ""}`;
  if (typeof x === "string") return x;
  try {
    return JSON.stringify(x);
  } catch {
    return String(x);
  }
}

export function logEvent(level: LogEntry["level"], where: string, ...parts: unknown[]) {
  if (typeof window === "undefined") return;
  const msg = redact(parts.map(text).join(" ")).slice(0, MAX_MSG);
  const entries = read();
  const last = entries[entries.length - 1];
  // The same message again within a minute: don't fill the diary with repeats.
  if (last && last.msg === msg && last.where === where && Date.now() - last.t < 60_000) return;
  entries.push({ t: Date.now(), level, where, msg });
  write(entries);
}

export function clearLog() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

let installed = false;

/** Catch errors nobody handled, and console errors/warnings from Loso and its libraries. */
export function installLogCapture() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("error", (e) => logEvent("error", "page", e.error ?? e.message, e.filename ? `(${e.filename.split("/").pop()}:${e.lineno})` : ""));
  window.addEventListener("unhandledrejection", (e) => logEvent("error", "promise", e.reason));
  for (const level of ["error", "warn"] as const) {
    const orig = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      orig(...args);
      try {
        logEvent(level, "console", ...args);
      } catch {
        /* never let logging break the page */
      }
    };
  }
}

function environment(): Record<string, unknown> {
  const n = navigator as Navigator & { deviceMemory?: number; userAgentData?: { brands?: { brand: string; version: string }[]; platform?: string; mobile?: boolean } };
  const perf = performance as Performance & { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number } };
  const mb = (b?: number) => (b ? `${Math.round(b / 1048576)} MB` : undefined);
  return {
    loso: process.env.NEXT_PUBLIC_LOSO_VERSION ?? "dev",
    page: location.pathname,
    browser: n.userAgentData?.brands?.map((b) => `${b.brand} ${b.version}`).join(", ") || navigator.userAgent,
    platform: n.userAgentData?.platform ?? navigator.platform,
    mobile: n.userAgentData?.mobile,
    memory: n.deviceMemory ? `${n.deviceMemory} GB (approx.)` : "unknown",
    cpus: navigator.hardwareConcurrency,
    screen: `${screen.width}×${screen.height} @${devicePixelRatio}x`,
    pageMemory: perf.memory ? `${mb(perf.memory.usedJSHeapSize)} of ${mb(perf.memory.jsHeapSizeLimit)}` : undefined,
    webgpu: "gpu" in navigator,
    videoEncoder: typeof VideoEncoder !== "undefined",
    folders: "showDirectoryPicker" in window,
    online: navigator.onLine,
  };
}

/** The report a person sends: computer info plus the diary, newest last. */
export function buildReport(maxChars = 40_000): string {
  const env = environment();
  const lines = read().map((e) => `${new Date(e.t).toISOString()} ${e.level.toUpperCase()} [${e.where}] ${e.msg}`);
  let body = lines.join("\n");
  if (body.length > maxChars) body = "…(older notes cut)\n" + body.slice(-maxChars);
  const head = Object.entries(env)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");
  return `Loso problem report, ${new Date().toISOString()}\n${head}\n\n--- notes (${lines.length}) ---\n${body || "(none yet)"}`;
}

export function logCount(): number {
  return read().length;
}
