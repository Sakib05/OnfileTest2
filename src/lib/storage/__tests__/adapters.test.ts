import crypto from "crypto";
import { describe, expect, it, vi } from "vitest";
import { classifyHttpFailure, providerFetch, sha256Hex, withRetry } from "../http";
import { CloudinaryAdapter, signCloudinaryDeliveryPath, signCloudinaryParams } from "../adapters/cloudinary";
import { DBByteAdapter } from "../adapters/dbbyte";
import { ImageKitAdapter, signImageKitUrl } from "../adapters/imagekit";
import { SupabaseStorageAdapter } from "../adapters/supabase";
import { ProviderError } from "../types";

type Call = { url: string; init: RequestInit };
type Responder = (call: Call) => Response | Promise<Response>;

function mockFetch(responder: Responder) {
  const calls: Call[] = [];
  const fetchImpl = async (url: string, init: RequestInit = {}) => {
    const call = { url, init };
    calls.push(call);
    return responder(call);
  };
  return { calls, fetchImpl };
}
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const bytes = (b: Buffer, status = 200) => new Response(new Uint8Array(b), { status, headers: { "content-type": "image/webp" } });

const IMG = Buffer.from("RIFFxxxxWEBPfake-image-bytes");
const input = { buffer: IMG, mimeType: "image/webp", objectName: "12-abc.webp", checksum: sha256Hex(IMG) };

describe("ImageKit adapter", () => {
  const cfg = { privateKey: "private_test", urlEndpoint: "https://ik.imagekit.io/demo" };

  it("uploads privately with basic auth, deletes, reads metadata, checks health and usage", async () => {
    const { calls, fetchImpl } = mockFetch(({ url }) => {
      if (url.includes("/files/upload")) return json({ fileId: "fid1", filePath: "/onfile-thumbnails/12-abc.webp", name: "12-abc.webp", size: IMG.length });
      if (url.endsWith("/details")) return json({ size: IMG.length, mime: "image/webp", width: 10, height: 8 });
      if (url.includes("/accounts/usage")) return json({ bandwidthBytes: 1000, mediaLibraryStorageBytes: 500, originalCacheStorageBytes: 0 });
      return new Response(null, { status: 204 });
    });
    const a = new ImageKitAdapter(cfg, { fetchImpl });
    const up = await a.upload(input);
    expect(up.objectKey).toBe("fid1");
    const upCall = calls[0];
    expect(upCall.url).toBe("https://upload.imagekit.io/api/v1/files/upload");
    expect((upCall.init.headers as Record<string, string>).Authorization).toBe("Basic " + Buffer.from("private_test:").toString("base64"));
    expect((upCall.init.body as FormData).get("isPrivateFile")).toBe("true");

    const meta = await a.getMetadata({ objectKey: "fid1", deliveryMetadata: {} });
    expect(meta).toMatchObject({ supported: true, value: { size: IMG.length, width: 10 } });
    expect(await a.checkHealth()).toMatchObject({ ok: true });
    expect(await a.getUsage()).toMatchObject({ supported: true, value: { storageBytes: 500, bandwidthBytes: 1000 } });
    await a.delete({ objectKey: "fid1", deliveryMetadata: {} });
    expect(calls.at(-1)!.init.method).toBe("DELETE");
    expect(calls.at(-1)!.url).toBe("https://api.imagekit.io/v1/files/fid1");
  });

  it("delete is idempotent on 404", async () => {
    const a = new ImageKitAdapter(cfg, { fetchImpl: mockFetch(() => json({}, 404)).fetchImpl });
    await expect(a.delete({ objectKey: "gone", deliveryMetadata: {} })).resolves.toBeUndefined();
  });

  it("signs delivery URLs with HMAC-SHA1(path + expiry) and an ik-t expiry (documented algorithm)", async () => {
    const a = new ImageKitAdapter(cfg);
    const r = await a.getDeliveryUrl({ objectKey: "fid1", deliveryMetadata: { filePath: "/onfile-thumbnails/12-abc.webp" } }, { expiresInSeconds: 300 });
    expect(r.supported).toBe(true);
    if (!r.supported) return;
    const url = new URL(r.value.url);
    const expiry = Number(url.searchParams.get("ik-t"));
    expect(r.value.clientSafe).toBe(true);
    expect(expiry).toBeGreaterThan(Date.now() / 1000 + 290);
    expect(expiry).toBeLessThanOrEqual(Math.ceil(Date.now() / 1000) + 301);
    const expected = crypto.createHmac("sha1", "private_test").update("onfile-thumbnails/12-abc.webp" + expiry).digest("hex");
    expect(url.searchParams.get("ik-s")).toBe(expected);
    expect(url.pathname).toBe("/demo/onfile-thumbnails/12-abc.webp");
    // Tampering with the expiry invalidates the signature (the expiry is part of the signed string).
    const tampered = crypto.createHmac("sha1", "private_test").update("onfile-thumbnails/12-abc.webp" + (expiry + 3600)).digest("hex");
    expect(tampered).not.toBe(url.searchParams.get("ik-s"));
    expect(r.value.url).not.toContain("private_test");
  });

  it("signs transformed (original) download URLs including the transformation in the signed path", () => {
    const url = new URL(signImageKitUrl(cfg.urlEndpoint, "/a/b.webp", cfg.privateKey, 1900000000, "tr:orig-true"));
    expect(url.pathname).toBe("/demo/tr:orig-true/a/b.webp");
    expect(url.searchParams.get("ik-s")).toBe(crypto.createHmac("sha1", "private_test").update("tr:orig-true/a/b.webp1900000000").digest("hex"));
  });

  it("verifyObject detects checksum mismatch", async () => {
    const a = new ImageKitAdapter(cfg, { fetchImpl: mockFetch(() => bytes(Buffer.from("different"))).fetchImpl });
    const ref = { objectKey: "f", deliveryMetadata: { filePath: "/x.webp" } };
    expect(await a.verifyObject(ref, { checksum: input.checksum, size: IMG.length })).toMatchObject({ ok: false });
    const good = new ImageKitAdapter(cfg, { fetchImpl: mockFetch(() => bytes(IMG)).fetchImpl });
    expect(await good.verifyObject(ref, { checksum: input.checksum, size: IMG.length })).toEqual({ ok: true });
  });

  it("maps 403 to an auth failure (never quota)", async () => {
    const a = new ImageKitAdapter(cfg, { fetchImpl: mockFetch(() => json({ message: "storage limit exceeded" }, 403)).fetchImpl });
    await expect(a.upload(input)).rejects.toMatchObject({ kind: "auth" });
    expect(await a.checkHealth()).toMatchObject({ ok: false, authFailure: true });
  });
});

