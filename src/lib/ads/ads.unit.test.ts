import { describe, expect, it, vi } from "vitest";
import {
  OBJECTIVES_BY_TYPE,
  PLACEMENTS,
  isSelectablePlacement,
  placementsForType,
} from "./constants";
import { adminTransition, creatorCapabilities, creatorTransition } from "./transitions";
import { completionReason, ctr, eventCost, objectiveCount, remainingBudget, targetProgress } from "./metrics";
import { generatePublicId, isValidPublicId, signServeToken, verifyServeToken, viewerKeyFor } from "./tokens";
import { matchesTargeting, viewerCountryFromHeaders } from "./targeting";
import { cleanText, containsMarkup, isSafeDestination, parseBudget, parseDay, validateCampaignInput } from "./validation";
import { resolveDestination, type DestinationDeps } from "./destination";
import { getMembership, isActiveMember } from "./telegram";
import { buildOverview } from "./serialize";
import { parseReason, parseUnitPrice } from "./adminService";
import { dedupeKeyFor } from "./events";

const NOW = new Date("2030-03-10T12:00:00Z");
const validBody = (over: Record<string, unknown> = {}) => ({
  adType: "onfile_content",
  contentKind: "file",
  fileId: 5,
  objective: "clicks",
  title: "Spring launch",
  headline: "My new course",
  description: "Learn fast.",
  ctaText: "Open",
  placements: ["library", "file_access"],
  targeting: { countries: ["US"], languages: ["en"] },
  budget: "25",
  startDate: "2030-03-10",
  endDate: "2030-03-20",
  ...over,
});

describe("CTR", () => {
  it("is clicks / impressions × 100, rounded to 2 decimals", () => {
    expect(ctr(1, 4)).toBe(25);
    expect(ctr(1, 3)).toBe(33.33);
    expect(ctr(0, 10)).toBe(0);
  });
  it("never divides by zero: null (not 0, not NaN) when there are no impressions", () => {
    expect(ctr(5, 0)).toBeNull();
    expect(ctr(0, 0)).toBeNull();
    expect(ctr(null, null)).toBeNull();
    expect(ctr(1, undefined)).toBeNull();
  });
});

describe("budget / progress / pricing maths", () => {
  it("remaining budget never goes negative", () => {
    expect(remainingBudget("10.00", "2.5")).toBe(7.5);
    expect(remainingBudget("10", "12")).toBe(0);
    expect(remainingBudget(null, null)).toBe(0);
  });
  it("progress is capped at 100 and null without a target", () => {
    const row = { impressions: 10, clicks: 50, verifiedJoins: 3 };
    expect(targetProgress("clicks", row, 100)).toEqual({ current: 50, target: 100, percent: 50 });
    expect(targetProgress("clicks", row, 10)?.percent).toBe(100);
    expect(targetProgress("clicks", row, null)).toBeNull();
    expect(objectiveCount("verified_joins", row)).toBe(3);
  });
  it("accrues cost only for the priced event and only when a price exists", () => {
    expect(eventCost("cpm", "2", "impression")).toBe(0.002);
    expect(eventCost("cpm", "2", "click")).toBe(0);
    expect(eventCost("cpc", "0.5", "click")).toBe(0.5);
    expect(eventCost("cpa", "1", "join")).toBe(1);
    expect(eventCost("cpa", "1", "click")).toBe(0);
    expect(eventCost(null, null, "click")).toBe(0);
    expect(eventCost("cpc", "0", "click")).toBe(0);
  });
});

