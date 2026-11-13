// Sorting provider errors into the next step for the user, shared by the
// server agent and the in-browser agent. Client-safe.

import { ProviderError } from "./http";

export type AgentErrorCode = "no_model" | "auth" | "rate_limit" | "context" | "no_tools" | "connection" | "other";

export function classifyAgentError(e: unknown): { code: AgentErrorCode; retryAfterSec?: number } {
  const msg = (e as Error)?.message ?? "";
  const status = e instanceof ProviderError ? e.status : 0;
  const wait = msg.match(/try again in\s+([\d.]+)\s*(ms|s|m)\b/i);
  const retryAfterSec = wait
    ? Math.ceil(Number(wait[1]) * (wait[2] === "ms" ? 0.001 : wait[2] === "m" ? 60 : 1))
    : undefined;
  if (/no ai model configured|no api key saved|no base url|no claude key/i.test(msg)) return { code: "no_model" };
  if (status === 401 || status === 403 || /invalid.*api key|incorrect api key|unauthori[sz]ed/i.test(msg)) return { code: "auth" };
  if (status === 429 || /rate limit|too many requests/i.test(msg)) {
    // Groq reports per-request token overflow as 413/429 "Request too large"
    if (/request too large|reduce your message size/i.test(msg)) return { code: "context" };
    return { code: "rate_limit", retryAfterSec };
  }
  if (status === 413 || /context|too long|maximum.*tokens|request too large|reduce the length/i.test(msg)) return { code: "context" };
  if (/tool(s)? (use|call)|does not support tools|function calling/i.test(msg)) return { code: "no_tools" };
  if (status === 0 && /couldn't connect|couldn't resolve|network error|no response|failed to fetch/i.test(msg)) return { code: "connection" };
  return { code: "other" };
}
