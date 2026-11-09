import { getDbbyteConfig, type DbbyteConfig } from "./config";
import { StorageError, type ThumbnailStorage } from "./provider";

/**
 * DBByte REST client — only the two operations thumbnails need.
 *
 * Endpoints (from DBByte's official API reference and official JS SDK source,
 * https://github.com/dbbyte-dev/dbbyte-js):
 *   POST   {api}/storage/{bucket}/upload[?overwrite=true]   multipart/form-data, field "file" (filename = object name)
 *          -> { success, key, name, size, mimeType, fileId }
 *   DELETE {api}/storage/{bucket}/delete/{name}
 * Auth: `Authorization: Bearer <API key>`. Errors: { error: string }, 429 may carry Retry-After.
 *
 * Deleting a file purges its CDN cache automatically (DBByte docs, "CDN & Caching"),
 * so no explicit /purge call (which would cost an extra API request) is made.
 */

export interface DbbyteClientOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** Delays between retries for 5xx/network errors. Tests pass [0,0]. */
  backoffMs?: number[];
  /** Longest Retry-After (seconds) we are willing to wait inside a request. */
  maxInlineRetryAfterSec?: number;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class DbbyteStorage implements ThumbnailStorage {
  readonly provider = "dbbyte" as const;
  private cfg: DbbyteConfig;
  private fetchImpl: typeof fetch;
  private timeoutMs: number;
  private backoff: number[];
  private maxInlineRetryAfter: number;
  private sleep: (ms: number) => Promise<void>;

  constructor(cfg: DbbyteConfig, opts: DbbyteClientOptions = {}) {
    this.cfg = cfg;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? 20_000;
    this.backoff = opts.backoffMs ?? [500, 1500];
    this.maxInlineRetryAfter = opts.maxInlineRetryAfterSec ?? 3;
    this.sleep = opts.sleep ?? defaultSleep;
  }

  private url(path: string): string {
    return `${this.cfg.apiBaseUrl}/storage/${encodeURIComponent(this.cfg.bucket)}${path}`;
  }

  private async request(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.fetchImpl(url, {
        ...init,
        signal: controller.signal,
        headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${this.cfg.apiKey}` },
      });
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        throw new StorageError("timeout", "DBByte request timed out");
      }
      throw new StorageError("network", "Could not reach DBByte");
    } finally {
      clearTimeout(timer);
    }
  }

  private async toError(res: Response): Promise<StorageError> {
    let message = res.statusText || "DBByte error";
    try {
      const body = (await res.json()) as { error?: unknown };
      if (typeof body?.error === "string") message = body.error.slice(0, 200);
    } catch {
      /* non-JSON body */
    }
    const ra = res.headers.get("Retry-After");
    const retryAfter = ra !== null && ra !== "" && Number.isFinite(Number(ra)) ? Number(ra) : undefined;
    const status = res.status;
    if (status === 401 || status === 403) return new StorageError("auth", message, { status });
    if (status === 413) return new StorageError("too_large", message, { status });
    if (status === 409) return new StorageError("conflict", message, { status });
    if (status === 429) {
      // Per DBByte: 429 WITH Retry-After = transient burst limit; WITHOUT = plan quota exceeded.
      return retryAfter !== undefined
        ? new StorageError("rate_limited", message, { status, retryAfter })
        : new StorageError("quota_exceeded", message, { status });
    }
    if (status >= 500) return new StorageError("server", message, { status });
    return new StorageError("unknown", message, { status });
  }

  /**
   * Runs `op` with bounded retries: 5xx/timeout/network -> backoff retry;
   * 429 with a short Retry-After -> a single wait-and-retry; everything
   * else (auth, quota, 4xx) fails immediately.
   */
  private async withRetries<T>(op: (attempt: number) => Promise<T>): Promise<T> {
    let rateLimitRetried = false;
    for (let attempt = 0; ; attempt++) {
      try {
        return await op(attempt);
      } catch (err) {
        if (!(err instanceof StorageError)) throw err;
        const transient = err.code === "server" || err.code === "timeout" || err.code === "network";
        if (transient && attempt < this.backoff.length) {
          await this.sleep(this.backoff[attempt]);
          continue;
        }
        if (
          err.code === "rate_limited" &&
          !rateLimitRetried &&
          (err.retryAfter ?? Infinity) <= this.maxInlineRetryAfter
        ) {
          rateLimitRetried = true;
          await this.sleep((err.retryAfter ?? 1) * 1000);
          continue;
        }
        throw err;
      }
    }
  }

  async put(key: string, body: Uint8Array, contentType: string): Promise<{ key: string }> {
    return this.withRetries(async (attempt) => {
      const form = new FormData();
      // Copy into a fresh ArrayBuffer-backed view so the Blob type is satisfied.
      form.append("file", new Blob([new Uint8Array(body)], { type: contentType }), key);
      // Object names are unique per upload (random version), so overwrite is
      // only enabled on RETRIES: if an earlier attempt actually succeeded but
      // its response was lost (timeout), the retry replaces that very same
      // object instead of failing with 409 or leaving a duplicate.
      const qs = attempt > 0 ? "?overwrite=true" : "";
      const res = await this.request(this.url(`/upload${qs}`), { method: "POST", body: form });
      if (!res.ok) throw await this.toError(res);
      let data: { success?: boolean; name?: string; key?: string; size?: number };
      try {
        data = await res.json();
      } catch {
        throw new StorageError("unverified", "DBByte returned an unreadable upload response");
      }
      if (data?.success === false || (typeof data?.size === "number" && data.size !== body.byteLength)) {
        throw new StorageError("unverified", "DBByte upload could not be verified");
      }
      // `name` is the human-readable object name used by download/delete and
      // by the CDN URL; fall back to what we asked for.
      const storedName = typeof data?.name === "string" && data.name ? data.name : key;
      return { key: storedName };
    });
  }

  /**
   * Credential self-check against DBByte's documented `GET /health` endpoint,
   * which requires a valid API key (any read/write/delete permission). Lets an
   * admin distinguish "key rejected" from "bucket/permission problem" without
   * uploading anything. Never returns or logs the key.
   */
  async checkCredentials(): Promise<{ ok: true } | { ok: false; status?: number; code: string; message: string }> {
    try {
      const res = await this.request(`${this.cfg.apiBaseUrl}/health`, { method: "GET" });
      if (res.ok) return { ok: true };
      const err = await this.toError(res);
      return { ok: false, status: res.status, code: err.code, message: err.message };
    } catch (e) {
      const se = e instanceof StorageError ? e : new StorageError("unknown", "unknown");
      return { ok: false, code: se.code, message: se.message };
    }
  }

  async delete(key: string): Promise<void> {
    await this.withRetries(async () => {
      const res = await this.request(this.url(`/delete/${encodeURIComponent(key)}`), { method: "DELETE" });
      if (res.status === 404) return; // already gone
      if (!res.ok) throw await this.toError(res);
    });
  }
}

/** Returns a configured DBByte client, or null when env vars are missing. */
export function getDbbyteStorage(env: NodeJS.ProcessEnv = process.env): DbbyteStorage | null {
  const cfg = getDbbyteConfig(env);
  return cfg ? new DbbyteStorage(cfg) : null;
}
