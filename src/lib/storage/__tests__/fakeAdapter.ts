import { verifyByDownload } from "../adapters/common";
import { sha256Hex } from "../http";
import {
  ProviderError,
  supported,
  unsupported,
  type CapabilityResult,
  type DeliveryUrl,
  type HealthResult,
  type ObjectMetadata,
  type ObjectRef,
  type ProviderKey,
  type StorageAdapter,
  type UploadInput,
  type UploadResult,
  type UsageSnapshot,
  type VerifyResult,
} from "../types";

type Hook<T> = T | (() => T | null | undefined) | null;
const resolve = <T>(h: Hook<T>): T | null => (typeof h === "function" ? ((h as () => T | null | undefined)() ?? null) : (h ?? null));

/** In-memory provider used by integration tests (never touches a real provider quota). */
export class FakeAdapter implements StorageAdapter {
  readonly displayName: string;
  store = new Map<string, Buffer>();
  configured = true;
  clientSafe = true;
  uploadError: Hook<ProviderError> = null;
  deleteError: Hook<ProviderError> = null;
  downloadError: Hook<ProviderError> = null;
  corruptDownload = false;
  health: HealthResult = { ok: true, latencyMs: 1 };
  usage: CapabilityResult<UsageSnapshot> = unsupported("fake: no usage API");
  onUpload: ((input: UploadInput) => Promise<void>) | null = null;
  uploads = 0;
  deletes = 0;
  private seq = 0;

  constructor(public readonly key: ProviderKey) {
    this.displayName = `Fake ${key}`;
  }

  isConfigured() {
    return this.configured;
  }

  async upload(input: UploadInput): Promise<UploadResult> {
    const err = resolve(this.uploadError);
    if (err) throw err;
    this.uploads++;
    const objectKey = `${this.key}/${++this.seq}-${input.objectName}`;
    this.store.set(objectKey, Buffer.from(input.buffer));
    if (this.onUpload) await this.onUpload(input);
    return { objectKey, deliveryMetadata: { fake: true }, size: input.buffer.length };
  }

  async delete(ref: ObjectRef): Promise<void> {
    const err = resolve(this.deleteError);
    if (err) throw err;
    this.deletes++;
    this.store.delete(ref.objectKey);
  }

  async getMetadata(ref: ObjectRef): Promise<CapabilityResult<ObjectMetadata>> {
    const b = this.store.get(ref.objectKey);
    return b ? supported({ size: b.length }) : unsupported("missing");
  }

  async getDeliveryUrl(ref: ObjectRef, opts: { expiresInSeconds: number }): Promise<CapabilityResult<DeliveryUrl>> {
    if (!this.store.has(ref.objectKey)) throw new ProviderError("not_found", "missing", 404);
    const exp = Date.now() + opts.expiresInSeconds * 1000;
    return supported({
      url: `https://fake-${this.key}.test/${ref.objectKey}?exp=${exp}&sig=abc`,
      expiresAt: this.clientSafe ? new Date(exp) : null,
      clientSafe: this.clientSafe,
    });
  }

  async checkHealth(): Promise<HealthResult> {
    return this.health;
  }

  async getUsage(): Promise<CapabilityResult<UsageSnapshot>> {
    return this.usage;
  }

  async downloadForMigration(ref: ObjectRef): Promise<{ buffer: Buffer; mimeType: string }> {
    const err = resolve(this.downloadError);
    if (err) throw err;
    const b = this.store.get(ref.objectKey);
    if (!b) throw new ProviderError("not_found", "missing", 404);
    return { buffer: this.corruptDownload ? Buffer.concat([b, Buffer.from("x")]) : Buffer.from(b), mimeType: "image/webp" };
  }

  verifyObject(ref: ObjectRef, expected: { checksum: string; size: number }): Promise<VerifyResult> {
    return verifyByDownload(this, ref, expected);
  }

  checksumOf(objectKey: string): string | null {
    const b = this.store.get(objectKey);
    return b ? sha256Hex(b) : null;
  }
}
