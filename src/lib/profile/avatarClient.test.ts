// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fixture, fixtureFile } from "@/test/avatarFixtures";
import { AvatarError } from "./avatarErrors";
import { precheckAvatar, removeAvatar, uploadAvatar } from "./avatarClient";

const webp = () => new File([new Uint8Array(fixture("avatar-512.webp"))], "avatar.webp", { type: "image/webp" });
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const failure = async (p: Promise<unknown>) => {
  try {
    await p;
    return null;
  } catch (e) {
    return e as AvatarError;
  }
};

describe("precheckAvatar (before the cropper opens)", () => {
  it("lets JPEG/PNG/WebP and a missing MIME type through", () => {
    expect(precheckAvatar(fixtureFile("landscape-1200x800.jpg", "image/jpeg"))).toBeNull();
    expect(precheckAvatar(fixtureFile("portrait-800x1200.png", "image/png"))).toBeNull();
    expect(precheckAvatar(fixtureFile("square-1000.webp", "image/webp"))).toBeNull();
    expect(precheckAvatar(fixtureFile("landscape-1200x800.jpg", ""))).toBeNull();
  });
  it("names the problem for HEIC, GIF/PDF, empty and oversize files", () => {
    expect(precheckAvatar(fixtureFile("fake-photo.heic", "image/heic"))?.kind).toBe("heic_unsupported");
    expect(precheckAvatar(fixtureFile("fake-photo.heic", ""))?.kind).toBe("heic_unsupported"); // by extension
    expect(precheckAvatar(fixtureFile("fake.gif", "image/gif"))?.kind).toBe("unsupported_format");
    expect(precheckAvatar(new File(["x"], "a.pdf", { type: "application/pdf" }))?.kind).toBe("unsupported_format");
    expect(precheckAvatar(fixtureFile("empty.jpg", "image/jpeg"))?.kind).toBe("empty");
    const big = fixtureFile("landscape-1200x800.jpg", "image/jpeg");
    Object.defineProperty(big, "size", { value: 21 * 1024 * 1024 });
    expect(precheckAvatar(big)?.kind).toBe("too_large");
  });
});

describe("uploadAvatar", () => {
  it("POSTs multipart form-data with field 'file' and NO manual Content-Type header", async () => {
    fetchMock.mockResolvedValueOnce(json(201, { user: { id: 1 } }));
    const user = await uploadAvatar(webp());
    expect(user).toEqual({ id: 1 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/user/avatar");
    expect(init.method).toBe("POST");
    expect(init.headers).toBeUndefined(); // the browser must add the multipart boundary itself
    expect(init.body).toBeInstanceOf(FormData);
    const sent = (init.body as FormData).get("file") as File;
    expect(sent).toBeInstanceOf(File);
    expect(sent.type).toBe("image/webp");
    expect(sent.size).toBeGreaterThan(0);
  });

  it("never sends a malformed / empty / wrong blob (validated first, no request made)", async () => {
    for (const bad of [new File([], "a.webp", { type: "image/webp" }), new File(["not an image"], "a.jpg", { type: "image/jpeg" }), fixtureFile("portrait-800x1200.png", "image/png")]) {
      expect((await failure(uploadAvatar(bad)))?.kind).toBe("processing_failed");
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("network failure → 'network' (not a corrupt-image message)", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const err = await failure(uploadAvatar(webp()));
    expect(err?.kind).toBe("network");
    expect(err?.message).toMatch(/connection/i);
  });

  it.each([
    [400, "corrupt", "server_validation"],
    [415, "unsupported_type", "server_validation"],
    [400, "animated", "server_validation"],
    [413, "too_large", "too_large"],
    [429, "rate_limited", "rate_limited"],
    [502, "storage_error", "storage_failed"],
    [503, "storage_unavailable", "storage_failed"],
    [503, "uploads_paused", "storage_failed"],
    [500, "db_write_failed", "upload_failed"],
  ])("server %i/%s → %s", async (status, code, kind) => {
    fetchMock.mockResolvedValueOnce(json(status, { error: "raw server text", code }));
    const err = await failure(uploadAvatar(webp()));
    expect(err?.kind).toBe(kind);
    expect(err?.message).not.toMatch(/can't be read/i);
  });

  it("does not leak internal server detail to users", async () => {
    fetchMock.mockResolvedValueOnce(json(500, { error: "Internal server error at /srv/app/db.ts:42" }));
    const err = await failure(uploadAvatar(webp()));
    expect(err?.message).not.toMatch(/srv|db\.ts/);
  });

  it("storage failure message tells the user the current picture is unchanged", async () => {
    fetchMock.mockResolvedValueOnce(json(502, { error: "x", code: "storage_error" }));
    expect((await failure(uploadAvatar(webp())))?.message).toMatch(/unchanged/i);
  });

  it("a second call while one is in flight shares the first request (no duplicate submission)", async () => {
    let resolve!: (r: Response) => void;
    fetchMock.mockReturnValueOnce(new Promise<Response>((r) => (resolve = r)));
    const a = uploadAvatar(webp());
    const b = uploadAvatar(webp());
    await new Promise((r) => setTimeout(r, 10));
    resolve(json(201, { user: { id: 2 } }));
    expect(await a).toEqual({ id: 2 });
    expect(await b).toEqual({ id: 2 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // and the gate re-opens afterwards
    fetchMock.mockResolvedValueOnce(json(201, { user: { id: 3 } }));
    expect(await uploadAvatar(webp())).toEqual({ id: 3 });
  });
});

describe("removeAvatar", () => {
  it("DELETEs and returns the refreshed user", async () => {
    fetchMock.mockResolvedValueOnce(json(200, { removed: true, user: { id: 1 } }));
    expect(await removeAvatar()).toEqual({ id: 1 });
    expect(fetchMock.mock.calls[0][1]).toEqual({ method: "DELETE" });
  });
  it("reports network failure", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("offline"));
    expect((await failure(removeAvatar()))?.kind).toBe("network");
  });
});
