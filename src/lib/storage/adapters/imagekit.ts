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
import { basicAuth, mimeFromContentType, num, verifyByDownload } from "./common";

export interface ImageKitConfig {
  privateKey: string;
  /** e.g. https://ik.imagekit.io/your_imagekit_id */
  urlEndpoint: string;
  uploadBase?: string;
  apiBase?: string;
  folder?: string;
}

export function imageKitConfigFromEnv(env: Record<string, string | undefined> = process.env): ImageKitConfig | null {
  const privateKey = env.IMAGEKIT_PRIVATE_KEY?.trim();
  const urlEndpoint = env.IMAGEKIT_URL_ENDPOINT?.trim();
  if (!privateKey || !urlEndpoint) return null;
  return { privateKey, urlEndpoint };
}

/**
 * ImageKit signed URL (documented algorithm, https://imagekit.io/docs/media-delivery-basic-security):
 *   signature = HMAC-SHA1(privateKey, <path after url endpoint, no leading "/"> + <expiry unix seconds>)  (lowercase hex)
 *   URL       = <endpoint>/<path>?ik-t=<expiry>&ik-s=<signature>
 * ImageKit stops honouring the URL after ik-t (the expiry is part of the signed string).
 * Files uploaded with isPrivateFile=true can ONLY be fetched with a signed URL.
 */
export function signImageKitUrl(
  urlEndpoint: string,
  filePath: string,
  privateKey: string,
  expiresAtSeconds: number,
  /** Optional path transformation, e.g. "tr:orig-true" (serve the stored bytes unmodified). */
  transformation?: string
): string {
  const endpoint = urlEndpoint.endsWith("/") ? urlEndpoint : urlEndpoint + "/";
  const rel = encodePathSegments(filePath.replace(/^\/+/, ""));
  const path = transformation ? `${transformation}/${rel}` : rel;
  const signature = crypto
    .createHmac("sha1", privateKey)
    .update(path + String(expiresAtSeconds))
    .digest("hex");
  return `${endpoint}${path}?ik-t=${expiresAtSeconds}&ik-s=${signature}`;
}

export class ImageKitAdapter implements StorageAdapter {
  readonly key = "imagekit" as const;
  readonly displayName = "ImageKit";

  constructor(
    private readonly config: ImageKitConfig | null,
    private readonly http: HttpOptions = {}
  ) {}

  isConfigured(): boolean {
    return !!this.config;
  }

  private cfg(): ImageKitConfig {
    if (!this.config) throw new ProviderError("auth", "ImageKit is not configured");
    return this.config;
  }

  private auth(): Record<string, string> {
    return { Authorization: basicAuth(this.cfg().privateKey, "") };
  }

  async upload(input: UploadInput): Promise<UploadResult> {
    const c = this.cfg();
    const form = new FormData();
    form.append("file", toBlob(input.buffer, input.mimeType), input.objectName);
    form.append("fileName", input.objectName);
    form.append("useUniqueFileName", "false");
    form.append("folder", c.folder ?? "/onfile-thumbnails");
    form.append("isPrivateFile", "true");
    const res = await providerFetch(
      `${c.uploadBase ?? "https://upload.imagekit.io"}/api/v1/files/upload`,
      { method: "POST", headers: this.auth(), body: form },
      this.http
    );
    const json = (await res.json()) as { fileId?: string; filePath?: string; name?: string; size?: number };
    if (!json.fileId || !json.filePath) throw new ProviderError("unknown", "ImageKit upload returned an unexpected response");
    return {
      objectKey: json.fileId,
      deliveryMetadata: { filePath: json.filePath, name: json.name ?? input.objectName },
      size: num(json.size) ?? input.buffer.length,
    };
  }

  async delete(ref: ObjectRef): Promise<void> {
    const c = this.cfg();
    try {
      await providerFetch(
        `${c.apiBase ?? "https://api.imagekit.io"}/v1/files/${encodeURIComponent(ref.objectKey)}`,
        { method: "DELETE", headers: this.auth() },
        this.http
      );
    } catch (err) {
      if (err instanceof ProviderError && err.kind === "not_found") return;
      throw err;
    }
  }

  async getMetadata(ref: ObjectRef): Promise<CapabilityResult<ObjectMetadata>> {
    const c = this.cfg();
    const res = await providerFetch(
      `${c.apiBase ?? "https://api.imagekit.io"}/v1/files/${encodeURIComponent(ref.objectKey)}/details`,
      { headers: this.auth() },
      this.http
    );
    const j = (await res.json()) as { size?: number; mime?: string; width?: number; height?: number };
    return supported({ size: num(j.size), mimeType: j.mime, width: num(j.width), height: num(j.height) });
  }

  async getDeliveryUrl(
    ref: ObjectRef,
    opts: { expiresInSeconds: number; original?: boolean }
  ): Promise<CapabilityResult<DeliveryUrl>> {
    const c = this.cfg();
    const filePath = typeof ref.deliveryMetadata.filePath === "string" ? ref.deliveryMetadata.filePath : null;
    if (!filePath) return unsupported("ImageKit asset has no filePath metadata");
    const expiresAtSeconds = Math.floor(Date.now() / 1000) + opts.expiresInSeconds;
    return supported({
      url: signImageKitUrl(c.urlEndpoint, filePath, c.privateKey, expiresAtSeconds, opts.original ? "tr:orig-true" : undefined),
      expiresAt: new Date(expiresAtSeconds * 1000),
      clientSafe: true,
    });
  }

  async checkHealth(): Promise<HealthResult> {
    const c = this.cfg();
    const started = Date.now();
    try {
      await providerFetch(`${c.apiBase ?? "https://api.imagekit.io"}/v1/files?limit=1`, { headers: this.auth() }, this.http);
      return { ok: true, latencyMs: Date.now() - started };
    } catch (err) {
      return failureHealth(err, started);
    }
  }

  async getUsage(opts?: { periodStart?: Date }): Promise<CapabilityResult<UsageSnapshot>> {
    const c = this.cfg();
    const end = new Date();
    const start = opts?.periodStart ?? new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1));
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    const res = await providerFetch(
      `${c.apiBase ?? "https://api.imagekit.io"}/v1/accounts/usage?startDate=${fmt(start)}&endDate=${fmt(end)}`,
      { headers: this.auth() },
      this.http
    );
    const j = (await res.json()) as Record<string, unknown>;
    const storage = num(j.mediaLibraryStorageBytes);
    const bandwidth = num(j.bandwidthBytes);
    if (storage === undefined && bandwidth === undefined) {
      return unsupported("ImageKit usage response did not contain the expected fields");
    }
    return supported({
      storageBytes: storage,
      bandwidthBytes: bandwidth,
      periodStart: start,
      extra: { originalCacheStorageBytes: num(j.originalCacheStorageBytes) ?? null },
    });
  }

  async downloadForMigration(ref: ObjectRef): Promise<{ buffer: Buffer; mimeType: string }> {
    // tr:orig-true asks ImageKit for the stored bytes (no automatic optimisation) so checksums are comparable.
    const url = await this.getDeliveryUrl(ref, { expiresInSeconds: 120, original: true });
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

export function failureHealth(err: unknown, started: number): HealthResult {
  const latencyMs = Date.now() - started;
  if (err instanceof ProviderError) {
    return { ok: false, latencyMs, detail: err.message, authFailure: err.kind === "auth" };
  }
  return { ok: false, latencyMs, detail: err instanceof Error ? err.message : "unknown error" };
}
