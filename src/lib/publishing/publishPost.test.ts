import { describe, expect, it, vi } from "vitest";
import { publishPost, type PublishDeps, type PublishFileRecord } from "@/lib/publishing/publishPost";
import { validateDetails, validateMonetization, validatePublishPayload } from "@/lib/publishing/validation";

const channel = { id: 1, telegramChannelId: "-1001234567890", channelName: "Mine", channelUsername: null };

function makeDeps(over: Partial<PublishDeps> = {}) {
  const inserted: PublishFileRecord[] = [];
  const deps: PublishDeps = {
    listVerifiedChannels: vi.fn(async () => [channel]),
    playlistBelongsToUser: vi.fn(async () => true),
    resolvePublicChat: vi.fn(async () => ({ ok: false as const, reason: "unavailable" as const })),
    insertUnlessDuplicate: vi.fn(async (r: PublishFileRecord) => {
      if (inserted.some((i) => i.userId === r.userId && i.postKey === r.postKey)) return { status: "duplicate" as const };
      inserted.push(r);
      return { status: "created" as const, file: { id: inserted.length, title: r.title } };
    }),
    paidPublishingAvailable: () => false,
    ...over,
  };
  return { deps, inserted };
}

const good = {
  telegramMessageLink: "https://t.me/c/1234567890/125",
  title: "  My course ",
  description: "desc",
  category: "Education",
  fileType: "video",
  playlistId: null,
  password: "",
  monetization: "free",
  starsPrice: 0,
};

describe("publishPost — authorization", () => {
  it("publishes a free post from the connected channel", async () => {
    const { deps, inserted } = makeDeps();
    const out = await publishPost(deps, 42, good);
    expect(out.status).toBe(201);
    expect(inserted[0]).toMatchObject({
      userId: 42,
      title: "My course",
      telegramMessageLink: "https://t.me/c/1234567890/125",
      isPublished: true,
      starsPrice: 0,
    });
    expect(deps.listVerifiedChannels).toHaveBeenCalledWith(42);
  });

  it("refuses a post from another channel and writes nothing", async () => {
    const { deps, inserted } = makeDeps();
    const out = await publishPost(deps, 42, { ...good, telegramMessageLink: "https://t.me/c/9999999999/1" });
    expect(out).toMatchObject({ status: 403, body: { reason: "channel_mismatch" } });
    expect(inserted).toHaveLength(0);
  });

  it("ignores client-supplied owner / channel fields", async () => {
    const { deps, inserted } = makeDeps();
    const out = await publishPost(deps, 42, {
      ...good,
      telegramMessageLink: "https://t.me/c/9999999999/1",
      userId: 1,
      channelId: 1,
      telegramChannelId: "-1009999999999",
      verified: true,
    });
    expect(out.status).toBe(403);
    expect(inserted).toHaveLength(0);
  });

  it("returns channel_required when the creator has no verified channel", async () => {
    const { deps } = makeDeps({ listVerifiedChannels: async () => [] });
    expect(await publishPost(deps, 42, good)).toMatchObject({ status: 403, body: { reason: "channel_required" } });
  });

  it("returns 503 (never accepts) when a public link can't be verified", async () => {
    const { deps, inserted } = makeDeps();
    const out = await publishPost(deps, 42, { ...good, telegramMessageLink: "https://t.me/somename/5" });
    expect(out).toMatchObject({ status: 503, body: { reason: "verification_unavailable" } });
    expect(inserted).toHaveLength(0);
  });

  it("rejects a playlist that does not belong to the creator", async () => {
    const { deps, inserted } = makeDeps({ playlistBelongsToUser: vi.fn(async () => false) });
    const out = await publishPost(deps, 42, { ...good, playlistId: 99 });
    expect(out).toMatchObject({ status: 400, body: { fieldErrors: { playlistId: expect.any(String) } } });
    expect(deps.playlistBelongsToUser).toHaveBeenCalledWith(99, 42);
    expect(inserted).toHaveLength(0);
  });
});