describe("Cloudinary adapter", () => {
  const cfg = { cloudName: "demo", apiKey: "key123", apiSecret: "secret456" };

  it("signs upload params per the documented algorithm and uploads as type=authenticated", async () => {
    const { calls, fetchImpl } = mockFetch(() => json({ public_id: "onfile-thumbnails/12-abc", version: 1700000000, format: "webp", bytes: IMG.length }));
    const a = new CloudinaryAdapter(cfg, { fetchImpl });
    const up = await a.upload(input);
    expect(up.objectKey).toBe("onfile-thumbnails/12-abc");
    expect(up.deliveryMetadata).toMatchObject({ version: 1700000000, format: "webp" });
    const form = calls[0].init.body as FormData;
    expect(calls[0].url).toBe("https://api.cloudinary.com/v1_1/demo/image/upload");
    expect(form.get("type")).toBe("authenticated");
    const ts = form.get("timestamp");
    const expected = crypto
      .createHash("sha1")
      .update(`overwrite=false&public_id=onfile-thumbnails/12-abc&timestamp=${ts}&type=authenticated` + "secret456")
      .digest("hex");
    expect(form.get("signature")).toBe(expected);
    expect(form.get("api_secret")).toBeNull();
    expect(signCloudinaryParams({ b: 2, a: 1 }, "s")).toBe(crypto.createHash("sha1").update("a=1&b=2s").digest("hex"));
  });

  it("never hands a non-expiring signed URL to clients (clientSafe=false => server-side proxy)", async () => {
    const a = new CloudinaryAdapter(cfg);
    const r = await a.getDeliveryUrl({ objectKey: "onfile-thumbnails/12-abc", deliveryMetadata: { version: 17, format: "webp" } });
    expect(r.supported).toBe(true);
    if (!r.supported) return;
    expect(r.value.clientSafe).toBe(false);
    expect(r.value.expiresAt).toBeNull();
    expect(r.value.url).toContain("/image/authenticated/s--" + signCloudinaryDeliveryPath("onfile-thumbnails/12-abc.webp", "secret456") + "--/v17/onfile-thumbnails/12-abc.webp");
    expect(r.value.url).not.toContain("secret456");
  });

  it("destroys, reads metadata, pings and reads usage with basic auth", async () => {
    const { calls, fetchImpl } = mockFetch(({ url }) => {
      if (url.includes("/image/destroy")) return json({ result: "ok" });
      if (url.includes("/resources/image/authenticated/")) return json({ bytes: 5, width: 3, height: 2, format: "webp" });
      if (url.endsWith("/ping")) return json({ status: "OK" });
      if (url.endsWith("/usage")) return json({ plan: "Free", storage: { usage: 111 }, bandwidth: { usage: 222 }, requests: 33, credits: { usage: 1.5, limit: 25, used_percent: 6 } });
      return json({}, 404);
    });
    const a = new CloudinaryAdapter(cfg, { fetchImpl });
    const ref = { objectKey: "onfile-thumbnails/12-abc", deliveryMetadata: { version: 1, format: "webp" } };
    await a.delete(ref);
    expect((calls[0].init.body as FormData).get("invalidate")).toBe("true");
    expect(await a.getMetadata(ref)).toMatchObject({ supported: true, value: { size: 5, mimeType: "image/webp" } });
    expect(await a.checkHealth()).toMatchObject({ ok: true });
    const u = await a.getUsage();
    expect(u).toMatchObject({ supported: true, value: { storageBytes: 111, bandwidthBytes: 222, requests: 33 } });
    expect((calls.at(-1)!.init.headers as Record<string, string>).Authorization).toBe("Basic " + Buffer.from("key123:secret456").toString("base64"));
  });

  it("treats HTTP 420 as a rate limit with Retry-After from X-FeatureRateLimit-Reset", async () => {
    const reset = new Date(Date.now() + 2000).toUTCString();
    const a = new CloudinaryAdapter(cfg, { fetchImpl: mockFetch(() => json({}, 420, { "x-featureratelimit-reset": reset })).fetchImpl });
    const err = await a.upload(input).catch((e) => e);
    expect(err).toMatchObject({ kind: "rate_limited" });
    expect(err.retryAfterMs).toBeGreaterThan(0);
  });
});