describe("campaign completion conditions", () => {
  const base = { objective: "clicks", budget: "10", spent: "0", targetAmount: null as number | null, endDate: null as Date | null, impressions: 0, clicks: 0, verifiedJoins: 0 };
  it("target reached", () => expect(completionReason({ ...base, targetAmount: 5, clicks: 5 }, NOW)).toBe("target_reached"));
  it("target is measured by the objective's own counter", () => {
    expect(completionReason({ ...base, objective: "impressions", targetAmount: 5, clicks: 99, impressions: 4 }, NOW)).toBeNull();
    expect(completionReason({ ...base, objective: "verified_joins", targetAmount: 2, verifiedJoins: 2 }, NOW)).toBe("target_reached");
  });
  it("budget exhausted", () => expect(completionReason({ ...base, spent: "10" }, NOW)).toBe("budget_exhausted"));
  it("duration ended", () => expect(completionReason({ ...base, endDate: new Date("2030-03-09T23:59:59Z") }, NOW)).toBe("duration_ended"));
  it("keeps running otherwise (zero budget is not 'exhausted': no price means nothing accrues)", () => {
    expect(completionReason({ ...base, endDate: new Date("2030-04-01T00:00:00Z"), clicks: 3, targetAmount: 5 }, NOW)).toBeNull();
    expect(completionReason({ ...base, budget: "0" }, NOW)).toBeNull();
  });
});

describe("status transitions", () => {
  it("follows draft → pending → active ⇄ paused → completed", () => {
    expect(creatorTransition("submit", "draft")).toEqual({ ok: true, to: "pending" });
    expect(adminTransition("approve", "pending")).toEqual({ ok: true, to: "active" });
    expect(creatorTransition("pause", "active")).toEqual({ ok: true, to: "paused" });
    expect(creatorTransition("resume", "paused", "creator")).toEqual({ ok: true, to: "active" });
    expect(adminTransition("complete", "active").to).toBe("completed");
    expect(adminTransition("complete", "paused").to).toBe("completed");
    expect(adminTransition("reject", "pending").to).toBe("rejected");
    expect(creatorTransition("reopen", "rejected").to).toBe("draft");
  });
  it("rejects every invalid creator transition", () => {
    for (const from of ["pending", "active", "paused", "completed", "rejected"] as const) expect(creatorTransition("submit", from).ok).toBe(false);
    expect(creatorTransition("pause", "pending").ok).toBe(false);
    expect(creatorTransition("pause", "paused").ok).toBe(false);
    expect(creatorTransition("resume", "active").ok).toBe(false);
    expect(creatorTransition("resume", "completed").ok).toBe(false);
    expect(creatorTransition("delete", "active").ok).toBe(false);
    expect(creatorTransition("reopen", "draft").ok).toBe(false);
  });
  it("a creator can't resume what an admin paused", () => {
    expect(creatorTransition("resume", "paused", "admin").ok).toBe(false);
    expect(adminTransition("resume", "paused").ok).toBe(true);
  });
  it("creators have no approve/reject/complete at all; admins can't approve non-pending campaigns", () => {
    expect(adminTransition("approve", "draft").ok).toBe(false);
    expect(adminTransition("approve", "active").ok).toBe(false);
    expect(adminTransition("reject", "active").ok).toBe(false);
    expect(adminTransition("complete", "pending").ok).toBe(false);
    expect(adminTransition("complete", "completed").ok).toBe(false);
  });
  it("UI capabilities only offer valid actions for each status", () => {
    expect(creatorCapabilities("draft")).toMatchObject({ edit: true, submit: true, pause: false, resume: false, remove: true, viewPerformance: false });
    expect(creatorCapabilities("pending")).toMatchObject({ edit: false, pause: false, resume: false, remove: false });
    expect(creatorCapabilities("active")).toMatchObject({ edit: false, pause: true, resume: false, viewPerformance: true });
    expect(creatorCapabilities("paused", "creator")).toMatchObject({ pause: false, resume: true });
    expect(creatorCapabilities("paused", "admin")).toMatchObject({ resume: false });
    expect(creatorCapabilities("rejected")).toMatchObject({ reopen: true, edit: false });
    expect(creatorCapabilities("completed")).toMatchObject({ pause: false, resume: false, viewPerformance: true });
  });
});

