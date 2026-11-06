import { describe, expect, it, vi } from "vitest";
import { DbbyteStorage } from "./dbbyte";
import { StorageError } from "./provider";
import { buildThumbnailUrl, getDbbyteConfig, getUsageThresholds } from "./config";

const cfg = { apiKey: "dbk_test_SECRET", bucket: "onfile-thumbs", cdnBaseUrl: "https://cdn.example/tok", apiBaseUrl: "https://api.example" };
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
const bytes = new Uint8Array([1, 2, 3, 4]);

function client(responses: (Response | Error)[], extra = {}) {
  const calls: { url: string; init: RequestInit }[] = [];
  const sleeps: number[] = [];
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const next = responses.shift();
    if (!next) throw new Error("unexpected extra request");
    if (next instanceof Error) throw next;
    return next;
  }) as unknown as typeof fetch;
  const storage = new DbbyteStorage(cfg, { fetchImpl, backoffMs: [1, 1], sleep: async (ms) => void sleeps.push(ms), ...extra });
  return { storage, calls, sleeps };
}

describe("DbbyteStorage.put", () => {
  it("uploads multipart to /storage/{bucket}/upload with bearer auth and verifies the response", async () => {
    const { storage, calls } = client([json({ success: true, key: "123_k", name: "thumb-1.webp", size: 4, mimeType: "image/webp", fileId: "f" })]);
    const res = await storage.put("thumb-1.webp", bytes, "image/webp");
    expect(res.key).toBe("thumb-1.webp");
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.example/storage/onfile-thumbs/upload");
    expect(calls[0].init.method).toBe("POST");
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe("Bearer dbk_test_SECRET");
    const file = (calls[0].init.body as FormData).get("file") as File;
    expect(file.name).toBe("thumb-1.webp");
    expect(file.size).toBe(4);
  });

  it("rejects a response whose size does not match what was sent", async () => {
    const { storage } = client([json({ success: true, name: "x.webp", size: 999 })]);
    await expect(storage.put("x.webp", bytes, "image/webp")).rejects.toMatchObject({ code: "unverified" });
  });

  it("retries 5xx with backoff, then enables overwrite so no duplicate object is created", async () => {
    const { storage, calls, sleeps } = client([json({ error: "boom" }, 502), json({ success: true, name: "a.webp", size: 4 })]);
    await storage.put("a.webp", bytes, "image/webp");
    expect(calls).toHaveLength(2);
    expect(calls[0].url).not.toContain("overwrite");
    expect(calls[1].url).toContain("overwrite=true");
    expect(sleeps).toEqual([1]);
  });

  it("gives up after bounded retries on persistent 5xx", async () => {
    const { storage, calls } = client([json({ error: "x" }, 500), json({ error: "x" }, 500), json({ error: "x" }, 500)]);
    await expect(storage.put("a.webp", bytes, "image/webp")).rejects.toMatchObject({ code: "server", status: 500 });
    expect(calls).toHaveLength(3);
  });

  it("retries network errors and timeouts", async () => {
    const abort = Object.assign(new Error("aborted"), { name: "AbortError" });
    const { storage, calls } = client([new TypeError("fetch failed"), abort, json({ success: true, name: "a.webp", size: 4 })]);
    await storage.put("a.webp", bytes, "image/webp");
    expect(calls).toHaveLength(3);
  });

  it("429 WITH Retry-After: waits once if short, then succeeds", async () => {
    const { storage, calls, sleeps } = client([json({ error: "slow down" }, 429, { "Retry-After": "2" }), json({ success: true, name: "a.webp", size: 4 })]);
    await storage.put("a.webp", bytes, "image/webp");
    expect(calls).toHaveLength(2);
    expect(sleeps).toEqual([2000]);
  });

  it("429 with a LONG Retry-After is surfaced (not retried) with retryAfter", async () => {
    const { storage, calls } = client([json({ error: "slow down" }, 429, { "Retry-After": "120" })]);
    await expect(storage.put("a.webp", bytes, "image/webp")).rejects.toMatchObject({ code: "rate_limited", retryAfter: 120 });
    expect(calls).toHaveLength(1);
  });

  it("429 WITHOUT Retry-After is a quota error and is never retried", async () => {
    const { storage, calls } = client([json({ error: "quota" }, 429)]);
    await expect(storage.put("a.webp", bytes, "image/webp")).rejects.toMatchObject({ code: "quota_exceeded" });
    expect(calls).toHaveLength(1);
  });

  it("maps 401/403/413/409 without retrying", async () => {
    for (const [status, code] of [[401, "auth"], [403, "auth"], [413, "too_large"], [409, "conflict"]] as const) {
      const { storage, calls } = client([json({ error: "e" }, status)]);
      await expect(storage.put("a.webp", bytes, "image/webp")).rejects.toMatchObject({ code });
      expect(calls).toHaveLength(1);
    }
  });

  it("never leaks the API key in error messages", async () => {
    const { storage } = client([json({ error: "Invalid key" }, 401)]);
    const err = (await storage.put("a.webp", bytes, "image/webp").catch((e) => e)) as StorageError;
    expect(JSON.stringify({ m: err.message, c: err.code })).not.toContain("SECRET");
  });
});

describe("DbbyteStorage.delete", () => {
  it("DELETEs /storage/{bucket}/delete/{name}", async () => {
    const { storage, calls } = client([json({ success: true })]);
    await storage.delete("thumb-1.webp");
    expect(calls[0].url).toBe("https://api.example/storage/onfile-thumbs/delete/thumb-1.webp");
    expect(calls[0].init.method).toBe("DELETE");
  });
  it("treats 404 as already deleted", async () => {
    const { storage } = client([json({ error: "nf" }, 404)]);
    await expect(storage.delete("gone.webp")).resolves.toBeUndefined();
  });
  it("surfaces other failures", async () => {
    const { storage } = client([json({ error: "x" }, 403)]);
    await expect(storage.delete("a.webp")).rejects.toMatchObject({ code: "auth" });
  });
});

describe("config", () => {
  it("is null unless all three required vars are set", () => {
    expect(getDbbyteConfig({} as NodeJS.ProcessEnv)).toBeNull();
    expect(getDbbyteConfig({ DBBYTE_API_KEY: "k", DBBYTE_BUCKET: "b" } as unknown as NodeJS.ProcessEnv)).toBeNull();
  });
  it("builds the documented CDN URL: {base}/{bucket}/{file}", () => {
    const env = { DBBYTE_API_KEY: "k", DBBYTE_BUCKET: "onfile-thumbs", DBBYTE_CDN_BASE_URL: "https://cdn.dbbyte.com/pubtoken/" } as unknown as NodeJS.ProcessEnv;
    expect(buildThumbnailUrl("thumb-1-2-abc.webp", env)).toBe("https://cdn.dbbyte.com/pubtoken/onfile-thumbs/thumb-1-2-abc.webp");
    expect(buildThumbnailUrl("x.webp", {} as NodeJS.ProcessEnv)).toBeNull();
  });
  it("thresholds default to 70/80/90 and stay ordered", () => {
    expect(getUsageThresholds({} as NodeJS.ProcessEnv)).toEqual({ warn: 70, high: 80, block: 90 });
    expect(getUsageThresholds({ THUMB_WARN_PCT: "85", THUMB_HIGH_PCT: "60", THUMB_BLOCK_PCT: "50" } as unknown as NodeJS.ProcessEnv)).toEqual({ warn: 85, high: 85, block: 85 });
  });
});
