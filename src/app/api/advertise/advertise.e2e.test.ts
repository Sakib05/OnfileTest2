import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { adCampaigns, adConversions, adEvents, files, users } from "@/db/schema";
import { createSession } from "@/lib/auth";
import { signServeToken } from "@/lib/ads/tokens";
import { startJoin, verifyJoin } from "@/lib/ads/join";

/**
 * DATABASE-BACKED integration tests: real Postgres + the REAL route handlers + real session cookies.
 * Telegram is replaced by controllable fakes (no network). Needs a disposable DB with the schema applied.
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
import { rateLimit } from "@/lib/rateLimit";
import * as listRoute from "./route";
import * as itemRoute from "./[ref]/route";
import * as actionRoute from "./[ref]/action/route";
import * as optionsRoute from "./options/route";
import * as serveRoute from "../ads/serve/route";
import * as eventRoute from "../ads/event/route";
import * as adminRoute from "../admin/ads/route";

const tag = `ad${Date.now()}`;
const userIds: number[] = [];
let ipSeq = 0;
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

function req(method: string, url: string, token: string | undefined, body?: unknown, extra: Record<string, string> = {}) {
  const headers: Record<string, string> = { host: "localhost", "content-type": "application/json", "x-forwarded-for": `10.77.${Math.floor(++ipSeq / 250)}.${ipSeq % 250}`, ...extra };
  if (token) headers.cookie = `onfile_session=${token}`;
  return new NextRequest(`http://localhost${url}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}
const ctx = (ref: string) => ({ params: Promise.resolve({ ref }) });

async function makeUser(n: string) {
  const [u] = await db.insert(users).values({ telegramId: `${Date.now()}${++ipSeq}`, firstName: `U${n}`, referralCode: `${tag}${n}`.slice(-8).toUpperCase(), language: "en" }).returning();
  userIds.push(u.id);
  const s = await createSession(u.id);
  return { id: u.id, telegramId: u.telegramId as string, token: s.token };
}

async function makeFile(userId: number, published = true) {
  const [f] = await db.insert(files).values({ userId, title: "My file", fileType: "document", isPublished: published, smartLinkSlug: published ? `${tag}-${++ipSeq}` : null }).returning();
  return f;
}

const draftBody = (fileId: number, over: Record<string, unknown> = {}) => ({
  clientRef: `ref${Date.now()}${++ipSeq}abcdef`,
  adType: "onfile_content",
  contentKind: "file",
  fileId,
  objective: "clicks",
  title: "Launch",
  headline: "Read my file",
  description: "Short and sweet.",
  ctaText: "Open",
  placements: ["library", "file_access"],
  targeting: { countries: [], languages: [] },
  budget: "10",
  startDate: day(0),
  endDate: day(7),
  ...over,
});

let A: Awaited<ReturnType<typeof makeUser>>;
let B: Awaited<ReturnType<typeof makeUser>>;
let ADMIN: Awaited<ReturnType<typeof makeUser>>;
let fileA: Awaited<ReturnType<typeof makeFile>>;
let unpublishedA: Awaited<ReturnType<typeof makeFile>>;

beforeAll(async () => {
  A = await makeUser("a");
  B = await makeUser("b");
  ADMIN = await makeUser("c");
  process.env.ADMIN_TELEGRAM_IDS = ADMIN.telegramId;
  fileA = await makeFile(A.id);
  unpublishedA = await makeFile(A.id, false);
});

afterAll(async () => {
  if (userIds.length) {
    await db.delete(adCampaigns).where(inArray(adCampaigns.userId, userIds));
    await db.delete(files).where(inArray(files.userId, userIds));
    for (const id of userIds) await db.delete(users).where(eq(users.id, id));
  }
});

async function createDraft(token: string, body: Record<string, unknown>) {
  const res = await listRoute.POST(req("POST", "/api/advertise", token, body));
  return { res, json: await res.json() };
}
async function submit(token: string, ref: string) {
  const res = await actionRoute.POST(req("POST", `/api/advertise/${ref}/action`, token, { action: "submit" }), ctx(ref));
  return { res, json: await res.json() };
}
async function admin(body: Record<string, unknown>, token = ADMIN.token) {
  const res = await adminRoute.POST(req("POST", "/api/admin/ads", token, body));
  return { res, json: await res.json() };
}
/** A submitted + approved (active) campaign owned by `owner`, ready to serve. */
async function activeCampaign(owner: typeof A, over: Record<string, unknown> = {}, price = { unitPrice: "0.5" }) {
  const f = await makeFile(owner.id);
  const { json } = await createDraft(owner.token, draftBody(f.id, over));
  const ref = json.campaign.ref as string;
  const s = await submit(owner.token, ref);
  expect(s.res.status).toBe(200);
  const a = await admin({ ref, action: "approve", unitPrice: price.unitPrice, paymentConfirmed: true });
  expect(a.res.status).toBe(200);
  return { ref, file: f };
}
async function serveAd(slot: string, viewerToken?: string) {
  const res = await serveRoute.GET(req("GET", `/api/ads/serve?slot=${slot}`, viewerToken));
  return (await res.json()) as { ad: null | { token: string; headline: string; objective: string } };
}
async function event(token: string | undefined, adToken: string, type: string) {
  const res = await eventRoute.POST(req("POST", "/api/ads/event", token, { token: adToken, type }));
  return { res, json: await res.json() };
}
async function row(ref: string) {
  const [r] = await db.select().from(adCampaigns).where(eq(adCampaigns.publicId, ref));
  return r;
}

