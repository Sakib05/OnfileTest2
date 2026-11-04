import crypto from "crypto";
import { ProviderError } from "./types";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface HttpOptions {
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}

export interface ClassifyOptions {
  /**
   * DBByte documents that a 429 WITHOUT Retry-After is a plan quota error
   * (not a transient burst limit). Other providers set this to false.
   */
  quotaWhen429WithoutRetryAfter?: boolean;
}

export function sha256Hex(buf: Buffer | Uint8Array): string {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

export function parseRetryAfterMs(headers: Headers): number | undefined {
  const raw = headers.get("retry-after");
  if (raw) {
    const secs = Number(raw);
    if (Number.isFinite(secs) && secs >= 0) return Math.round(secs * 1000);
    const date = Date.parse(raw);
    if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
  }
  // Cloudinary: X-FeatureRateLimit-Reset is an RFC-2822 date.
  const reset = headers.get("x-featureratelimit-reset");
  if (reset) {
    const date = Date.parse(reset);
    if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
  }
  return undefined;
}

const QUOTA_TEXT = /(quota|storage limit|limit exceeded|insufficient storage|exceeded (your|the) (plan|storage|bandwidth))/i;

/**
 * Maps an HTTP failure to a ProviderError. IMPORTANT: 401/403 are always
 * "auth" — they are never interpreted as quota exhaustion.
 */
export function classifyHttpFailure(
  status: number,
  bodyText: string,
  headers: Headers,
  opts: ClassifyOptions = {}
): ProviderError {
  const snippet = bodyText.slice(0, 300).replace(/\s+/g, " ");
  const retryAfterMs = parseRetryAfterMs(headers);
  if (status === 401 || status === 403) return new ProviderError("auth", `Authentication failed (HTTP ${status})`, status);
  if (status === 404) return new ProviderError("not_found", `Not found (HTTP 404)`, status);
  if (status === 409) return new ProviderError("conflict", `Conflict (HTTP 409)`, status);
  if (status === 429 || status === 420) {
    if (status === 429 && retryAfterMs === undefined && opts.quotaWhen429WithoutRetryAfter) {
      return new ProviderError("quota", `Plan quota exceeded (HTTP 429 without Retry-After)`, status);
    }
    return new ProviderError("rate_limited", `Rate limited (HTTP ${status})`, status, retryAfterMs ?? 1000);
  }
  if (status === 402 || status === 507 || ((status === 400 || status === 413) && QUOTA_TEXT.test(snippet))) {
    return new ProviderError("quota", `Quota exceeded (HTTP ${status}): ${snippet}`, status);
  }
  if (status >= 500) return new ProviderError("server", `Provider server error (HTTP ${status})`, status, retryAfterMs);
  if (status >= 400) return new ProviderError("bad_request", `Request rejected (HTTP ${status}): ${snippet}`, status);
  return new ProviderError("unknown", `Unexpected HTTP ${status}`, status);
}

/**
 * fetch() with a hard timeout. Network/timeouts become ProviderErrors; HTTP
 * error statuses are converted too, so callers only handle the ok path.
 */
export async function providerFetch(
  url: string,
  init: RequestInit,
  http: HttpOptions = {},
  classify: ClassifyOptions = {}
): Promise<Response> {
  const fetchImpl: FetchLike = http.fetchImpl ?? ((u, i) => fetch(u, i));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), http.timeoutMs ?? 15000);
  let res: Response;
  try {
    res = await fetchImpl(url, { ...init, signal: controller.signal });
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    if (name === "AbortError" || name === "TimeoutError") throw new ProviderError("timeout", "Request timed out");
    throw new ProviderError("network", `Network error: ${err instanceof Error ? err.message : "unknown"}`);
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    let text = "";
    try {
      text = await res.text();
    } catch {
      /* ignore */
    }
    throw classifyHttpFailure(res.status, text, res.headers, classify);
  }
  return res;
}

export interface RetryOptions {
  maxAttempts: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Longest Retry-After we will wait for; longer => give up (fail over). */
  maxRetryAfterMs?: number;
  sleep?: (ms: number) => Promise<void>;
  onRetry?: (err: ProviderError, attempt: number, delayMs: number) => void;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Bounded retry policy:
 *  - 429: honour Retry-After (if short enough), limited attempts.
 *  - 5xx / timeout / network: exponential backoff with jitter, limited attempts.
 *  - everything else (auth, quota, bad request, …): no retry.
 */
export async function withRetry<T>(fn: (attempt: number) => Promise<T>, opts: RetryOptions): Promise<T> {
  const sleep = opts.sleep ?? defaultSleep;
  const base = opts.baseDelayMs ?? 300;
  const maxDelay = opts.maxDelayMs ?? 4000;
  const maxRetryAfter = opts.maxRetryAfterMs ?? 5000;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
      if (!(err instanceof ProviderError) || !err.retryable || attempt >= opts.maxAttempts) throw err;
      let delay: number;
      if (err.kind === "rate_limited") {
        delay = err.retryAfterMs ?? base * 2 ** (attempt - 1);
        if (delay > maxRetryAfter) throw err; // too long to wait inside a request -> fail over
      } else {
        const exp = Math.min(maxDelay, base * 2 ** (attempt - 1));
        delay = Math.round(exp / 2 + Math.random() * (exp / 2));
      }
      opts.onRetry?.(err, attempt, delay);
      await sleep(delay);
    }
  }
  throw lastErr;
}

export function toBlob(buf: Buffer, type: string): Blob {
  return new Blob([new Uint8Array(buf)], { type });
}

export function encodePathSegments(path: string): string {
  return path
    .split("/")
    .map((s) => encodeURIComponent(s))
    .join("/");
}
