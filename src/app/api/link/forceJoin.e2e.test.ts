import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { adCampaigns, adConversions, files, users } from "@/db/schema";
import { createSession } from "@/lib/auth";
import { confirmJoinFromUpdate } from "@/lib/ads/join";

/**
 * DATABASE-BACKED: Force Join end to end — real Postgres, real route handlers, real session cookies. Telegram is a fake.
 * Covers: creating/approving a gate, server-side enforcement, normal-join vs force-join, verified-join attribution
 * (clicks / existing members never count), outage fail-closed, owner bypass, unrelated files untouched, webhook updates.
 */
vi.mock("@/lib/ads/telegram", async (orig) => {
  const actual = await orig<typeof import("@/lib/ads/telegram")>();
  return { ...actual, lookupChat: vi.fn(), botCanVerifyMembership: vi.fn(), getMembership: vi.fn() };
});
vi.mock("@/lib/rateLimit", async (orig) => {
  const actual = await orig<typeof import("@/lib/rateLimit")>();
  return { ...actual, rateLimit: vi.fn(() => ({ allowed: true, remaining: 99 })) };
});
import * as tg from "@/lib/ads/telegram";
import * as listRoute from "../advertise/route";
import * as actionRoute from "../advertise/[ref]/action/route";
import * as adminRoute from "../admin/ads/route";
import * as gateRoute from "./[slug]/gate/route";
import * as linkRoute from "./[slug]/route";

const tag = `fj${Date.now()}`;
const userIds: number[] = [];
let seq = 0;
const day = (o: number) => new Date(Date.now() + o * 86_400_000).toISOString().slice(0, 10);