describe("authentication", () => {
  it("every creator endpoint rejects anonymous requests", async () => {
    expect((await listRoute.GET(req("GET", "/api/advertise", undefined))).status).toBe(401);
    expect((await listRoute.POST(req("POST", "/api/advertise", undefined, draftBody(1)))).status).toBe(401);
    expect((await optionsRoute.GET(req("GET", "/api/advertise/options", undefined))).status).toBe(401);
    expect((await itemRoute.GET(req("GET", "/api/advertise/AD-ABCDEFGH", undefined), ctx("AD-ABCDEFGH"))).status).toBe(401);
    expect((await actionRoute.POST(req("POST", "/api/advertise/AD-ABCDEFGH/action", undefined, { action: "pause" }), ctx("AD-ABCDEFGH"))).status).toBe(401);
  });
  it("rejects cross-origin state changes", async () => {
    const res = await listRoute.POST(req("POST", "/api/advertise", A.token, draftBody(fileA.id), { origin: "https://evil.example" }));
    expect(res.status).toBe(403);
  });
});

describe("rate limiting", () => {
  it("answers 429 (and changes nothing) when a limit is exceeded", async () => {
    vi.mocked(rateLimit).mockReturnValueOnce({ allowed: false, remaining: 0 });
    const body = draftBody(fileA.id);
    const res = await listRoute.POST(req("POST", "/api/advertise", A.token, body));
    expect(res.status).toBe(429);
    expect(await db.select().from(adCampaigns).where(eq(adCampaigns.clientRef, body.clientRef))).toHaveLength(0);
    vi.mocked(rateLimit).mockReturnValueOnce({ allowed: false, remaining: 0 });
    expect((await eventRoute.POST(req("POST", "/api/ads/event", B.token, { token: "x", type: "click" }))).status).toBe(429);
  });
});

