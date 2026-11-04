import { encodePathSegments, providerFetch, toBlob, type HttpOptions } from "../http";
import {
  ProviderError,
  supported,
  unsupported,
  type CapabilityResult,
  type DeliveryUrl,
  type HealthResult,
  type ObjectMetadata,
  type ObjectRef,
  type StorageAdapter,
  type UploadInput,
  type UploadResult,
  type UsageSnapshot,
  type VerifyResult,
} from "../types";
import { mimeFromContentType, num, verifyByDownload } from "./common";
import { failureHealth } from "./imagekit";

export interface DBByteConfig {
  apiKey: string;
  /** Bucket slug. Must be a PRIVATE bucket (is_public=false). */
  bucket: string;
  baseUrl?: string; // default https://api.dbbyte.com
}

export function dbbyteConfigFromEnv(env: Record<string, string | undefined> = process.env): DBByteConfig | null {
  const apiKey = env.DBBYTE_API_KEY?.trim();
  const bucket = env.DBBYTE_BUCKET?.trim();
  if (!apiKey || !bucket) return null;
  return { apiKey, bucket, baseUrl: env.DBBYTE_BASE_URL?.trim() || undefined };
}

const MAX_SIGN_SECONDS = 604800; // documented maximum (7 days)

/**
 * DBByte adapter.
 *
 * DBByte is NOT S3-compatible as far as its official SDKs show: it exposes a
 * REST API (https://api.dbbyte.com) with Bearer API-key auth. Endpoints below
 * mirror the official @dbbyte/sdk (github.com/dbbyte-dev/dbbyte-js):
 *   POST   /storage/{bucket}/upload            multipart "file" (409 if name exists)
 *   GET    /storage/{bucket}/download/{key}
 *   DELETE /storage/{bucket}/delete/{key}
 *   POST   /storage/{bucket}/sign/{key}        {expiresIn<=604800} -> {url, expiresIn}
 *   GET    /health
 * The `key` returned by upload is a storage-generated id and is what every
 * later call must use. There is NO documented object-metadata endpoint and NO
 * usage/analytics API, so getMetadata/getUsage return "unsupported" and
 * quotas/usage are manual or estimated.
 * A 429 WITHOUT Retry-After means the plan's API request quota is exhausted
 * (per the SDK docs) and is classified as `quota`, not as a retryable burst.
 */
export class DBByteAdapter implements StorageAdapter {
  readonly key = "dbbyte" as const;
  readonly displayName = "DBByte";

  constructor(
    private readonly config: DBByteConfig | null,
    private readonly http: HttpOptions = {}
  ) {}

  isConfigured(): boolean {
    return !!this.config;
  }

  private cfg(): DBByteConfig {
    if (!this.config) throw new ProviderError("auth", "DBByte is not configured");
    return this.config;
  }

  private base(): string {
    return (this.cfg().baseUrl ?? "https://api.dbbyte.com").replace(/\/+$/, "");
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return { Authorization: `Bearer ${this.cfg().apiKey}`, ...extra };
  }

  private f(url: string, init: RequestInit) {
    return providerFetch(url, init, this.http, { quotaWhen429WithoutRetryAfter: true });
  }

  private bucketPath(): string {
    return `${this.base()}/storage/${encodeURIComponent(this.cfg().bucket)}`;
  }

  async upload(input: UploadInput): Promise<UploadResult> {
    const form = new FormData();
    form.append("file", toBlob(input.buffer, input.mimeType), input.objectName);
    const res = await this.f(`${this.bucketPath()}/upload`, { method: "POST", headers: this.headers(), body: form });
    const j = (await res.json()) as { key?: string; fileId?: string; name?: string; size?: number };
    if (!j.key) throw new ProviderError("unknown", "DBByte upload returned an unexpected response");
    return {
      objectKey: j.key,
      deliveryMetadata: { fileId: j.fileId ?? null, name: j.name ?? input.objectName },
      size: num(j.size) ?? input.buffer.length,
    };
  }

  async delete(ref: ObjectRef): Promise<void> {
    try {
      await this.f(`${this.bucketPath()}/delete/${encodePathSegments(ref.objectKey)}`, { method: "DELETE", headers: this.headers() });
    } catch (err) {
      if (err instanceof ProviderError && err.kind === "not_found") return;
      throw err;
    }
  }

  async getMetadata(): Promise<CapabilityResult<ObjectMetadata>> {
    return unsupported("DBByte documents no object-metadata endpoint; size is recorded from the upload response and checked via verifyObject()");
  }

  async getDeliveryUrl(ref: ObjectRef, opts: { expiresInSeconds: number }): Promise<CapabilityResult<DeliveryUrl>> {
    const expiresIn = Math.max(1, Math.min(MAX_SIGN_SECONDS, Math.floor(opts.expiresInSeconds)));
    const res = await this.f(`${this.bucketPath()}/sign/${encodePathSegments(ref.objectKey)}`, {
      method: "POST",
      headers: this.headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({ expiresIn }),
    });
    const j = (await res.json()) as { url?: string; expiresIn?: number };
    if (!j.url) throw new ProviderError("unknown", "DBByte did not return a signed URL");
    const url = /^https?:\/\//i.test(j.url) ? j.url : `${this.base()}${j.url.startsWith("/") ? "" : "/"}${j.url}`;
    const ttl = num(j.expiresIn) ?? expiresIn;
    return supported({ url, expiresAt: new Date(Date.now() + ttl * 1000), clientSafe: true });
  }

  async checkHealth(opts?: { deep?: boolean }): Promise<HealthResult> {
    const started = Date.now();
    try {
      const res = await this.f(`${this.base()}/health`, { headers: this.headers() });
      const j = (await res.json().catch(() => ({}))) as { status?: string };
      if (j.status && j.status !== "ok") {
        return { ok: false, latencyMs: Date.now() - started, detail: `DBByte health reported "${j.status}"` };
      }
      if (opts?.deep) {
        // Costs one metered API request: validates the key + bucket access.
        await this.f(`${this.bucketPath()}/list?limit=1`, { headers: this.headers() });
      }
      return { ok: true, latencyMs: Date.now() - started };
    } catch (err) {
      return failureHealth(err, started);
    }
  }

  async getUsage(): Promise<CapabilityResult<UsageSnapshot>> {
    return unsupported("DBByte has no analytics/usage API; quotas and usage are manual or estimated");
  }

  async downloadForMigration(ref: ObjectRef): Promise<{ buffer: Buffer; mimeType: string }> {
    const res = await this.f(`${this.bucketPath()}/download/${encodePathSegments(ref.objectKey)}`, { headers: this.headers() });
    return {
      buffer: Buffer.from(await res.arrayBuffer()),
      mimeType: mimeFromContentType(res.headers.get("content-type"), "application/octet-stream"),
    };
  }

  verifyObject(ref: ObjectRef, expected: { checksum: string; size: number }): Promise<VerifyResult> {
    return verifyByDownload(this, ref, expected);
  }
}