describe("campaign validation", () => {
  it("accepts a complete campaign", () => {
    const r = validateCampaignInput(validBody(), "submit", NOW);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.budget).toBe("25.00");
      expect(r.value.targeting).toEqual({ countries: ["US"], languages: ["en"] });
    }
  });
  it("a draft may be incomplete but must name a type", () => {
    expect(validateCampaignInput({ adType: "telegram_post" }, "draft").ok).toBe(true);
    expect(validateCampaignInput({}, "draft").ok).toBe(false);
    expect(validateCampaignInput({ adType: "banner" }, "draft").ok).toBe(false);
    expect(validateCampaignInput(null, "draft").ok).toBe(false);
  });
  it("budget validation", () => {
    for (const bad of ["abc", "-5", "0", "0.5", "1.234", "100001", "", "1e3", "5,5"]) {
      const r = validateCampaignInput(validBody({ budget: bad }), "submit", NOW);
      expect(r.ok, `budget ${bad}`).toBe(false);
    }
    expect(parseBudget("1")).toEqual({ ok: true, value: "1.00" });
    expect(parseBudget("100000")).toEqual({ ok: true, value: "100000.00" });
    expect(parseBudget(12.5)).toEqual({ ok: true, value: "12.50" });
    expect(parseBudget(NaN).ok).toBe(false);
  });
  it("target must be a whole positive number", () => {
    for (const bad of [0, -1, 1.5, "x", 1e12]) expect(validateCampaignInput(validBody({ targetAmount: bad }), "submit", NOW).ok, String(bad)).toBe(false);
    expect(validateCampaignInput(validBody({ targetAmount: 500 }), "submit", NOW).ok).toBe(true);
  });
  it("dates: order, rollover, past, max length", () => {
    expect(parseDay("2030-02-31", false)).toBeNull();
    expect(parseDay("2030-13-01", false)).toBeNull();
    expect(parseDay("10/03/2030", false)).toBeNull();
    expect(validateCampaignInput(validBody({ endDate: "2030-03-09" }), "submit", NOW).ok).toBe(false);
    expect(validateCampaignInput(validBody({ startDate: "2030-03-01", endDate: "2030-03-20" }), "submit", NOW).ok).toBe(false);
    expect(validateCampaignInput(validBody({ startDate: "2030-03-10", endDate: "2032-03-10" }), "submit", NOW).ok).toBe(false);
    expect(validateCampaignInput(validBody({ startDate: "2030-03-10", endDate: "2030-03-10" }), "submit", NOW).ok).toBe(true);
  });
  it("rejects HTML / script and over-long text", () => {
    expect(containsMarkup("<script>alert(1)</script>")).toBe(true);
    expect(containsMarkup("javascript:alert(1)")).toBe(true);
    expect(containsMarkup("Plain & simple")).toBe(false);
    expect(validateCampaignInput(validBody({ headline: "<b>hi</b>" }), "submit", NOW).ok).toBe(false);
    expect(validateCampaignInput(validBody({ description: "x".repeat(141) }), "submit", NOW).ok).toBe(false);
    expect(validateCampaignInput(validBody({ headline: "x".repeat(61) }), "submit", NOW).ok).toBe(false);
    expect(validateCampaignInput(validBody({ title: "" }), "submit", NOW).ok).toBe(false);
    expect(cleanText("  a \u0000\n b  ")).toBe("a b");
  });
  it("only implemented placements; channel_join only for channel campaigns; force_join is unavailable", () => {
    expect(isSelectablePlacement("library", "onfile_content")).toBe(true);
    expect(isSelectablePlacement("force_join", "telegram_channel")).toBe(false);
    expect(isSelectablePlacement("channel_join", "onfile_content")).toBe(false);
    expect(isSelectablePlacement("channel_join", "telegram_channel")).toBe(true);
    expect(isSelectablePlacement("homepage_takeover", "onfile_content")).toBe(false);
    expect(PLACEMENTS.find((p) => p.key === "force_join")?.available).toBe(false);
    expect(placementsForType("onfile_content").some((p) => p.key === "channel_join")).toBe(false);
    for (const bad of [["force_join"], ["nope"], [42], "library"]) expect(validateCampaignInput(validBody({ placements: bad }), "submit", NOW).ok).toBe(false);
    expect(validateCampaignInput(validBody({ placements: [] }), "submit", NOW).ok).toBe(false);
  });
  it("only measurable objectives per type", () => {
    expect(OBJECTIVES_BY_TYPE.onfile_content).not.toContain("verified_joins");
    expect(OBJECTIVES_BY_TYPE.telegram_post).not.toContain("verified_joins");
    expect(OBJECTIVES_BY_TYPE.telegram_channel).toContain("verified_joins");
    expect(validateCampaignInput(validBody({ objective: "verified_joins" }), "submit", NOW).ok).toBe(false);
    expect(validateCampaignInput(validBody({ objective: "content_access" }), "submit", NOW).ok).toBe(false);
  });
  it("targeting accepts only supported countries/languages", () => {
    expect(validateCampaignInput(validBody({ targeting: { countries: ["ZZ"] } }), "submit", NOW).ok).toBe(false);
    expect(validateCampaignInput(validBody({ targeting: { languages: ["xx"] } }), "submit", NOW).ok).toBe(false);
    expect(validateCampaignInput(validBody({ targeting: { devices: ["android"] } }), "submit", NOW).ok).toBe(true); // unknown dimension ignored
    const r = validateCampaignInput(validBody({ targeting: { countries: ["us", "US"] } }), "submit", NOW);
    expect(r.ok && r.value.targeting.countries).toEqual(["US"]);
  });
  it("ignores admin-controlled / counter fields entirely", () => {
    const r = validateCampaignInput(validBody({ status: "active", spent: "99", impressions: 1e6, clicks: 5, verifiedJoins: 9, unitPrice: "0.0001", paymentStatus: "confirmed", reviewedBy: 1, userId: 99, publicId: "AD-AAAAAAAA" }), "submit", NOW);
    expect(r.ok).toBe(true);
    if (r.ok) for (const k of ["status", "spent", "impressions", "clicks", "verifiedJoins", "unitPrice", "paymentStatus", "reviewedBy", "userId", "publicId"]) expect(k in r.value).toBe(false);
  });
});