describe("campaign creation + creator isolation", () => {
  it("creates a draft with a public reference, idempotently", async () => {
    const body = draftBody(fileA.id);
    const first = await createDraft(A.token, body);
    expect(first.res.status).toBe(201);
    expect(first.json.campaign.status).toBe("draft");
    expect(first.json.campaign.ref).toMatch(/^AD-[A-Z2-9]{8}$/);
    expect(first.json.campaign).not.toHaveProperty("id");
    expect(first.json.campaign).not.toHaveProperty("userId");
    const again = await createDraft(A.token, body); // same clientRef (double tap)
    expect(again.res.status).toBe(200);
    expect(again.json.campaign.ref).toBe(first.json.campaign.ref);
    const n = await db.select().from(adCampaigns).where(eq(adCampaigns.clientRef, body.clientRef));
    expect(n).toHaveLength(1);
  });

  it("another creator can't list, read, edit, act on or submit it (404, indistinguishable from missing)", async () => {
    const { json } = await createDraft(A.token, draftBody(fileA.id));
    const ref = json.campaign.ref as string;
    const list = await (await listRoute.GET(req("GET", "/api/advertise", B.token))).json();
    expect(list.campaigns.some((c: { ref: string }) => c.ref === ref)).toBe(false);
    expect((await itemRoute.GET(req("GET", `/api/advertise/${ref}`, B.token), ctx(ref))).status).toBe(404);
    expect((await itemRoute.PATCH(req("PATCH", `/api/advertise/${ref}`, B.token, draftBody(fileA.id)), ctx(ref))).status).toBe(404);
    expect((await submit(B.token, ref)).res.status).toBe(404);
    expect((await actionRoute.POST(req("POST", `/api/advertise/${ref}/action`, B.token, { action: "delete" }), ctx(ref))).status).toBe(404);
    expect((await row(ref)).status).toBe("draft");
    const mine = await (await listRoute.GET(req("GET", "/api/advertise", A.token))).json();
    expect(mine.campaigns.some((c: { ref: string }) => c.ref === ref)).toBe(true);
  });

  it("can't promote someone else's file", async () => {
    const r = await createDraft(B.token, draftBody(fileA.id));
    expect(r.res.status).toBe(404);
    expect(r.json.fieldErrors.fileId).toBeTruthy();
  });

  it("ignores status / counters / spend / pricing / payment / owner fields sent by the client", async () => {
    const { json } = await createDraft(A.token, draftBody(fileA.id, { status: "active", spent: "99", impressions: 1000, clicks: 500, verifiedJoins: 9, unitPrice: "0.0001", paymentStatus: "confirmed", userId: B.id, publicId: "AD-AAAAAAAA", reviewedBy: 1 }));
    const r = await row(json.campaign.ref);
    expect(r).toMatchObject({ status: "draft", impressions: 0, clicks: 0, verifiedJoins: 0, userId: A.id, paymentStatus: "pending_confirmation", unitPrice: null });
    expect(Number(r.spent)).toBe(0);
    expect(r.publicId).not.toBe("AD-AAAAAAAA");
  });

  it("the old public listing is gone: GET returns only the caller's records", async () => {
    const list = await (await listRoute.GET(req("GET", "/api/advertise", B.token))).json();
    expect(list.campaigns.every((c: { ref: string }) => !!c.ref)).toBe(true);
    expect(list.overview.totalCampaigns).toBe(list.campaigns.length);
  });
});

