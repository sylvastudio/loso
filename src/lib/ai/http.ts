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

/**
 * POST and read a server-sent-event stream, calling onEvent for each JSON
 * `data:` line. Gives up only when the provider goes quiet for idleMs (or
 * after totalMs in all), so a long reply that keeps arriving never times out.
 */
export async function providerStream(
  label: string,
  url: string,
  init: RequestInit & { signal?: AbortSignal | null },
  onEvent: (event: Record<string, unknown>) => void,
  { idleMs = 90_000, totalMs = 600_000 } = {}
): Promise<void> {
  const idle = new AbortController();
  let quiet: ReturnType<typeof setTimeout> | undefined;
  const poke = () => {
    clearTimeout(quiet);
    quiet = setTimeout(() => idle.abort(), idleMs);
  };
  const total = AbortSignal.timeout(totalMs);
  const signal = AbortSignal.any([idle.signal, total, ...(init.signal ? [init.signal] : [])]);
  const timedOut = () =>
    new ProviderError(
      idle.signal.aborted ? `${label}: no reply for ${Math.round(idleMs / 1000)}s` : `${label}: still going after ${Math.round(totalMs / 60000)} minutes`,
      0
    );
  poke();
  try {
    let res: Response;
    try {
      res = await fetch(url, { ...init, signal });
    } catch (e) {
      if (init.signal?.aborted) throw new ProviderError(`${label}: request cancelled`, 0);
      if (idle.signal.aborted || total.aborted) throw timedOut();
      throw new ProviderError(`${label}: network error reaching ${safeHost(url)} (${(e as Error).message})`, 0);
    }
    if (!res.ok || !res.body) {
      const text = await res.text();
      let body: unknown = null;
      try {
        body = JSON.parse(text);
      } catch {
        /* not JSON */
      }
      const msg = extractMessage(body) ?? (text ? text.slice(0, 240) : res.statusText || "request failed");
      throw new ProviderError(`${label} ${res.status}: ${msg}`, res.status);
    }
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buf = "";
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        poke();
        buf += value;
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line.startsWith("data:")) continue;
          const json = line.slice(5).trim();
          if (!json || json === "[DONE]") continue;
          try {
            onEvent(JSON.parse(json));
          } catch (e) {
            if (e instanceof ProviderError) throw e;
            /* a malformed line: skip it */
          }
        }
      }
    } catch (e) {
      if (e instanceof ProviderError) throw e;
      if (init.signal?.aborted) throw new ProviderError(`${label}: request cancelled`, 0);
      if (idle.signal.aborted || total.aborted) throw timedOut();
      throw new ProviderError(`${label}: the reply was cut off (${(e as Error).message})`, 0);
    }
  } finally {
    clearTimeout(quiet);
  }
}
