import { describe, expect, it, vi } from "vitest";
import { getUnlockMethods, previewAspectRatio, requestUnlock, safeExternalLink, unlockErrorMessage } from "./download";

describe("getUnlockMethods", () => {
  it("offers the ad for plain files", () => {
    expect(getUnlockMethods({})).toEqual(["ad"]);
  });
  it("adds Stars when the file has a price", () => {
    expect(getUnlockMethods({ starsPrice: 50 })).toEqual(["ad", "stars"]);
  });
  it("offers only the password for protected files (an ad alone can never unlock them)", () => {
    expect(getUnlockMethods({ hasPassword: true })).toEqual(["password"]);
    expect(getUnlockMethods({ hasPassword: true, starsPrice: 10 })).toEqual(["password", "stars"]);
  });
});

describe("requestUnlock (server decides)", () => {
  const res = (status: number, body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status }));

  it("POSTs the password to the slug endpoint and returns the server's Telegram link on success", async () => {
    const f = vi.fn(() => res(200, { success: true, telegramMessageLink: "https://t.me/c/1/2" }));
    const r = await requestUnlock("my slug", "pw", f as unknown as typeof fetch);
    expect(r).toEqual({ ok: true, telegramMessageLink: "https://t.me/c/1/2" });
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/link/my%20slug");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ password: "pw" });
  });

  it("never reports success when the server refuses", async () => {
    const r = await requestUnlock("s", "bad", (() => res(403, { error: "Wrong password" })) as unknown as typeof fetch);
    expect(r).toEqual({ ok: false, status: 403, message: "Incorrect password. Please try again." });
  });

  it("surfaces rate limiting and network failures", async () => {
    const limited = await requestUnlock("s", "", (() => res(429, { error: "Too many attempts. Please try again shortly." })) as unknown as typeof fetch);
    expect(limited).toMatchObject({ ok: false, status: 429 });
    const down = await requestUnlock("s", "", (() => Promise.reject(new Error("offline"))) as unknown as typeof fetch);
    expect(down).toMatchObject({ ok: false, status: 0 });
    expect(unlockErrorMessage(404)).toMatch(/no longer available/);
  });
});

describe("safeExternalLink / previewAspectRatio", () => {
  it("allows only http(s) links", () => {
    expect(safeExternalLink("https://t.me/c/123/4")).toBe("https://t.me/c/123/4");
    expect(safeExternalLink("javascript:alert(1)")).toBeNull();
    expect(safeExternalLink("data:text/html,x")).toBeNull();
    expect(safeExternalLink("nonsense")).toBeNull();
    expect(safeExternalLink(null)).toBeNull();
  });
  it("uses the thumbnail ratio, clamped, with a 16:9 fallback", () => {
    expect(previewAspectRatio(null, null)).toBeCloseTo(16 / 9);
    expect(previewAspectRatio(1280, 720)).toBeCloseTo(16 / 9);
    expect(previewAspectRatio(600, 900)).toBe(1);
    expect(previewAspectRatio(3000, 500)).toBe(1.91);
  });
});