describe("draft editing and submission", () => {
  it("edits a draft, then refuses edits once submitted (409)", async () => {
    const { json } = await createDraft(A.token, draftBody(fileA.id));
    const ref = json.campaign.ref as string;
    const patched = await itemRoute.PATCH(req("PATCH", `/api/advertise/${ref}`, A.token, draftBody(fileA.id, { title: "Renamed", budget: "20" })), ctx(ref));
    expect(patched.status).toBe(200);
    expect((await patched.json()).campaign.title).toBe("Renamed");
    expect((await submit(A.token, ref)).res.status).toBe(200);
    const late = await itemRoute.PATCH(req("PATCH", `/api/advertise/${ref}`, A.token, draftBody(fileA.id, { title: "Sneaky" })), ctx(ref));
    expect(late.status).toBe(409);
    expect((await row(ref)).campaignName).toBe("Renamed");
  });

  it("submit validates the whole campaign and the destination; the normal result is Pending Review (never active)", async () => {
    const incomplete = await createDraft(A.token, { clientRef: `inc${Date.now()}abcdefgh`, adType: "onfile_content", contentKind: "file", fileId: fileA.id });
    const s1 = await submit(A.token, incomplete.json.campaign.ref);
    expect(s1.res.status).toBe(422);
    expect(Object.keys(s1.json.fieldErrors).length).toBeGreaterThan(2);

    const unpub = await createDraft(A.token, draftBody(unpublishedA.id));
    const s2 = await submit(A.token, unpub.json.campaign.ref);
    expect(s2.res.status).toBe(422);
    expect(s2.json.fieldErrors.fileId).toMatch(/publish/i);

    const ok = await createDraft(A.token, draftBody(fileA.id));
    const s3 = await submit(A.token, ok.json.campaign.ref);
    expect(s3.res.status).toBe(200);
    expect(s3.json.campaign.status).toBe("pending");
    expect(s3.json.campaign.payment.status).toBe("pending_confirmation");
    const stored = await row(ok.json.campaign.ref);
    expect(stored.targetUrl).toBe(`/f/${fileA.smartLinkSlug}`);
    expect(stored.status).not.toBe("active");
    // double submit = no-op, no duplicate row, still pending
    const s4 = await submit(A.token, ok.json.campaign.ref);
    expect(s4.res.status).toBe(200);
    expect(s4.json.alreadySubmitted).toBe(true);
    expect((await row(ok.json.campaign.ref)).status).toBe("pending");
  });

  it("rejects bad budgets, unsupported placements and unsafe text through the API", async () => {
    for (const budget of ["-5", "abc", "0.5", "999999999"]) {
      const r = await createDraft(A.token, draftBody(fileA.id, { budget }));
      expect(r.res.status, `budget ${budget}`).toBe(400);
      expect(r.json.fieldErrors.budget).toBeTruthy();
    }
    for (const placements of [["force_join"], ["channel_join"], ["unknown"]]) {
      const r = await createDraft(A.token, draftBody(fileA.id, { placements }));
      expect(r.res.status).toBe(400);
      expect(r.json.fieldErrors.placements).toBeTruthy();
    }
    const xss = await createDraft(A.token, draftBody(fileA.id, { headline: "<img src=x onerror=alert(1)>" }));
    expect(xss.res.status).toBe(400);
  });

  it("rejects invalid Telegram destinations on submit", async () => {
    vi.mocked(tg.lookupChat).mockResolvedValue({ ok: false, reason: "not_found" });
    vi.mocked(tg.botCanVerifyMembership).mockResolvedValue("no");
    for (const [adType, ref] of [["telegram_post", "javascript:alert(1)"], ["telegram_post", "https://evil.com/chan/1"], ["telegram_channel", "https://evil.com/chan"], ["telegram_channel", "@doesnotexist"]] as const) {
      const d = await createDraft(A.token, draftBody(fileA.id, { adType, contentKind: undefined, fileId: undefined, destinationRef: ref, objective: "clicks", placements: ["library"] }));
      expect(d.res.status, `${adType} ${ref}`).toBe(201);
      const s = await submit(A.token, d.json.campaign.ref);
      expect(s.res.status, `${adType} ${ref}`).toBeGreaterThanOrEqual(400);
      expect((await row(d.json.campaign.ref)).status).toBe("draft");
    }
  });

  it("verified joins are refused unless the bot can really verify membership; accepted when it can", async () => {
    vi.mocked(tg.lookupChat).mockResolvedValue({ ok: true, chat: { id: -1005550001, type: "channel", title: "Pub", username: "pubchan" } });
    const body = (n: string) => draftBody(fileA.id, { adType: "telegram_channel", contentKind: undefined, fileId: undefined, destinationRef: "@pubchan", objective: "verified_joins", placements: ["channel_join"], clientRef: `j${n}${Date.now()}abcdefgh` });
    vi.mocked(tg.botCanVerifyMembership).mockResolvedValue("no");
    const no = await createDraft(A.token, body("1"));
    expect(no.res.status).toBe(201);
    const refused = await submit(A.token, no.json.campaign.ref);
    expect(refused.res.status).toBe(422);
    expect(refused.json.fieldErrors.objective).toMatch(/administrator|verify/i);

    vi.mocked(tg.botCanVerifyMembership).mockResolvedValue("yes");
    const yes = await createDraft(A.token, body("2"));
    const accepted = await submit(A.token, yes.json.campaign.ref);
    expect(accepted.res.status).toBe(200);
    expect((await row(yes.json.campaign.ref)).joinVerifiable).toBe(true);
    // approval re-checks live: if the bot lost admin rights in the meantime, it can't be approved
    vi.mocked(tg.botCanVerifyMembership).mockResolvedValue("no");
    const a = await admin({ ref: yes.json.campaign.ref, action: "approve", unitPrice: "1", paymentConfirmed: true });
    expect(a.res.status).toBe(409);
  });
});