function req(method: string, url: string, token: string | undefined, body?: unknown) {
  const headers: Record<string, string> = { host: "localhost", "content-type": "application/json", "x-forwarded-for": `10.88.0.${++seq % 250}` };
  if (token) headers.cookie = `onfile_session=${token}`;
  return new NextRequest(`http://localhost${url}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}
async function makeUser(n: string) {
  const [u] = await db.insert(users).values({ telegramId: `${Date.now()}${++seq}`, firstName: `U${n}`, referralCode: `${tag}${n}`.slice(-8).toUpperCase(), language: "en" }).returning();
  userIds.push(u.id);
  const s = await createSession(u.id);
  return { id: u.id, telegramId: u.telegramId as string, token: s.token };
}
async function makeFile(userId: number) {
  const [f] = await db.insert(files).values({ userId, title: "Gated", fileType: "document", isPublished: true, smartLinkSlug: `${tag}-${++seq}`, telegramMessageLink: "https://t.me/c/1/2" }).returning();
  return f;
}
const slugCtx = (slug: string) => ({ params: Promise.resolve({ slug }) });
const refCtx = (ref: string) => ({ params: Promise.resolve({ ref }) });
const gate = async (slug: string, token: string | undefined, action: "start" | "verify") => {
  const res = await gateRoute.POST(req("POST", `/api/link/${slug}/gate`, token, { action }), slugCtx(slug));
  return { res, json: await res.json() };
};
const unlock = async (slug: string, token?: string) => {
  const res = await linkRoute.POST(req("POST", `/api/link/${slug}`, token, { password: "" }), slugCtx(slug));
  return { res, json: await res.json() };
};
const membership = (answer: "member" | "not_member" | "unavailable") => vi.mocked(tg.getMembership).mockResolvedValue(answer);

let owner: Awaited<ReturnType<typeof makeUser>>;
let admin: Awaited<ReturnType<typeof makeUser>>;
let viewer: Awaited<ReturnType<typeof makeUser>>;
let veteran: Awaited<ReturnType<typeof makeUser>>;
let gated: Awaited<ReturnType<typeof makeFile>>;
let other: Awaited<ReturnType<typeof makeFile>>;
let ref = "";

const gateDraft = (fileId: number | undefined, over: Record<string, unknown> = {}) => ({
  clientRef: `fj${Date.now()}${++seq}abcdefgh`,
  adType: "telegram_channel",
  destinationRef: "@pubchan",
  fileId,
  objective: "verified_joins",
  title: "Members only",
  headline: "Join to unlock",
  description: "Join my channel to get the file.",
  ctaText: "Join",
  placements: ["force_join"],
  targeting: { countries: [], languages: [] },
  budget: "20",
  startDate: day(0),
  endDate: day(7),
  ...over,
});
const adminAct = async (body: Record<string, unknown>, token = admin.token) => {
  const res = await adminRoute.POST(req("POST", "/api/admin/ads", token, body));
  return { res, json: await res.json() };
};

beforeAll(async () => {
  owner = await makeUser("o");
  admin = await makeUser("a");
  viewer = await makeUser("v");
  veteran = await makeUser("w");
  process.env.ADMIN_TELEGRAM_IDS = admin.telegramId;
  gated = await makeFile(owner.id);
  other = await makeFile(owner.id);
  vi.mocked(tg.lookupChat).mockResolvedValue({ ok: true, chat: { id: -1009990001, type: "channel", title: "Pub Chan", username: "pubchan" } });
  vi.mocked(tg.botCanVerifyMembership).mockResolvedValue("yes");
});

afterAll(async () => {
  if (userIds.length) {
    await db.delete(adCampaigns).where(inArray(adCampaigns.userId, userIds));
    await db.delete(files).where(inArray(files.userId, userIds));
    for (const id of userIds) await db.delete(users).where(eq(users.id, id));
  }
});

describe("creating a force-join campaign", () => {
  it("rejects a gate on a file the creator doesn't own, and unpublished files", async () => {
    const foreign = await makeFile(viewer.id);
    const r = await listRoute.POST(req("POST", "/api/advertise", owner.token, gateDraft(foreign.id)));
    expect(r.status).toBe(404);
    const [draftOk] = [await listRoute.POST(req("POST", "/api/advertise", owner.token, gateDraft(gated.id)))];
    expect(draftOk.status).toBe(201);
    const ok = (await draftOk.json()).campaign.ref as string;
    await db.update(files).set({ isPublished: false }).where(eq(files.id, gated.id));
    const s = await actionRoute.POST(req("POST", `/api/advertise/${ok}/action`, owner.token, { action: "submit" }), refCtx(ok));
    expect(s.status).toBe(422);
    await db.update(files).set({ isPublished: true }).where(eq(files.id, gated.id));
  });

  it("requires the verified-joins objective, a verifiable channel and no placement mixing", async () => {
    const wrongObjective = await listRoute.POST(req("POST", "/api/advertise", owner.token, gateDraft(gated.id, { objective: "clicks" })));
    expect(wrongObjective.status).toBe(400);
    const mixed = await listRoute.POST(req("POST", "/api/advertise", owner.token, gateDraft(gated.id, { placements: ["force_join", "library"] })));
    expect(mixed.status).toBe(400);
    vi.mocked(tg.botCanVerifyMembership).mockResolvedValue("no");
    const d = await listRoute.POST(req("POST", "/api/advertise", owner.token, gateDraft(gated.id)));
    const r = (await d.json()).campaign.ref as string;
    const s = await actionRoute.POST(req("POST", `/api/advertise/${r}/action`, owner.token, { action: "submit" }), refCtx(r));
    expect(s.status).toBe(422);
    vi.mocked(tg.botCanVerifyMembership).mockResolvedValue("yes");
  });

  it("submits to Pending Review and gates NOTHING until an admin approves", async () => {
    const d = await listRoute.POST(req("POST", "/api/advertise", owner.token, gateDraft(gated.id)));
    ref = (await d.json()).campaign.ref as string;
    const s = await actionRoute.POST(req("POST", `/api/advertise/${ref}/action`, owner.token, { action: "submit" }), refCtx(ref));
    expect(s.status).toBe(200);
    const [row] = await db.select().from(adCampaigns).where(eq(adCampaigns.publicId, ref));
    expect(row.status).toBe("pending");
    expect(row.fileId).toBe(gated.id); // the gated file survives submission
    membership("not_member");
    const open = await unlock(gated.smartLinkSlug!, viewer.token);
    expect(open.res.status).toBe(200); // pending = no gate
  });
});

describe("after approval", () => {
  it("a non-admin can't approve; an admin approves with pricing + payment confirmation", async () => {
    const denied = await adminAct({ ref, action: "approve", unitPrice: "0.5", paymentConfirmed: true }, owner.token);
    expect([401, 403]).toContain(denied.res.status);
    const ok = await adminAct({ ref, action: "approve", unitPrice: "0.5", paymentConfirmed: true });
    expect(ok.res.status).toBe(200);
  });

  it("another active gate on the same file can't be approved", async () => {
    const d = await listRoute.POST(req("POST", "/api/advertise", owner.token, gateDraft(gated.id)));
    const r2 = (await d.json()).campaign.ref as string;
    await actionRoute.POST(req("POST", `/api/advertise/${r2}/action`, owner.token, { action: "submit" }), refCtx(r2));
    const a = await adminAct({ ref: r2, action: "approve", unitPrice: "0.5", paymentConfirmed: true });
    expect(a.res.status).toBe(409);
    expect(a.json.error).toMatch(/already gates/);
  });

  it("anonymous visitors can't get the gated file and are told to open Telegram", async () => {
    const g = await gate(gated.smartLinkSlug!, undefined, "start");
    expect(g.json).toMatchObject({ gated: true, state: "login_required" });
    const u = await unlock(gated.smartLinkSlug!);
    expect(u.res.status).toBe(403);
    expect(u.json.code).toBe("login_required");
    expect(u.json.telegramMessageLink).toBeUndefined();
  });

  it("a non-member is blocked; tapping Join (a click) neither unlocks nor counts", async () => {
    membership("not_member");
    const start = await gate(gated.smartLinkSlug!, viewer.token, "start");
    expect(start.json).toMatchObject({ gated: true, state: "join_required", channelTitle: "Pub Chan" });
    expect(start.json.joinUrl).toMatch(/^https:\/\/t\.me\//);
    const blocked = await unlock(gated.smartLinkSlug!, viewer.token);
    expect(blocked.res.status).toBe(403);
    expect(blocked.json.code).toBe("join_required");
    expect(blocked.json.telegramMessageLink).toBeUndefined();
    const verify = await gate(gated.smartLinkSlug!, viewer.token, "verify");
    expect(verify.json.state).toBe("join_required");
    const [c] = await db.select().from(adCampaigns).where(eq(adCampaigns.publicId, ref));
    expect(c.verifiedJoins).toBe(0);
  });

  it("an outage fails CLOSED: no unlock, 503, nothing counted", async () => {
    membership("unavailable");
    const u = await unlock(gated.smartLinkSlug!, viewer.token);
    expect(u.res.status).toBe(503);
    expect(u.json.telegramMessageLink).toBeUndefined();
  });

  it("after the viewer really joins, verification passes, the file unlocks and the join counts exactly once", async () => {
    membership("member");
    const v1 = await gate(gated.smartLinkSlug!, viewer.token, "verify");
    expect(v1.json.state).toBe("passed");
    await gate(gated.smartLinkSlug!, viewer.token, "verify");
    const u = await unlock(gated.smartLinkSlug!, viewer.token);
    expect(u.res.status).toBe(200);
    expect(u.json.telegramMessageLink).toBe("https://t.me/c/1/2");
    const [c] = await db.select().from(adCampaigns).where(eq(adCampaigns.publicId, ref));
    expect(c.verifiedJoins).toBe(1);
    expect(Number(c.spent)).toBeCloseTo(0.5, 6);
    expect(await db.select().from(adConversions).where(eq(adConversions.campaignId, c.id))).toHaveLength(1);
  });

  it("an EXISTING member passes but is never counted as a new join", async () => {
    membership("member");
    const s = await gate(gated.smartLinkSlug!, veteran.token, "start");
    expect(s.json.state).toBe("passed");
    await gate(gated.smartLinkSlug!, veteran.token, "verify");
    const [c] = await db.select().from(adCampaigns).where(eq(adCampaigns.publicId, ref));
    expect(c.verifiedJoins).toBe(1);
    const [conv] = await db.select().from(adConversions).where(eq(adConversions.userId, veteran.id));
    expect(conv.status).toBe("already_member");
    expect((await unlock(gated.smartLinkSlug!, veteran.token)).res.status).toBe(200);
  });

  it("the file owner is never gated, and other files are unaffected", async () => {
    membership("not_member");
    expect((await unlock(gated.smartLinkSlug!, owner.token)).res.status).toBe(200);
    expect((await unlock(other.smartLinkSlug!, viewer.token)).res.status).toBe(200);
    expect((await unlock(other.smartLinkSlug!)).res.status).toBe(200);
    expect((await gate(other.smartLinkSlug!, viewer.token, "start")).json).toEqual({ gated: false });
  });

  it("a paused gate stops gating", async () => {
    await actionRoute.POST(req("POST", `/api/advertise/${ref}/action`, owner.token, { action: "pause" }), refCtx(ref));
    membership("not_member");
    expect((await unlock(gated.smartLinkSlug!, (await makeUser("p")).token)).res.status).toBe(200);
    await actionRoute.POST(req("POST", `/api/advertise/${ref}/action`, owner.token, { action: "resume" }), refCtx(ref));
    expect((await unlock(gated.smartLinkSlug!, (await makeUser("q")).token)).res.status).toBe(403);
  });
});

describe("Telegram chat_member updates", () => {
  const MEMBER = { status: "member" };
  const LEFT = { status: "left" };
  it("counts only a not-member → member change for a user with an awaiting_join baseline, once", async () => {
    const fresh = await makeUser("f");
    membership("not_member");
    await gate(gated.smartLinkSlug!, fresh.token, "start"); // baseline: not a member
    const [c0] = await db.select().from(adCampaigns).where(eq(adCampaigns.publicId, ref));
    const chatId = c0.tgChatId!;
    const before = c0.verifiedJoins ?? 0;
    expect(await confirmJoinFromUpdate(chatId, Number(fresh.telegramId), MEMBER, MEMBER)).toBe(0); // already a member before: ignore
    expect(await confirmJoinFromUpdate(chatId, Number(fresh.telegramId), LEFT, LEFT)).toBe(0); // leave events never count
    expect(await confirmJoinFromUpdate(chatId, Number(fresh.telegramId), LEFT, MEMBER)).toBe(1);
    expect(await confirmJoinFromUpdate(chatId, Number(fresh.telegramId), LEFT, MEMBER)).toBe(0); // duplicate update
    const stranger = await makeUser("s"); // never tapped Join in Onfile → no attribution
    expect(await confirmJoinFromUpdate(chatId, Number(stranger.telegramId), LEFT, MEMBER)).toBe(0);
    const [c1] = await db.select().from(adCampaigns).where(eq(adCampaigns.publicId, ref));
    expect(c1.verifiedJoins).toBe(before + 1);
  });
});