describe("publishPost — paid content gate", () => {
  const paid = { ...good, monetization: "paid", starsPrice: 50 };

  it("refuses to publish paid content while no payment gate exists", async () => {
    const { deps, inserted } = makeDeps();
    const out = await publishPost(deps, 42, paid);
    expect(out).toMatchObject({ status: 409, body: { reason: "paid_publishing_unavailable" } });
    expect(inserted).toHaveLength(0);
  });

  it("saves paid content only as an UNPUBLISHED draft", async () => {
    const { deps, inserted } = makeDeps();
    const out = await publishPost(deps, 42, { ...paid, mode: "draft" });
    expect(out).toMatchObject({ status: 201, body: { published: false } });
    expect(inserted[0]).toMatchObject({ isPublished: false, starsPrice: 50 });
  });

  it("publishes paid content only when the payment gate is available", async () => {
    const { deps, inserted } = makeDeps({ paidPublishingAvailable: () => true });
    expect((await publishPost(deps, 42, paid)).status).toBe(201);
    expect(inserted[0]).toMatchObject({ isPublished: true, starsPrice: 50 });
  });

  it("treats a legacy payload with only starsPrice > 0 as paid", async () => {
    const { deps } = makeDeps();
    const { monetization: _m, ...legacy } = good;
    void _m;
    expect((await publishPost(deps, 42, { ...legacy, starsPrice: 10 })).status).toBe(409);
  });

  it("forces price to 0 for free content even if a price is sent", async () => {
    const { deps, inserted } = makeDeps();
    await publishPost(deps, 42, { ...good, monetization: "free", starsPrice: 500 });
    expect(inserted[0].starsPrice).toBe(0);
  });
});

describe("publishPost — duplicates and validation", () => {
  it("prevents duplicate publishing of the same post, across link variants", async () => {
    const { deps, inserted } = makeDeps();
    expect((await publishPost(deps, 42, good)).status).toBe(201);
    const again = await publishPost(deps, 42, { ...good, telegramMessageLink: "t.me/c/1234567890/125?single" });
    expect(again).toMatchObject({ status: 409, body: { reason: "duplicate_post" } });
    expect(inserted).toHaveLength(1);
  });

  it("handles concurrent double-submits with a single insert", async () => {
    const { deps, inserted } = makeDeps();
    const results = await Promise.all([publishPost(deps, 42, good), publishPost(deps, 42, good)]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(inserted).toHaveLength(1);
  });

  it("returns field errors for invalid details and never touches Telegram or the DB", async () => {
    const { deps } = makeDeps();
    const out = await publishPost(deps, 42, { ...good, title: "   ", category: "Nope", fileType: "exe" });
    expect(out).toMatchObject({ status: 400, body: { reason: "validation_failed" } });
    expect(deps.listVerifiedChannels).not.toHaveBeenCalled();
    expect(deps.insertUnlessDuplicate).not.toHaveBeenCalled();
  });

  it("rejects non-object bodies", async () => {
    const { deps } = makeDeps();
    expect((await publishPost(deps, 42, null)).status).toBe(400);
    expect((await publishPost(deps, 42, [])).status).toBe(400);
  });
});

describe("validators", () => {
  it("validates title / description / category / fileType", () => {
    expect(validateDetails({ title: "", description: "", category: "", fileType: "video" }).title).toBeTruthy();
    expect(validateDetails({ title: "a".repeat(101), description: "", category: "", fileType: "video" }).title).toBeTruthy();
    expect(validateDetails({ title: "ok", description: "x".repeat(1001), category: "", fileType: "video" }).description).toBeTruthy();
    expect(validateDetails({ title: "ok", description: "", category: "Music", fileType: "audio" })).toEqual({});
  });
  it("validates Stars prices", () => {
    expect(validateMonetization("free", "")).toEqual({});
    for (const bad of ["", "0", "-5", "1.5", "abc", "10001", "1e3"]) {
      expect(validateMonetization("paid", bad).starsPrice).toBeTruthy();
    }
    expect(validateMonetization("paid", "1")).toEqual({});
    expect(validateMonetization("paid", 10000)).toEqual({});
  });
  it("normalizes a valid payload", () => {
    const r = validatePublishPayload({ ...good, playlistId: "12", monetization: "paid", starsPrice: "25", mode: "draft" });
    expect(r.ok && r.value).toMatchObject({ playlistId: 12, starsPrice: 25, mode: "draft", monetization: "paid" });
  });
});
