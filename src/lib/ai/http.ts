// Shared fetch wrapper for provider adapters: turns network failures and
// non-2xx responses into one readable Error ("OpenAI 401: Incorrect API key…").

export class ProviderError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = "ProviderError";
  }
}

function extractMessage(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const err = b.error;
  if (typeof err === "string") return err;
  if (err && typeof err === "object") {
    const e = err as Record<string, unknown>;
    if (typeof e.message === "string") return e.message;
  }
  if (typeof b.message === "string") return b.message;
  if (typeof b.detail === "string") return b.detail;
  return null;
}

const TIMEOUT_MS = 180_000;

export async function providerFetch(
  label: string,
  url: string,
  init: RequestInit & { signal?: AbortSignal | null },
  timeoutMs = TIMEOUT_MS
): Promise<unknown> {
  const timeout = AbortSignal.timeout(timeoutMs);
  const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal });
  } catch (e) {
    const err = e as Error & { cause?: { code?: string; message?: string } };
    if (err.name === "AbortError" && init.signal?.aborted) throw new ProviderError(`${label}: request cancelled`, 0);
    if (err.name === "TimeoutError" || timeout.aborted) {
      throw new ProviderError(`${label}: no response after ${Math.round(timeoutMs / 1000)}s`, 0);
    }
    const code = err.cause?.code;
    const host = safeHost(url);
    if (code === "ECONNREFUSED") {
      throw new ProviderError(`${label}: couldn't connect to ${host} — is the server running?`, 0);
    }
    if (code === "ENOTFOUND" || code === "EAI_AGAIN") {
      throw new ProviderError(`${label}: couldn't resolve ${host} — check the base URL or your connection`, 0);
    }
    throw new ProviderError(`${label}: network error reaching ${host} (${err.cause?.message ?? err.message})`, 0);
  }
  const text = await res.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }
  if (!res.ok) {
    const msg = extractMessage(body) ?? (text ? text.slice(0, 240) : res.statusText || "request failed");
    throw new ProviderError(`${label} ${res.status}: ${msg}`, res.status);
  }
  if (body === null) {
    throw new ProviderError(`${label}: empty or non-JSON response from ${safeHost(url)}`, res.status);
  }
  return body;
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export function trimSlash(url: string): string {
  return url.replace(/\/+$/, "");
}
