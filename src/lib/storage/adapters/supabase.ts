import { encodePathSegments, providerFetch, type HttpOptions } from "../http";
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

export interface SupabaseStorageConfig {
  /** https://<project-ref>.supabase.co */
  url: string;
  /** Server-only service-role key. Never exposed to the browser. */
  serviceRoleKey: string;
  /** MUST be a private bucket. */
  bucket: string;
  prefix?: string;
}

export function supabaseConfigFromEnv(env: Record<string, string | undefined> = process.env): SupabaseStorageConfig | null {
  const url = (env.SUPABASE_URL ?? "").trim().replace(/\/+$/, "");
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !serviceRoleKey) return null;
  return { url, serviceRoleKey, bucket: env.SUPABASE_THUMBNAIL_BUCKET?.trim() || "onfile-thumbnails" };
}

/**
 * Supabase Storage REST adapter. The bucket is PRIVATE; delivery uses
 * short-lived signed URLs (POST /object/sign/{bucket}/{path}) whose JWT
 * `exp` is enforced by Supabase Storage.
 */
export class SupabaseStorageAdapter implements StorageAdapter {
  readonly key = "supabase" as const;
  readonly displayName = "Supabase Storage";

  constructor(
    private readonly config: SupabaseStorageConfig | null,
    private readonly http: HttpOptions = {}
  ) {}

  isConfigured(): boolean {
    return !!this.config;
  }

  private cfg(): SupabaseStorageConfig {
    if (!this.config) throw new ProviderError("auth", "Supabase Storage is not configured");
    return this.config;
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    const c = this.cfg();
    return { Authorization: `Bearer ${c.serviceRoleKey}`, apikey: c.serviceRoleKey, ...extra };
  }

  private objectUrl(kind: string, path: string): string {
    const c = this.cfg();
    return `${c.url}/storage/v1/${kind}/${encodeURIComponent(c.bucket)}/${encodePathSegments(path)}`;
  }

  async upload(input: UploadInput): Promise<UploadResult> {
    const c = this.cfg();
    const path = `${c.prefix ?? "thumbnails"}/${input.objectName}`;
    await providerFetch(
      this.objectUrl("object", path),
      {
        method: "POST",
        headers: this.headers({ "Content-Type": input.mimeType, "x-upsert": "false", "cache-control": "max-age=3600" }),
        body: new Uint8Array(input.buffer),
      },
      this.http
    );
    return { objectKey: path, deliveryMetadata: { bucket: c.bucket }, size: input.buffer.length };
  }

  async delete(ref: ObjectRef): Promise<void> {
    try {
      await providerFetch(this.objectUrl("object", ref.objectKey), { method: "DELETE", headers: this.headers() }, this.http);
    } catch (err) {
      if (err instanceof ProviderError && err.kind === "not_found") return;
      throw err;
    }
  }

  async getMetadata(ref: ObjectRef): Promise<CapabilityResult<ObjectMetadata>> {
    const res = await providerFetch(this.objectUrl("object/info", ref.objectKey), { headers: this.headers() }, this.http);
    const j = (await res.json()) as { size?: number; content_type?: string; metadata?: { size?: number; mimetype?: string } };
    return supported({
      size: num(j.size) ?? num(j.metadata?.size),
      mimeType: j.content_type ?? j.metadata?.mimetype,
    });
  }

  async getDeliveryUrl(ref: ObjectRef, opts: { expiresInSeconds: number }): Promise<CapabilityResult<DeliveryUrl>> {
    const c = this.cfg();
    const res = await providerFetch(
      this.objectUrl("object/sign", ref.objectKey),
      { method: "POST", headers: this.headers({ "Content-Type": "application/json" }), body: JSON.stringify({ expiresIn: opts.expiresInSeconds }) },
      this.http
    );
    const j = (await res.json()) as { signedURL?: string; signedUrl?: string };
    const rel = j.signedURL ?? j.signedUrl;
    if (!rel) throw new ProviderError("unknown", "Supabase did not return a signed URL");
    const url = /^https?:\/\//i.test(rel) ? rel : `${c.url}/storage/v1${rel.startsWith("/") ? "" : "/"}${rel}`;
    return supported({ url, expiresAt: new Date(Date.now() + opts.expiresInSeconds * 1000), clientSafe: true });
  }

  async checkHealth(): Promise<HealthResult> {
    const c = this.cfg();
    const started = Date.now();
    try {
      const res = await providerFetch(`${c.url}/storage/v1/bucket/${encodeURIComponent(c.bucket)}`, { headers: this.headers() }, this.http);
      const j = (await res.json()) as { public?: boolean };
      if (j.public === true) {
        return {
          ok: false,
          latencyMs: Date.now() - started,
          detail: `Bucket "${c.bucket}" is PUBLIC. Thumbnails must live in a private bucket.`,
          warnings: ["bucket_public"],
        };
      }
      return { ok: true, latencyMs: Date.now() - started };
    } catch (err) {
      return failureHealth(err, started);
    }
  }

  async getUsage(): Promise<CapabilityResult<UsageSnapshot>> {
    return unsupported(
      "Supabase exposes no per-project Storage usage endpoint to service-role keys. Use manual values (dashboard) or Onfile's estimate."
    );
  }

  async downloadForMigration(ref: ObjectRef): Promise<{ buffer: Buffer; mimeType: string }> {
    const res = await providerFetch(this.objectUrl("object/authenticated", ref.objectKey), { headers: this.headers() }, this.http);
    return {
      buffer: Buffer.from(await res.arrayBuffer()),
      mimeType: mimeFromContentType(res.headers.get("content-type"), "application/octet-stream"),
    };
  }

  verifyObject(ref: ObjectRef, expected: { checksum: string; size: number }): Promise<VerifyResult> {
    return verifyByDownload(this, ref, expected);
  }
}
