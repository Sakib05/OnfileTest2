import crypto from "crypto";
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
import { basicAuth, extForMime, mimeFromContentType, num, verifyByDownload } from "./common";
import { failureHealth } from "./imagekit";

export interface CloudinaryConfig {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
  apiBase?: string; // default https://api.cloudinary.com
  cdnBase?: string; // default https://res.cloudinary.com
  folder?: string;
}

export function cloudinaryConfigFromEnv(env: Record<string, string | undefined> = process.env): CloudinaryConfig | null {
  const cloudName = env.CLOUDINARY_CLOUD_NAME?.trim();
  const apiKey = env.CLOUDINARY_API_KEY?.trim();
  const apiSecret = env.CLOUDINARY_API_SECRET?.trim();
  if (!cloudName || !apiKey || !apiSecret) return null;
  return { cloudName, apiKey, apiSecret };
}

/** Cloudinary API signature: SHA-1 hex of "k1=v1&k2=v2…" (sorted) + api_secret. */
export function signCloudinaryParams(params: Record<string, string | number>, apiSecret: string): string {
  const toSign = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join("&");
  return crypto.createHash("sha1").update(toSign + apiSecret).digest("hex");
}

/** Signed delivery URL signature for `authenticated` assets: first 8 chars of urlsafe-base64(SHA-1(path + secret)). */
export function signCloudinaryDeliveryPath(pathToSign: string, apiSecret: string): string {
  return crypto
    .createHash("sha1")
    .update(pathToSign + apiSecret)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .slice(0, 8);
}

/**
 * SECURITY NOTE (verified against Cloudinary docs/support, not assumed):
 * - Assets are uploaded with type=authenticated, so un-signed delivery 404s.
 * - A Cloudinary *signed delivery URL does NOT expire*. Expiring token-based
 *   authentication requires an Advanced plan or higher (and a custom CNAME),
 *   so it is NOT available on the Free plan.
 * - Therefore this adapter marks its delivery URL `clientSafe: false`: the
 *   non-expiring URL never leaves the server. Onfile authorises the request,
 *   fetches the bytes server-side and streams them to the client.
 */
export class CloudinaryAdapter implements StorageAdapter {
  readonly key = "cloudinary" as const;
  readonly displayName = "Cloudinary";

  constructor(
    private readonly config: CloudinaryConfig | null,
    private readonly http: HttpOptions = {}
  ) {}

  isConfigured(): boolean {
    return !!this.config;
  }

  private cfg(): CloudinaryConfig {
    if (!this.config) throw new ProviderError("auth", "Cloudinary is not configured");
    return this.config;
  }

  private api(path: string): string {
    const c = this.cfg();
    return `${c.apiBase ?? "https://api.cloudinary.com"}/v1_1/${encodeURIComponent(c.cloudName)}${path}`;
  }

  private basic(): Record<string, string> {
    const c = this.cfg();
    return { Authorization: basicAuth(c.apiKey, c.apiSecret) };
  }

  async upload(input: UploadInput): Promise<UploadResult> {
    const c = this.cfg();
    const publicId = `${c.folder ?? "onfile-thumbnails"}/${input.objectName.replace(/\.[a-z0-9]+$/i, "")}`;
    const timestamp = Math.floor(Date.now() / 1000);
    const signed = { overwrite: "false", public_id: publicId, timestamp, type: "authenticated" };
    const form = new FormData();
    form.append("file", toBlob(input.buffer, input.mimeType), input.objectName);
    form.append("api_key", c.apiKey);
    form.append("signature", signCloudinaryParams(signed, c.apiSecret));
    for (const [k, v] of Object.entries(signed)) form.append(k, String(v));
    const res = await providerFetch(this.api("/image/upload"), { method: "POST", body: form }, this.http);
    const j = (await res.json()) as { public_id?: string; version?: number; format?: string; bytes?: number };
    if (!j.public_id || j.version === undefined) throw new ProviderError("unknown", "Cloudinary upload returned an unexpected response");
    return {
      objectKey: j.public_id,
      deliveryMetadata: { version: j.version, format: j.format ?? extForMime(input.mimeType), resourceType: "image" },
      size: num(j.bytes) ?? input.buffer.length,
    };
  }