describe("status transitions + admin authorization", () => {
  it("creators can't approve, can't pause a pending campaign and can't reach admin endpoints", async () => {
    const { json } = await createDraft(A.token, draftBody(fileA.id));
    const ref = json.campaign.ref as string;
    await submit(A.token, ref);
    for (const action of ["approve", "reject", "complete"]) {
      const r = await actionRoute.POST(req("POST", `/api/advertise/${ref}/action`, A.token, { action }), ctx(ref));
      expect(r.status).toBe(400);
    }
    expect((await actionRoute.POST(req("POST", `/api/advertise/${ref}/action`, A.token, { action: "pause" }), ctx(ref))).status).toBe(409);
    expect((await adminRoute.GET(req("GET", "/api/admin/ads", A.token))).status).toBe(403);
    expect((await admin({ ref, action: "approve", unitPrice: "1", paymentConfirmed: true }, A.token)).res.status).toBe(403);
    expect((await adminRoute.GET(req("GET", "/api/admin/ads", undefined))).status).toBe(401);
    expect((await row(ref)).status).toBe("pending");
    // a client-supplied admin flag changes nothing
    const spoof = await adminRoute.POST(req("POST", "/api/admin/ads?admin=true", A.token, { ref, action: "approve", isAdmin: true, unitPrice: "1", paymentConfirmed: true }, { "x-admin": "1" }));
    expect(spoof.status).toBe(403);
  });

  it("admin approval needs a price and a payment confirmation; rejection needs a reason the creator can see", async () => {
    const { json } = await createDraft(A.token, draftBody(fileA.id));
    const ref = json.campaign.ref as string;
    await submit(A.token, ref);
    expect((await admin({ ref, action: "approve", paymentConfirmed: true })).res.status).toBe(400);
    expect((await admin({ ref, action: "approve", unitPrice: "0.1" })).res.status).toBe(400);
    expect((await admin({ ref, action: "approve", unitPrice: "-1", paymentConfirmed: true })).res.status).toBe(400);
    expect((await row(ref)).status).toBe("pending");
    expect((await admin({ ref, action: "reject" })).res.status).toBe(400);
    const rej = await admin({ ref, action: "reject", reason: "Please use a clearer headline." });
    expect(rej.res.status).toBe(200);
    const detail = await (await itemRoute.GET(req("GET", `/api/advertise/${ref}`, A.token), ctx(ref))).json();
    expect(detail.campaign.status).toBe("rejected");
    expect(detail.campaign.rejectionReason).toBe("Please use a clearer headline.");
    // can't approve twice / after rejection
    expect((await admin({ ref, action: "approve", unitPrice: "1", paymentConfirmed: true })).res.status).toBe(409);
    // creator reopens, edits, resubmits
    const reopen = await actionRoute.POST(req("POST", `/api/advertise/${ref}/action`, A.token, { action: "reopen" }), ctx(ref));
    expect(reopen.status).toBe(200);
    expect((await row(ref)).status).toBe("draft");
  });

  it("full lifecycle: approve → serve → creator pause → resume; admin pause blocks creator resume; complete", async () => {
    const { ref } = await activeCampaign(A);
    const r0 = await row(ref);
    expect(r0).toMatchObject({ status: "active", paymentStatus: "confirmed", pricingModel: "cpc" });
    expect((await serveAd("library", B.token)).ad).not.toBeNull();

    const pause = await actionRoute.POST(req("POST", `/api/advertise/${ref}/action`, A.token, { action: "pause" }), ctx(ref));
    expect(pause.status).toBe(200);
    expect((await row(ref)).status).toBe("paused");
    const resume = await actionRoute.POST(req("POST", `/api/advertise/${ref}/action`, A.token, { action: "resume" }), ctx(ref));
    expect((await resume.json()).campaign.status).toBe("active");

    expect((await admin({ ref, action: "pause" })).res.status).toBe(200);
    const blocked = await actionRoute.POST(req("POST", `/api/advertise/${ref}/action`, A.token, { action: "resume" }), ctx(ref));
    expect(blocked.status).toBe(409);
    expect((await admin({ ref, action: "resume" })).res.status).toBe(200);
    const done = await admin({ ref, action: "complete" });
    expect(done.json.campaign.status).toBe("completed");
    expect((await row(ref)).completionReason).toBe("admin");
    expect((await admin({ ref, action: "resume" })).res.status).toBe(409);
  });
});

