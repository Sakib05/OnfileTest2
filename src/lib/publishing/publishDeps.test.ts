import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { channels, files, playlists, users } from "@/db/schema";
import { dbPublishDeps } from "@/lib/publishing/publishDeps";
import { publishPost } from "@/lib/publishing/publishPost";

// SIMULATED Telegram: these DB tests exercise persistence/ownership rules, not Telegram. The existence
// check is stubbed to "exists" here; real-Telegram behaviour is covered by checkChannelPostExists tests.
const simulatedDeps = { ...dbPublishDeps, checkPostExists: async () => ({ ok: true as const }) };

// Real-Postgres integration test of the publish persistence layer. Uses its own
// throw-away users/channels and removes everything it creates.
const TG_A = "990000001";
const TG_B = "990000002";
let userA = 0;
let userB = 0;
let playlistB = 0;

beforeAll(async () => {
  const [a] = await db.insert(users).values({ telegramId: TG_A, username: "pub_test_a" }).returning();
  const [b] = await db.insert(users).values({ telegramId: TG_B, username: "pub_test_b" }).returning();
  userA = a.id;
  userB = b.id;
  await db.insert(channels).values([
    { userId: userA, telegramChannelId: "-1009900000011", channelName: "A chan", status: "verified", isVerified: true },
    { userId: userB, telegramChannelId: "-1009900000022", channelName: "B chan", status: "verified", isVerified: true },
  ]);
  const [pl] = await db.insert(playlists).values({ userId: userB, title: "B list" }).returning();
  playlistB = pl.id;
});

afterAll(async () => {
  const ids = [userA, userB].filter(Boolean);
  if (!ids.length) return;
  await db.delete(files).where(inArray(files.userId, ids));
  await db.delete(playlists).where(inArray(playlists.userId, ids));
  await db.delete(users).where(inArray(users.id, ids)); // channels cascade
});

const body = (link: string, extra: Record<string, unknown> = {}) => ({
  telegramMessageLink: link,
  title: "Integration post",
  description: "",
  category: "Other",
  fileType: "document",
  monetization: "free",
  ...extra,
});

describe("publishPost against Postgres", () => {
  it("publishes once, and concurrent double-submits create exactly one row", async () => {
    const link = "https://t.me/c/9900000011/501";
    const results = await Promise.all([
      publishPost(simulatedDeps, userA, body(link), "5550001"),
      publishPost(simulatedDeps, userA, body(link), "5550001"),
      publishPost(simulatedDeps, userA, body(link + "?single"), "5550001"),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409]);
    const rows = await db.select().from(files).where(eq(files.userId, userA));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      telegramMessageLink: link,
      isPublished: true,
      starsPrice: 0,
    });
    expect(rows[0].smartLinkSlug).toBeTruthy();
  });

  it("refuses another creator's channel link and a different channel's post", async () => {
    const wrong = await publishPost(simulatedDeps, userA, body("https://t.me/c/9900000022/1"), "5550001");
    expect(wrong).toMatchObject({ status: 403, body: { reason: "channel_mismatch" } });
  });

  it("refuses to attach another creator's playlist", async () => {
    const out = await publishPost(simulatedDeps, userA, body("https://t.me/c/9900000011/502", { playlistId: playlistB }), "5550001");
    expect(out.status).toBe(400);
  });

  it("stores a paid post only as an unpublished draft and refuses to publish it", async () => {
    const paid = { monetization: "paid", starsPrice: 25 };
    const refused = await publishPost(simulatedDeps, userA, body("https://t.me/c/9900000011/503", paid), "5550001");
    expect(refused).toMatchObject({ status: 409, body: { reason: "paid_publishing_unavailable" } });
    const saved = await publishPost(simulatedDeps, userA, body("https://t.me/c/9900000011/503", { ...paid, mode: "draft" }), "5550001");
    expect(saved.status).toBe(201);
    const [row] = await db.select().from(files).where(eq(files.telegramMessageLink, "https://t.me/c/9900000011/503"));
    expect(row).toMatchObject({ isPublished: false, starsPrice: 25 });
  });

  it("returns channel_required for a creator without a verified channel", async () => {
    await db.update(channels).set({ status: "disconnected", isVerified: false }).where(eq(channels.userId, userB));
    const out = await publishPost(simulatedDeps, userB, body("https://t.me/c/9900000022/1"), "5550001");
    expect(out).toMatchObject({ status: 403, body: { reason: "channel_required" } });
  });
});