describe("Supabase Storage adapter", () => {
  const cfg = { url: "https://proj.supabase.co", serviceRoleKey: "service_key", bucket: "thumbs" };

  it("uploads to a private bucket path, deletes (idempotently), downloads and reads metadata", async () => {
    const { calls, fetchImpl } = mockFetch(({ url, init }) => {
      if (init.method === "POST" && url.includes("/object/thumbs/")) return json({ Key: "thumbs/thumbnails/12-abc.webp" });
      if (url.includes("/object/info/")) return json({ size: IMG.length, content_type: "image/webp" });
      if (url.includes("/object/authenticated/")) return bytes(IMG);
      return json({}, 404);
    });
    const a = new SupabaseStorageAdapter(cfg, { fetchImpl });
    const up = await a.upload(input);
    expect(up.objectKey).toBe("thumbnails/12-abc.webp");
    expect(calls[0].url).toBe("https://proj.supabase.co/storage/v1/object/thumbs/thumbnails/12-abc.webp");
    expect((calls[0].init.headers as Record<string, string>)["x-upsert"]).toBe("false");
    expect(await a.getMetadata(up)).toMatchObject({ supported: true, value: { size: IMG.length } });
    expect((await a.downloadForMigration(up)).buffer.equals(IMG)).toBe(true);
    await expect(a.delete(up)).resolves.toBeUndefined(); // mocked 404 => already gone
  });

  it("requests short-lived signed URLs (provider-enforced JWT expiry) from a private bucket", async () => {
    const { calls, fetchImpl } = mockFetch(() => json({ signedURL: "/object/sign/thumbs/thumbnails/12-abc.webp?token=JWT" }));
    const a = new SupabaseStorageAdapter(cfg, { fetchImpl });
    const r = await a.getDeliveryUrl({ objectKey: "thumbnails/12-abc.webp", deliveryMetadata: {} }, { expiresInSeconds: 120 });
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ expiresIn: 120 });
    expect(r.supported).toBe(true);
    if (!r.supported) return;
    expect(r.value.url).toBe("https://proj.supabase.co/storage/v1/object/sign/thumbs/thumbnails/12-abc.webp?token=JWT");
    expect(r.value.clientSafe).toBe(true);
    expect(r.value.expiresAt!.getTime()).toBeGreaterThan(Date.now() + 100_000);
    expect(r.value.expiresAt!.getTime()).toBeLessThan(Date.now() + 130_000);
    expect(r.value.url).not.toContain("service_key");
  });

  it("flags a public bucket as unhealthy and reports usage as unsupported (no fabricated numbers)", async () => {
    const pub = new SupabaseStorageAdapter(cfg, { fetchImpl: mockFetch(() => json({ id: "thumbs", public: true })).fetchImpl });
    expect(await pub.checkHealth()).toMatchObject({ ok: false });
    const priv = new SupabaseStorageAdapter(cfg, { fetchImpl: mockFetch(() => json({ id: "thumbs", public: false })).fetchImpl });
    expect(await priv.checkHealth()).toMatchObject({ ok: true });
    expect(await priv.getUsage()).toMatchObject({ supported: false });
  });
});