  async delete(ref: ObjectRef): Promise<void> {
    const c = this.cfg();
    const timestamp = Math.floor(Date.now() / 1000);
    const signed = { invalidate: "true", public_id: ref.objectKey, timestamp, type: "authenticated" };
    const form = new FormData();
    form.append("api_key", c.apiKey);
    form.append("signature", signCloudinaryParams(signed, c.apiSecret));
    for (const [k, v] of Object.entries(signed)) form.append(k, String(v));
    try {
      const res = await providerFetch(this.api("/image/destroy"), { method: "POST", body: form }, this.http);
      const j = (await res.json()) as { result?: string };
      if (j.result !== "ok" && j.result !== "not found") {
        throw new ProviderError("unknown", `Cloudinary destroy returned "${j.result ?? "unknown"}"`);
      }
    } catch (err) {
      if (err instanceof ProviderError && err.kind === "not_found") return;
      throw err;
    }
  }

  async getMetadata(ref: ObjectRef): Promise<CapabilityResult<ObjectMetadata>> {
    const res = await providerFetch(
      this.api(`/resources/image/authenticated/${encodePathSegments(ref.objectKey)}`),
      { headers: this.basic() },
      this.http
    );
    const j = (await res.json()) as { bytes?: number; width?: number; height?: number; format?: string };
    return supported({
      size: num(j.bytes),
      width: num(j.width),
      height: num(j.height),
      mimeType: j.format ? `image/${j.format === "jpg" ? "jpeg" : j.format}` : undefined,
    });
  }

  async getDeliveryUrl(ref: ObjectRef): Promise<CapabilityResult<DeliveryUrl>> {
    const c = this.cfg();
    const format = typeof ref.deliveryMetadata.format === "string" ? ref.deliveryMetadata.format : "webp";
    const version = ref.deliveryMetadata.version;
    const publicIdWithExt = `${ref.objectKey}.${format}`;
    const sig = signCloudinaryDeliveryPath(publicIdWithExt, c.apiSecret);
    const v = version !== undefined && version !== null ? `v${String(version)}/` : "";
    return supported({
      url: `${c.cdnBase ?? "https://res.cloudinary.com"}/${encodeURIComponent(c.cloudName)}/image/authenticated/s--${sig}--/${v}${encodePathSegments(publicIdWithExt)}`,
      expiresAt: null, // Cloudinary signed URLs do not expire on the Free plan.
      clientSafe: false,
    });
  }

  async checkHealth(): Promise<HealthResult> {
    const started = Date.now();
    try {
      const res = await providerFetch(this.api("/ping"), { headers: this.basic() }, this.http);
      const j = (await res.json()) as { status?: string };
      if (j.status && j.status.toUpperCase() !== "OK") {
        return { ok: false, latencyMs: Date.now() - started, detail: `ping returned ${j.status}` };
      }
      return { ok: true, latencyMs: Date.now() - started };
    } catch (err) {
      return failureHealth(err, started);
    }
  }

  async getUsage(): Promise<CapabilityResult<UsageSnapshot>> {
    const res = await providerFetch(this.api("/usage"), { headers: this.basic() }, this.http);
    const j = (await res.json()) as Record<string, unknown>;
    const pick = (o: unknown): number | undefined =>
      o && typeof o === "object" ? num((o as Record<string, unknown>).usage) : num(o);
    const storage = pick(j.storage);
    const bandwidth = pick(j.bandwidth);
    const requests = num(j.requests);
    if (storage === undefined && bandwidth === undefined) {
      return unsupported("Cloudinary usage response did not contain storage/bandwidth usage");
    }
    const credits = (j.credits ?? {}) as Record<string, unknown>;
    return supported({
      storageBytes: storage,
      bandwidthBytes: bandwidth,
      requests,
      extra: {
        plan: typeof j.plan === "string" ? j.plan : null,
        creditsUsed: num(credits.usage) ?? null,
        creditsLimit: num(credits.limit) ?? null,
        creditsUsedPercent: num(credits.used_percent) ?? null,
        note: "Cloudinary free plans are credit-based; byte quotas must be configured manually.",
      },
    });
  }

  async downloadForMigration(ref: ObjectRef): Promise<{ buffer: Buffer; mimeType: string }> {
    const url = await this.getDeliveryUrl(ref);
    if (!url.supported) throw new ProviderError("unknown", url.reason);
    const res = await providerFetch(url.value.url, {}, this.http);
    return {
      buffer: Buffer.from(await res.arrayBuffer()),
      mimeType: mimeFromContentType(res.headers.get("content-type"), "application/octet-stream"),
    };
  }

  verifyObject(ref: ObjectRef, expected: { checksum: string; size: number }): Promise<VerifyResult> {
    return verifyByDownload(this, ref, expected);
  }
}
