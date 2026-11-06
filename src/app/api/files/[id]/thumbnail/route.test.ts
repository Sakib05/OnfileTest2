import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// Auth + service are mocked: these tests prove the ROUTE derives identity only
// from the verified session and rejects unauthenticated / spoofed requests.
const getSessionUser = vi.fn();
vi.mock("@/lib/auth", () => ({
  getSessionUser: (...a: unknown[]) => getSessionUser(...a),
  isSameOriginRequest: (req: Request) => {
    const o = req.headers.get("origin");
    return !o || new URL(o).host === req.headers.get("host");
  },
  unauthorized: () => new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }),
}));
const uploadThumbnail = vi.fn();
const removeThumbnail = vi.fn();
vi.mock("@/lib/thumbnails/service", () => ({
  uploadThumbnail: (...a: unknown[]) => uploadThumbnail(...a),
  removeThumbnail: (...a: unknown[]) => removeThumbnail(...a),
}));

import { POST, DELETE } from "./route";

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
function uploadReq(headers: Record<string, string> = {}, size = 100, type = "image/png") {
  const form = new FormData();
  form.append("file", new File([new Uint8Array(size)], "t.png", { type }));
  return new NextRequest("http://localhost/api/files/10/thumbnail", { method: "POST", body: form, headers: { host: "localhost", ...headers } });
}

beforeEach(() => {
  getSessionUser.mockReset();
  uploadThumbnail.mockReset();
  removeThumbnail.mockReset();
});

describe("POST /api/files/[id]/thumbnail", () => {
  it("401 without a session — service never called", async () => {
    getSessionUser.mockResolvedValue(null);
    const res = await POST(uploadReq(), ctx("10"));
    expect(res.status).toBe(401);
    expect(uploadThumbnail).not.toHaveBeenCalled();
  });

  it("uses the SESSION user id; spoofed telegram/creator ids in headers and form are ignored", async () => {
    getSessionUser.mockResolvedValue({ id: 7 });
    uploadThumbnail.mockResolvedValue({ ok: true, thumbnail: { url: "u", version: "v", width: 1, height: 1, sizeBytes: 1, mimeType: "image/webp" }, originalSizeBytes: 5, strategy: "x" });
    const req = uploadReq({ "x-telegram-id": "999", "x-user-id": "999", "x-creator-id": "999" });
    const res = await POST(req, ctx("10"));
    expect(res.status).toBe(200);
    expect(uploadThumbnail).toHaveBeenCalledTimes(1);
    expect(uploadThumbnail.mock.calls[0][0]).toMatchObject({ userId: 7, fileId: 10 });
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  it("propagates ownership failure from the service (another creator's file) as 404", async () => {
    getSessionUser.mockResolvedValue({ id: 7 });
    uploadThumbnail.mockResolvedValue({ ok: false, status: 404, code: "not_found", message: "File not found." });
    const res = await POST(uploadReq(), ctx("20"));
    expect(res.status).toBe(404);
  });

  it("rejects cross-origin requests (CSRF) with 403", async () => {
    getSessionUser.mockResolvedValue({ id: 7 });
    const res = await POST(uploadReq({ origin: "https://evil.example" }), ctx("10"));
    expect(res.status).toBe(403);
    expect(uploadThumbnail).not.toHaveBeenCalled();
  });

  it("413 for > 2 MB before any processing", async () => {
    getSessionUser.mockResolvedValue({ id: 7 });
    const res = await POST(uploadReq({}, 2 * 1024 * 1024 + 1), ctx("10"));
    expect(res.status).toBe(413);
    expect(uploadThumbnail).not.toHaveBeenCalled();
  });

  it("400 for non-numeric file ids and for a missing file field", async () => {
    getSessionUser.mockResolvedValue({ id: 7 });
    expect((await POST(uploadReq(), ctx("abc"))).status).toBe(400);
    const empty = new NextRequest("http://localhost/api/files/10/thumbnail", { method: "POST", body: new FormData(), headers: { host: "localhost" } });
    expect((await POST(empty, ctx("10"))).status).toBe(400);
  });

  it("forwards Retry-After on provider rate limiting", async () => {
    getSessionUser.mockResolvedValue({ id: 7 });
    uploadThumbnail.mockResolvedValue({ ok: false, status: 429, code: "rate_limited", message: "busy", retryAfter: 30 });
    const res = await POST(uploadReq(), ctx("10"));
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("30");
  });
});

describe("DELETE /api/files/[id]/thumbnail", () => {
  const delReq = () => new NextRequest("http://localhost/api/files/10/thumbnail", { method: "DELETE", headers: { host: "localhost" } });

  it("401 without a session", async () => {
    getSessionUser.mockResolvedValue(null);
    expect((await DELETE(delReq(), ctx("10"))).status).toBe(401);
    expect(removeThumbnail).not.toHaveBeenCalled();
  });

  it("passes the session user id to the service", async () => {
    getSessionUser.mockResolvedValue({ id: 7 });
    removeThumbnail.mockResolvedValue({ ok: true, removed: true });
    const res = await DELETE(delReq(), ctx("10"));
    expect(res.status).toBe(200);
    expect(removeThumbnail.mock.calls[0][0]).toEqual({ userId: 7, fileId: 10 });
  });

  it("404 when the service says the file is not the caller's", async () => {
    getSessionUser.mockResolvedValue({ id: 7 });
    removeThumbnail.mockResolvedValue({ ok: false, status: 404, code: "not_found", message: "File not found." });
    expect((await DELETE(delReq(), ctx("20"))).status).toBe(404);
  });
});