describe("DBByte adapter (REST, not S3)", () => {
  const cfg = { apiKey: "dbk_test", bucket: "onfile" };

  it("uploads multipart, uses the server-generated key for later calls, downloads and deletes", async () => {
    const { calls, fetchImpl } = mockFetch(({ url, init }) => {
      if (url.endsWith("/storage/onfile/upload")) return json({ success: true, key: "1700-12-abc.webp", name: "12-abc.webp", size: IMG.length, mimeType: "image/webp", fileId: "f1" });
      if (url.includes("/download/")) return bytes(IMG);
      if (init.method === "DELETE") return json({ success: true });
      return json({}, 404);
    });
    const a = new DBByteAdapter(cfg, { fetchImpl });
    const up = await a.upload(input);
    expect(up.objectKey).toBe("1700-12-abc.webp");
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe("Bearer dbk_test");
    expect((calls[0].init.body as FormData).get("file")).toBeInstanceOf(Blob);
    expect((await a.downloadForMigration(up)).buffer.equals(IMG)).toBe(true);
    expect(calls[1].url).toBe("https://api.dbbyte.com/storage/onfile/download/1700-12-abc.webp");
    await a.delete(up);
    expect(calls[2].url).toBe("https://api.dbbyte.com/storage/onfile/delete/1700-12-abc.webp");
  });

  it("signs URLs through the documented sign endpoint, capped at 7 days", async () => {
    const { calls, fetchImpl } = mockFetch(() => json({ url: "https://cdn.dbbyte.com/x?sig=abc", expiresIn: 300 }));
    const a = new DBByteAdapter(cfg, { fetchImpl });
    const r = await a.getDeliveryUrl({ objectKey: "k.webp", deliveryMetadata: {} }, { expiresInSeconds: 300 });
    expect(calls[0].url).toBe("https://api.dbbyte.com/storage/onfile/sign/k.webp");
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ expiresIn: 300 });
    expect(r).toMatchObject({ supported: true, value: { url: "https://cdn.dbbyte.com/x?sig=abc", clientSafe: true } });
    await a.getDeliveryUrl({ objectKey: "k.webp", deliveryMetadata: {} }, { expiresInSeconds: 99_999_999 });
    expect(JSON.parse(calls[1].init.body as string)).toEqual({ expiresIn: 604800 });
  });

  it("returns explicit unsupported results for metadata and usage", async () => {
    const a = new DBByteAdapter(cfg);
    expect(await a.getMetadata()).toMatchObject({ supported: false });
    expect(await a.getUsage()).toMatchObject({ supported: false });
  });

  it("health: shallow uses /health only; deep also lists the bucket (one metered request)", async () => {
    const { calls, fetchImpl } = mockFetch(() => json({ status: "ok" }));
    const a = new DBByteAdapter(cfg, { fetchImpl });
    await a.checkHealth();
    expect(calls.map((c) => c.url)).toEqual(["https://api.dbbyte.com/health"]);
    await a.checkHealth({ deep: true });
    expect(calls.at(-1)!.url).toContain("/storage/onfile/list?limit=1");
    const degraded = new DBByteAdapter(cfg, { fetchImpl: mockFetch(() => json({ status: "degraded" })).fetchImpl });
    expect(await degraded.checkHealth()).toMatchObject({ ok: false });
  });

  it("distinguishes burst 429 (Retry-After) from plan quota 429 (no Retry-After)", async () => {
    const burst = new DBByteAdapter(cfg, { fetchImpl: mockFetch(() => json({ error: "slow down" }, 429, { "retry-after": "2" })).fetchImpl });
    expect(await burst.upload(input).catch((e) => e)).toMatchObject({ kind: "rate_limited", retryAfterMs: 2000 });
    const quota = new DBByteAdapter(cfg, { fetchImpl: mockFetch(() => json({ error: "quota" }, 429)).fetchImpl });
    expect(await quota.upload(input).catch((e) => e)).toMatchObject({ kind: "quota" });
    const auth = new DBByteAdapter(cfg, { fetchImpl: mockFetch(() => json({ error: "bad key" }, 401)).fetchImpl });
    expect(await auth.upload(input).catch((e) => e)).toMatchObject({ kind: "auth" });
  });
});