describe("destination safety", () => {
  it("accepts only Onfile paths and https Telegram links", () => {
    expect(isSafeDestination("/f/abc_123")).toBe(true);
    expect(isSafeDestination("/p/AbC-123")).toBe(true);
    expect(isSafeDestination("https://t.me/somechannel")).toBe(true);
    expect(isSafeDestination("https://t.me/+AbCdEfGhIj")).toBe(true);
    for (const bad of ["javascript:alert(1)", "http://t.me/x", "https://evil.com/t.me", "https://t.me.evil.com/x", "https://user:pw@t.me/x", "//evil.com", "/f/../admin", "/admin", "data:text/html,hi", "", null, undefined]) {
      expect(isSafeDestination(bad as string | null), String(bad)).toBe(false);
    }
  });
});

describe("destination resolution (ownership + Telegram)", () => {
  const deps = (over: Partial<DestinationDeps> = {}): DestinationDeps => ({
    getOwnedFile: async (u, id) => (u === 1 && id === 10 ? { id: 10, title: "F", description: null, smartLinkSlug: "slug10", isPublished: true } : u === 1 && id === 11 ? { id: 11, title: "Draft", description: null, smartLinkSlug: null, isPublished: false } : null),
    getOwnedPlaylist: async (u, id) => (u === 1 && id === 20 ? { id: 20, title: "P", description: null, shareSlug: "shr", isPublished: true } : null),
    getOwnedChannel: async (u, id) => (u === 1 && id === 30 ? { id: 30, telegramChannelId: "-1001234567890", channelName: "Mine", channelUsername: null, status: "verified" } : null),
    listVerifiedChannels: async (u) => (u === 1 ? [{ id: 30, telegramChannelId: "-1001234567890" }] : []),
    lookupChat: async (id) => (id === "@publicone" ? { ok: true, chat: { id: -1009999999, type: "channel", title: "Public One", username: "publicone" } } : id === "@somegroup" ? { ok: true, chat: { id: -1008888888, type: "supergroup", title: "G", username: "somegroup" } } : { ok: false, reason: "not_found" }),
    botCanVerifyMembership: async () => "no",
    ...over,
  });
  const input = (o: Record<string, unknown>) => ({ adType: "onfile_content" as const, contentKind: null, fileId: null, playlistId: null, channelId: null, destinationRef: null, inviteLink: null, ...o });

  it("only the owner's published file resolves; someone else's looks 'not found'", async () => {
    const ok = await resolveDestination(input({ contentKind: "file", fileId: 10 }), 1, deps());
    expect(ok.ok && ok.value.targetUrl).toBe("/f/slug10");
    const other = await resolveDestination(input({ contentKind: "file", fileId: 10 }), 2, deps());
    expect(other.ok).toBe(false);
    expect(!other.ok && other.status).toBe(404);
    const unpublished = await resolveDestination(input({ contentKind: "file", fileId: 11 }), 1, deps());
    expect(unpublished.ok).toBe(false);
  });
  it("playlists must be shared + published", async () => {
    const ok = await resolveDestination(input({ contentKind: "playlist", playlistId: 20 }), 1, deps());
    expect(ok.ok && ok.value.targetUrl).toBe("/p/shr");
    expect((await resolveDestination(input({ contentKind: "playlist", playlistId: 20 }), 2, deps())).ok).toBe(false);
  });
  it("a connected private channel needs a valid invite link; verified joins follow the bot's live admin status", async () => {
    const base = input({ adType: "telegram_channel", channelId: 30 });
    expect((await resolveDestination(base, 1, deps())).ok).toBe(false); // no invite link
    expect((await resolveDestination({ ...base, inviteLink: "https://evil.com/+abcdef123456" }, 1, deps())).ok).toBe(false);
    const no = await resolveDestination({ ...base, inviteLink: "https://t.me/+AbCdEfGhIjKl" }, 1, deps());
    expect(no.ok && no.value.joinVerifiable).toBe(false);
    expect(no.ok && no.value.joinNote).toBeTruthy();
    const yes = await resolveDestination({ ...base, inviteLink: "https://t.me/+AbCdEfGhIjKl" }, 1, deps({ botCanVerifyMembership: async () => "yes" }));
    expect(yes.ok && yes.value.joinVerifiable).toBe(true);
    expect((await resolveDestination({ ...base, inviteLink: "https://t.me/+AbCdEfGhIjKl" }, 2, deps())).ok).toBe(false); // not their channel
  });
  it("external channels: only public channels confirmed by Telegram; ownership is never assumed", async () => {
    const r = await resolveDestination(input({ adType: "telegram_channel", destinationRef: "https://t.me/publicone" }), 1, deps());
    expect(r.ok && r.value.ownership).toBe("external");
    expect(r.ok && r.value.targetUrl).toBe("https://t.me/publicone");
    expect(r.ok && r.value.joinVerifiable).toBe(false);
    expect((await resolveDestination(input({ adType: "telegram_channel", destinationRef: "@nonexistent" }), 1, deps())).ok).toBe(false);
    expect((await resolveDestination(input({ adType: "telegram_channel", destinationRef: "@somegroup" }), 1, deps())).ok).toBe(false); // not a channel
    for (const bad of ["https://evil.com/publicone", "javascript:alert(1)", "ab", "", "@a b"]) {
      expect((await resolveDestination(input({ adType: "telegram_channel", destinationRef: bad }), 1, deps())).ok, bad).toBe(false);
    }
  });
  it("Telegram being unreachable is an error (503), never a pass", async () => {
    const r = await resolveDestination(input({ adType: "telegram_channel", destinationRef: "@publicone" }), 1, deps({ lookupChat: async () => ({ ok: false, reason: "unavailable" }) }));
    expect(r.ok).toBe(false);
    expect(!r.ok && r.status).toBe(503);
  });
  it("posts: public channel post links only; invalid / non-Telegram URLs rejected", async () => {
    const ok = await resolveDestination(input({ adType: "telegram_post", destinationRef: "https://t.me/publicone/42" }), 1, deps());
    expect(ok.ok && ok.value.targetUrl).toBe("https://t.me/publicone/42");
    for (const bad of ["https://evil.com/publicone/42", "javascript:alert(1)", "https://t.me/publicone", "https://t.me/+AbCdEfGhIjKl", "", "not a link", "https://t.me/publicone/0"]) {
      expect((await resolveDestination(input({ adType: "telegram_post", destinationRef: bad }), 1, deps())).ok, bad).toBe(false);
    }
    // a private-channel post can't be shown to a wider audience, even when it is the creator's own
    expect((await resolveDestination(input({ adType: "telegram_post", destinationRef: "https://t.me/c/1234567890/5" }), 1, deps())).ok).toBe(false);
  });
});