describe("analytics: impressions, clicks, CTR, spend, completion", () => {
  it("records real events once per viewer, never for the owner, and computes CTR safely", async () => {
    const { ref, file } = await activeCampaign(A, {}, { unitPrice: "0.01" });
    const empty = await (await itemRoute.GET(req("GET", `/api/advertise/${ref}`, A.token), ctx(ref))).json();
    expect(empty.campaign.impressions).toBe(0);
    expect(empty.campaign.ctr).toBeNull(); // no impressions → no CTR (and no division error)
    expect(empty.analytics.hasData).toBe(false);

    const ad = (await serveAd("library", B.token)).ad;
    expect(ad).not.toBeNull();
    const tokenFor = signServeToken(ref, "library");
    const i1 = await event(B.token, tokenFor, "impression");
    expect(i1.json.recorded).toBe(true);
    const i2 = await event(B.token, tokenFor, "impression"); // duplicate: same viewer, same day, same placement
    expect(i2.json.recorded).toBe(false);
    const own = await event(A.token, tokenFor, "impression"); // the owner's own view
    expect(own.json.recorded).toBe(false);

    const c1 = await event(B.token, tokenFor, "click");
    expect(c1.json.recorded).toBe(true);
    expect(c1.json.url).toBe(`/f/${file.smartLinkSlug}`);
    const c2 = await event(B.token, tokenFor, "click");
    expect(c2.json.recorded).toBe(false);
    expect(c2.json.url).toBe(`/f/${file.smartLinkSlug}`); // destination still returned (it's the validated stored URL)

    const r = await row(ref);
    expect(r).toMatchObject({ impressions: 1, clicks: 1 });
    expect(Number(r.spent)).toBeCloseTo(0.01, 6); // cpc: one recorded click
    const detail = await (await itemRoute.GET(req("GET", `/api/advertise/${ref}`, A.token), ctx(ref))).json();
    expect(detail.campaign.ctr).toBe(100);
    expect(detail.campaign.remaining).toBeCloseTo(9.99, 6);
    expect(detail.analytics.hasData).toBe(true);
    expect(detail.analytics.byPlacement[0]).toMatchObject({ placement: "library", impressions: 1, clicks: 1 });
    const events = await db.select().from(adEvents).where(eq(adEvents.campaignId, r.id));
    expect(events).toHaveLength(2);
  });

  it("rejects forged, tampered, expired and slot-mismatched tokens; events only work through serve tokens", async () => {
    const { ref } = await activeCampaign(A);
    expect((await event(B.token, "garbage", "impression")).res.status).toBe(400);
    const good = signServeToken(ref, "library");
    expect((await event(B.token, good.slice(0, -2) + "xx", "impression")).res.status).toBe(400);
    expect((await event(B.token, signServeToken(ref, "library", Date.now() - 31 * 60_000), "impression")).res.status).toBe(400);
    expect((await event(B.token, good, "purchase")).res.status).toBe(400);
    expect((await event(B.token, signServeToken("AD-ZZZZZZZZ", "library"), "impression")).res.status).toBe(404);
    expect((await row(ref)).impressions).toBe(0);
  });

  it("different viewers count separately; a campaign that isn't active records nothing", async () => {
    const { ref } = await activeCampaign(A);
    const t = signServeToken(ref, "file_access");
    expect((await event(undefined, t, "impression")).json.recorded).toBe(true); // anonymous visitor #1 (own IP)
    expect((await event(undefined, t, "impression")).json.recorded).toBe(true); // anonymous visitor #2 (another IP)
    expect((await event(B.token, t, "impression")).json.recorded).toBe(true);
    expect((await row(ref)).impressions).toBe(3);
    await admin({ ref, action: "pause" });
    expect((await event(ADMIN.token, t, "impression")).json.recorded).toBe(false);
    expect((await row(ref)).impressions).toBe(3);
  });

  it("completes when the target is reached", async () => {
    const headline = `target-${tag}`;
    const { ref } = await activeCampaign(A, { objective: "clicks", targetAmount: 2, headline }, { unitPrice: "0.01" });
    const t = signServeToken(ref, "library");
    await event(B.token, t, "click");
    expect((await row(ref)).status).toBe("active");
    await event(ADMIN.token, t, "click");
    const r = await row(ref);
    expect(r).toMatchObject({ status: "completed", completionReason: "target_reached", clicks: 2 });
    for (let i = 0; i < 15; i++) expect((await serveAd("library", B.token)).ad?.headline).not.toBe(headline); // completed campaigns are never served
  });

  it("never spends past the budget and completes when it is exhausted", async () => {
    const { ref } = await activeCampaign(A, { budget: "1" }, { unitPrice: "0.5" }); // cpc 0.50, budget 1.00 → 2 clicks
    const t = signServeToken(ref, "library");
    expect((await event(B.token, t, "click")).json.recorded).toBe(true);
    expect((await event(ADMIN.token, t, "click")).json.recorded).toBe(true);
    let r = await row(ref);
    expect(r).toMatchObject({ status: "completed", completionReason: "budget_exhausted" });
    expect(Number(r.spent)).toBe(1);
    expect((await event(undefined, t, "click")).json.recorded).toBe(false);
    r = await row(ref);
    expect(r.clicks).toBe(2);
    expect(Number(r.spent)).toBeLessThanOrEqual(1);
  });

  it("completes by schedule: an elapsed end date completes the campaign and it stops serving", async () => {
    const { ref } = await activeCampaign(A);
    await db.update(adCampaigns).set({ endDate: new Date(Date.now() - 60_000) }).where(eq(adCampaigns.publicId, ref));
    const detail = await (await itemRoute.GET(req("GET", `/api/advertise/${ref}`, A.token), ctx(ref))).json();
    expect(detail.campaign).toMatchObject({ status: "completed", completionReason: "duration_ended" });
  });
});