describe("error classification and retry policy", () => {
  it("classifies statuses", () => {
    const h = new Headers();
    expect(classifyHttpFailure(401, "", h).kind).toBe("auth");
    expect(classifyHttpFailure(403, "quota exceeded", h).kind).toBe("auth");
    expect(classifyHttpFailure(507, "", h).kind).toBe("quota");
    expect(classifyHttpFailure(413, "storage limit exceeded", h).kind).toBe("quota");
    expect(classifyHttpFailure(503, "", h).kind).toBe("server");
    expect(classifyHttpFailure(429, "", new Headers({ "retry-after": "3" })).retryAfterMs).toBe(3000);
    expect(classifyHttpFailure(400, "bad", h).kind).toBe("bad_request");
  });

  it("converts timeouts and network errors", async () => {
    const abort = async () => { const e = new Error("aborted"); e.name = "AbortError"; throw e; };
    await expect(providerFetch("http://x", {}, { fetchImpl: abort })).rejects.toMatchObject({ kind: "timeout" });
    await expect(providerFetch("http://x", {}, { fetchImpl: async () => { throw new Error("ECONNRESET"); } })).rejects.toMatchObject({ kind: "network" });
  });

  it("429: respects Retry-After and retries a limited number of times", async () => {
    const sleep = vi.fn(async (_ms: number) => { void _ms; });
    let n = 0;
    const result = await withRetry(async () => { if (++n < 3) throw new ProviderError("rate_limited", "429", 429, 1500); return "ok"; }, { maxAttempts: 3, sleep });
    expect(result).toBe("ok");
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([1500, 1500]);
    let calls = 0;
    await expect(withRetry(async () => { calls++; throw new ProviderError("rate_limited", "429", 429, 10); }, { maxAttempts: 3, sleep })).rejects.toMatchObject({ kind: "rate_limited" });
    expect(calls).toBe(3); // bounded, never infinite
  });

  it("429 with a very long Retry-After fails over instead of sleeping", async () => {
    const sleep = vi.fn(async (_ms: number) => { void _ms; });
    await expect(withRetry(async () => { throw new ProviderError("rate_limited", "429", 429, 60_000); }, { maxAttempts: 3, maxRetryAfterMs: 5000, sleep })).rejects.toBeDefined();
    expect(sleep).not.toHaveBeenCalled();
  });

  it("5xx / timeout use exponential backoff; 401/403/quota are never retried", async () => {
    const delays: number[] = [];
    const sleep = async (ms: number) => { delays.push(ms); };
    let n = 0;
    await expect(withRetry(async () => { n++; throw new ProviderError("server", "503", 503); }, { maxAttempts: 4, baseDelayMs: 100, maxDelayMs: 10_000, sleep })).rejects.toBeDefined();
    expect(n).toBe(4);
    expect(delays).toHaveLength(3);
    expect(delays[2]).toBeGreaterThan(delays[0]); // grows (with jitter bounds 50-100%, 100-200%, 200-400%)
    for (const kind of ["auth", "quota", "bad_request"] as const) {
      let c = 0;
      await expect(withRetry(async () => { c++; throw new ProviderError(kind, kind); }, { maxAttempts: 5, sleep })).rejects.toBeDefined();
      expect(c).toBe(1);
    }
  });
});