describe("Telegram membership logic", () => {
  it("isActiveMember follows Telegram's statuses", () => {
    for (const status of ["creator", "administrator", "member"]) expect(isActiveMember({ status })).toBe(true);
    expect(isActiveMember({ status: "restricted", is_member: true })).toBe(true);
    expect(isActiveMember({ status: "restricted", is_member: false })).toBe(false);
    expect(isActiveMember({ status: "left" })).toBe(false);
    expect(isActiveMember({ status: "kicked" })).toBe(false);
    expect(isActiveMember(null)).toBe(false);
  });
  const reply = (body: unknown) => vi.fn(async () => ({ json: async () => body }) as Response) as unknown as typeof fetch;
  it("getMembership maps answers, and treats failures as 'unavailable' (never 'not_member')", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "123:test";
    expect(await getMembership("-100", 1, reply({ ok: true, result: { status: "member" } }))).toBe("member");
    expect(await getMembership("-100", 1, reply({ ok: true, result: { status: "left" } }))).toBe("not_member");
    expect(await getMembership("-100", 1, reply({ ok: false, error_code: 400, description: "Bad Request: PARTICIPANT_ID_INVALID" }))).toBe("not_member");
    expect(await getMembership("-100", 1, reply({ ok: false, error_code: 400, description: "Bad Request: member list is inaccessible" }))).toBe("unavailable");
    expect(await getMembership("-100", 1, reply({ ok: false, error_code: 403, description: "Forbidden: bot is not a member of the channel chat" }))).toBe("unavailable");
    expect(await getMembership("-100", 1, vi.fn(async () => { throw new Error("boom"); }) as unknown as typeof fetch)).toBe("unavailable");
  });
  it("without a bot token nothing is verifiable", async () => {
    const saved = process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_BOT_TOKEN;
    expect(await getMembership("-100", 1, reply({ ok: true, result: { status: "member" } }))).toBe("unavailable");
    process.env.TELEGRAM_BOT_TOKEN = saved;
  });
});

