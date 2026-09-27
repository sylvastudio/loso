// Client-safe fetch wrapper: throws a readable Error on network failure,
// non-2xx status, or an empty / non-JSON body, so callers can render one
// consistent error state instead of hanging on "Loading…".

export class FetchError extends Error {
  constructor(message: string, public status: number, public body: Record<string, unknown> = {}) {
    super(message);
  }
}

export async function fetchJson<T = Record<string, unknown>>(
  url: string,
  init?: RequestInit
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    throw new FetchError("Couldn't reach the studio", 0);
  }
  const text = await res.text();
  let body: Record<string, unknown> = {};
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = {};
    }
  }
  if (!res.ok) {
    const msg = typeof body.error === "string" ? body.error : `Request failed (${res.status})`;
    throw new FetchError(msg, res.status, body);
  }
  return body as T;
}

export function jsonInit(method: string, data: unknown): RequestInit {
  return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) };
}
