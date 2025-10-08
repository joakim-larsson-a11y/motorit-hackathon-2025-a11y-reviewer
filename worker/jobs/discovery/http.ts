import { setTimeout as sleep } from "node:timers/promises";

export type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type HttpRetryOptions = {
  timeoutMs: number;
  maxRetries: number;
  backoffMs: number;
};

const DEFAULT_OPTIONS: HttpRetryOptions = {
  timeoutMs: 8_000,
  maxRetries: 3,
  backoffMs: 400
};

/**
 * Fetch wrapper that adds request timeout and simple retry handling for 429/5xx responses.
 * Retries use a linear backoff to avoid overloading crawling targets.
 */
export async function fetchWithRetry(
  fetcher: Fetcher,
  url: string,
  init: RequestInit | undefined = undefined,
  options: Partial<HttpRetryOptions> = {}
): Promise<Response> {
  const merged: HttpRetryOptions = { ...DEFAULT_OPTIONS, ...options };

  let attempt = 0;
  let lastError: unknown;

  while (attempt < merged.maxRetries) {
    attempt += 1;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), merged.timeoutMs);
    try {
      const response = await fetcher(url, { ...init, signal: controller.signal });

      if (response.status === 429 || response.status >= 500) {
        if (attempt < merged.maxRetries) {
          await sleep(merged.backoffMs * attempt);
          continue;
        }
      }

      return response;
    } catch (error) {
      lastError = error;
      if (attempt >= merged.maxRetries) {
        throw error;
      }
    } finally {
      clearTimeout(timer);
    }

    await sleep(merged.backoffMs * attempt);
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`Failed to fetch ${url} after ${merged.maxRetries} attempts.`);
}