describe("serve tokens & viewer keys", () => {
  it("round-trips and binds campaign + slot", () => {
    const t = signServeToken("AD-ABCDEFGH", "library", 1000, "k");
    expect(verifyServeToken(t, 2000, "k")).toMatchObject({ c: "AD-ABCDEFGH", s: "library" });
  });
  it("rejects tampering, wrong key, expiry and garbage", () => {
    const t = signServeToken("AD-ABCDEFGH", "library", 1000, "k");
    const [body, sig] = t.split(".");
    const forged = Buffer.from(JSON.stringify({ c: "AD-ZZZZZZZZ", s: "library", e: 9e15 })).toString("base64url");
    expect(verifyServeToken(`${forged}.${sig}`, 2000, "k")).toBeNull();
    expect(verifyServeToken(`${body}.${sig}x`, 2000, "k")).toBeNull();
    expect(verifyServeToken(t, 2000, "other")).toBeNull();
    expect(verifyServeToken(t, 1000 + 31 * 60 * 1000, "k")).toBeNull();
    for (const g of ["", "abc", "a.b.c", null, undefined, 5, "x".repeat(500)]) expect(verifyServeToken(g, 2000, "k")).toBeNull();
  });
  it("viewer keys are stable, opaque and don't contain the IP", () => {
    const a = viewerKeyFor(null, "1.2.3.4", "UA");
    expect(a).toBe(viewerKeyFor(null, "1.2.3.4", "UA"));
    expect(a).not.toContain("1.2.3.4");
    expect(a).not.toBe(viewerKeyFor(null, "1.2.3.5", "UA"));
    expect(viewerKeyFor(7, "1.2.3.4", "UA")).toBe("u7");
  });
  it("public ids look right and validate strictly", () => {
    for (let i = 0; i < 50; i++) expect(isValidPublicId(generatePublicId())).toBe(true);
    for (const bad of ["AD-1", "ad-ABCDEFGH", "AD-ABCDEFG0", "AD-ABCDEFGHI", "1; DROP TABLE", null]) expect(isValidPublicId(bad)).toBe(false);
  });
  it("de-duplication keys: impressions per placement/day, clicks per day", () => {
    const base = { campaignId: 1, viewerKey: "u1" };
    const d = new Date("2030-01-01T10:00:00Z");
    expect(dedupeKeyFor({ ...base, type: "impression", placement: "library" }, d)).not.toBe(dedupeKeyFor({ ...base, type: "impression", placement: "file_access" }, d));
    expect(dedupeKeyFor({ ...base, type: "click", placement: "library" }, d)).toBe(dedupeKeyFor({ ...base, type: "click", placement: "file_access" }, d));
    expect(dedupeKeyFor({ ...base, type: "click", placement: "library" }, d)).not.toBe(dedupeKeyFor({ ...base, type: "click", placement: "library" }, new Date("2030-01-02T00:00:00Z")));
  });
});

