import { log } from "./log";

// The OpenAI-calling nodes (extractNotes/buildStrategy/priceSkus) had zero
// retry/backoff before this — a transient 429/5xx just failed the whole
// family. That made raising repriceCatalog's concurrency risky: more
// concurrent requests means more of them landing on a rate limit, and
// without a retry each one drops a family outright instead of just slowing
// down. This is the safety net that makes a higher CONCURRENCY safe.
const TRANSIENT_STATUS = new Set([429, 500, 502, 503, 504]);

function isTransient(err: unknown): boolean {
  const status =
    (err as { status?: number }).status ?? (err as { response?: { status?: number } }).response?.status;
  if (status !== undefined) return TRANSIENT_STATUS.has(status);
  return /rate.?limit|timeout|ECONNRESET|ETIMEDOUT|EAI_AGAIN/i.test((err as Error)?.message ?? "");
}

export async function withRetry<T>(fn: () => Promise<T>, opts: { label: string; retries?: number }): Promise<T> {
  const retries = opts.retries ?? 3;
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= retries || !isTransient(err)) throw err;
      const delayMs = Math.round(500 * 2 ** attempt + Math.random() * 250);
      log("retry", `${opts.label}: attempt ${attempt + 1} failed (${(err as Error).message}) — retrying in ${delayMs}ms`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}