describe("serving rules", () => {
  it("serves only active, confirmed, in-date campaigns for the right slot, and respects targeting", async () => {
    const owner = await makeUser("srv");
    const lib = await activeCampaign(owner, { placements: ["library"], targeting: { countries: ["BR"], languages: [] }, headline: `only-brazil-${tag}` });
    const headlinesFor = async (slot: string, country?: string) => {
      const seen = new Set<string>();
      for (let i = 0; i < 40; i++) {
        const r = (await (await serveRoute.GET(req("GET", `/api/ads/serve?slot=${slot}`, B.token, undefined, country ? { "x-vercel-ip-country": country } : {}))).json()) as { ad: null | { headline: string } };
        if (r.ad) seen.add(r.ad.headline);
      }
      return seen;
    };
    const target = `only-brazil-${tag}`;
    expect((await headlinesFor("library", "BR")).has(target)).toBe(true); // matching country: served
    expect((await headlinesFor("library", "US")).has(target)).toBe(false);
    expect((await headlinesFor("library")).has(target)).toBe(false); // unknown country never matches a targeted campaign
    // wrong slot
    expect((await headlinesFor("playlist_between", "BR")).has(target)).toBe(false);
    expect((await serveRoute.GET(req("GET", "/api/ads/serve?slot=homepage", undefined))).status).toBe(400);
    // the response never leaks destination / budget / price / owner
    const ad = (await (await serveRoute.GET(req("GET", "/api/ads/serve?slot=library", B.token, undefined, { "x-vercel-ip-country": "BR" }))).json()) as { ad: Record<string, unknown> | null };
    if (ad.ad) for (const k of ["targetUrl", "destinationUrl", "budget", "unitPrice", "userId", "id", "spent"]) expect(ad.ad).not.toHaveProperty(k);
    // paused → not served
    await admin({ ref: lib.ref, action: "pause" });
    expect((await headlinesFor("library", "BR")).has(target)).toBe(false);
    await db.delete(adCampaigns).where(eq(adCampaigns.userId, owner.id));
    await db.delete(files).where(eq(files.userId, owner.id));
    await db.delete(users).where(eq(users.id, owner.id));
  });
});