describe("targeting", () => {
  it("empty = everyone; a set list needs a KNOWN matching value", () => {
    expect(matchesTargeting({ countries: [], languages: [] }, { country: null, language: null })).toBe(true);
    expect(matchesTargeting(undefined, { country: null, language: null })).toBe(true);
    expect(matchesTargeting({ countries: ["US"], languages: [] }, { country: "US", language: null })).toBe(true);
    expect(matchesTargeting({ countries: ["US"], languages: [] }, { country: "DE", language: null })).toBe(false);
    expect(matchesTargeting({ countries: ["US"], languages: [] }, { country: null, language: null })).toBe(false);
    expect(matchesTargeting({ countries: [], languages: ["en"] }, { country: null, language: "en-US" })).toBe(true);
    expect(matchesTargeting({ countries: [], languages: ["en"] }, { country: null, language: null })).toBe(false);
    expect(matchesTargeting({ countries: ["US"], languages: ["en"] }, { country: "US", language: "ru" })).toBe(false);
  });
  it("country header parsing ignores junk", () => {
    expect(viewerCountryFromHeaders(new Headers({ "x-vercel-ip-country": "de" }))).toBe("DE");
    expect(viewerCountryFromHeaders(new Headers({ "x-vercel-ip-country": "XX" }))).toBeNull();
    expect(viewerCountryFromHeaders(new Headers({ "x-vercel-ip-country": "<script>" }))).toBeNull();
    expect(viewerCountryFromHeaders(new Headers())).toBeNull();
  });
});

describe("overview + admin input", () => {
  it("overview comes only from the rows given; 'verified joins' is null when no join campaign exists", () => {
    const o = buildOverview([
      { status: "active", impressions: 10, clicks: 2, verifiedJoins: 0, spent: "1.5", objective: "clicks" },
      { status: "draft", impressions: 0, clicks: 0, verifiedJoins: 0, spent: "0", objective: null },
    ]);
    expect(o).toMatchObject({ totalCampaigns: 2, activeCampaigns: 1, impressions: 10, clicks: 2, verifiedJoins: null, spent: 1.5 });
    expect(o.counts).toMatchObject({ all: 2, draft: 1, active: 1, pending: 0 });
    expect(buildOverview([]).totalCampaigns).toBe(0);
    expect(buildOverview([{ status: "active", impressions: 0, clicks: 0, verifiedJoins: 3, spent: "0", objective: "verified_joins" }]).verifiedJoins).toBe(3);
  });
  it("unit price + rejection reason parsing", () => {
    expect(parseUnitPrice("0.05")).toEqual({ ok: true, value: "0.050000" });
    for (const bad of ["", "0", "-1", "abc", "1001", "0.1234567"]) expect(parseUnitPrice(bad).ok, bad).toBe(false);
    expect(parseReason("Not allowed").ok).toBe(true);
    expect(parseReason("").ok).toBe(false);
    expect(parseReason("ab").ok).toBe(false);
    expect(parseReason("<b>x</b> bad").ok).toBe(false);
    expect(parseReason("x".repeat(501)).ok).toBe(false);
  });
});