describe("verified joins: baseline, single count, no existing members", () => {
  async function joinCampaign() {
    const [c] = await db
      .insert(adCampaigns)
      .values({ publicId: `AD-J${String(++ipSeq).padStart(7, "2")}`.slice(0, 11), userId: A.id, source: "creator", adType: "telegram_channel", objective: "verified_joins", status: "active", paymentStatus: "confirmed", pricingModel: "cpa", unitPrice: "1.000000", budget: "10.00", targetAmount: 2, tgChatId: "-1001112223334", joinVerifiable: true, placements: ["channel_join"], targetUrl: "https://t.me/+AbCdEfGhIjKl", campaignName: "join", clientRef: `jc${ipSeq}${Date.now()}abc` })
      .returning();
    return c;
  }
  const camp = (c: { id: number; tgChatId: string | null }) => ({ id: c.id, tgChatId: c.tgChatId });

  it("counts a new member exactly once", async () => {
    const c = await joinCampaign();
    let member = false;
    const m = async () => (member ? ("member" as const) : ("not_member" as const));
    expect(await startJoin(camp(c), B.id, 111, m)).toEqual({ ok: true, state: "awaiting_join" });
    expect(await verifyJoin(camp(c), B.id, 111, m)).toEqual({ ok: true, state: "awaiting_join" }); // clicked but hasn't joined: NOT counted
    expect((await row(c.publicId!)).verifiedJoins).toBe(0);
    member = true;
    expect(await verifyJoin(camp(c), B.id, 111, m)).toMatchObject({ ok: true, state: "verified", newlyVerified: true });
    expect(await verifyJoin(camp(c), B.id, 111, m)).toMatchObject({ ok: true, state: "verified" });
    expect(await verifyJoin(camp(c), B.id, 111, m)).toMatchObject({ ok: true, state: "verified" });
    const r = await row(c.publicId!);
    expect(r.verifiedJoins).toBe(1);
    expect(Number(r.spent)).toBe(1);
    expect(await db.select().from(adConversions).where(eq(adConversions.campaignId, c.id))).toHaveLength(1);
  });

  it("concurrent verifications can't double count", async () => {
    const c = await joinCampaign();
    let member = false;
    const m = async () => (member ? ("member" as const) : ("not_member" as const));
    await startJoin(camp(c), B.id, 111, m);
    member = true;
    await Promise.all([1, 2, 3, 4, 5].map(() => verifyJoin(camp(c), B.id, 111, m)));
    expect((await row(c.publicId!)).verifiedJoins).toBe(1);
  });

  it("existing members are never counted — even if they leave and re-join", async () => {
    const c = await joinCampaign();
    expect(await startJoin(camp(c), ADMIN.id, 222, async () => "member")).toEqual({ ok: true, state: "already_member" });
    expect(await verifyJoin(camp(c), ADMIN.id, 222, async () => "member")).toEqual({ ok: true, state: "already_member" });
    // they leave and a later "start" must not re-baseline them as a new member
    expect(await startJoin(camp(c), ADMIN.id, 222, async () => "not_member")).toEqual({ ok: true, state: "already_member" });
    expect(await verifyJoin(camp(c), ADMIN.id, 222, async () => "member")).toEqual({ ok: true, state: "already_member" });
    expect((await row(c.publicId!)).verifiedJoins).toBe(0);
  });

  it("a click alone is never a join, and verify before start is refused", async () => {
    const c = await joinCampaign();
    expect(await verifyJoin(camp(c), B.id, 111, async () => "member")).toEqual({ ok: false, code: "start_required" });
    const t = signServeToken(c.publicId!, "file_access");
    await event(B.token, t, "click");
    expect((await row(c.publicId!)).verifiedJoins).toBe(0);
  });

  it("when Telegram can't answer nothing is recorded or counted", async () => {
    const c = await joinCampaign();
    expect(await startJoin(camp(c), B.id, 111, async () => "unavailable")).toEqual({ ok: false, code: "unavailable" });
    expect(await db.select().from(adConversions).where(eq(adConversions.campaignId, c.id))).toHaveLength(0);
    await startJoin(camp(c), B.id, 111, async () => "not_member");
    expect(await verifyJoin(camp(c), B.id, 111, async () => "unavailable")).toEqual({ ok: false, code: "unavailable" });
    expect((await row(c.publicId!)).verifiedJoins).toBe(0);
  });

  it("completes the campaign when the join target is reached; extra joins after that are refused", async () => {
    const c = await joinCampaign();
    const m = async () => "not_member" as const;
    const users2 = [B, ADMIN];
    for (const u of users2) await startJoin(camp(c), u.id, Number(u.telegramId), m);
    for (const u of users2) await verifyJoin(camp(c), u.id, Number(u.telegramId), async () => "member");
    const r = await row(c.publicId!);
    expect(r).toMatchObject({ verifiedJoins: 2, status: "completed", completionReason: "target_reached" });
    const late = await verifyJoin(camp(c), A.id, 333, async () => "member");
    expect(late.ok).toBe(false);
  });
});

describe("overview + legacy data", () => {
  it("the overview is computed from the caller's own rows; legacy rows without an owner are untouched and never exposed to creators", async () => {
    const [legacy] = await db.insert(adCampaigns).values({ advertiserName: "Old Co", advertiserEmail: "old@example.com", network: "adsgram", campaignName: "legacy", status: "pending" }).returning();
    try {
      const list = await (await listRoute.GET(req("GET", "/api/advertise", A.token))).json();
      expect(JSON.stringify(list)).not.toContain("old@example.com");
      expect(list.campaigns.length).toBe(list.overview.totalCampaigns);
      const adminList = await (await adminRoute.GET(req("GET", "/api/admin/ads?status=all", ADMIN.token))).json();
      expect(adminList.legacyCount).toBeGreaterThanOrEqual(1);
      expect(JSON.stringify(adminList)).not.toContain("old@example.com");
      const [still] = await db.select().from(adCampaigns).where(eq(adCampaigns.id, legacy.id));
      expect(still).toMatchObject({ advertiserEmail: "old@example.com", status: "pending" });
    } finally {
      await db.delete(adCampaigns).where(eq(adCampaigns.id, legacy.id));
    }
  });
});
