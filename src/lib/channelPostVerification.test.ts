import { describe, expect, it, vi } from "vitest";
import {
  verifyPostLinkAgainstChannels,
  VERIFY_FAILURE_MESSAGES,
  type ConnectedChannelRef,
  type PostExistenceChecker,
  type PublicChatResolver,
} from "@/lib/channelPostVerification";

const mine: ConnectedChannelRef = {
  id: 7,
  telegramChannelId: "-1001234567890",
  channelName: "My Private Channel",
  channelUsername: null,
};
const existsOk: PostExistenceChecker = vi.fn(async () => ({ ok: true as const }));
const neverCalled: PublicChatResolver = vi.fn(async () => ({ ok: false as const, reason: "unavailable" as const }));

describe("verifyPostLinkAgainstChannels — private links (channel id comparison)", () => {
  it("accepts a link whose channel id equals the connected channel", async () => {
    const r = await verifyPostLinkAgainstChannels("https://t.me/c/1234567890/125", [mine], neverCalled, existsOk);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.post.channel).toMatchObject({ id: 7, name: "My Private Channel" });
      expect(r.post.messageId).toBe(125);
      expect(r.post.canonicalLink).toBe("https://t.me/c/1234567890/125");
      // Only claimed because the (injected) existence check answered ok.
      expect(r.post.messageExistenceVerified).toBe(true);
    }
    expect(neverCalled).not.toHaveBeenCalled();
  });

  it("rejects a link from a different channel (403 channel_mismatch)", async () => {
    const r = await verifyPostLinkAgainstChannels("https://t.me/c/9999999999/125", [mine], neverCalled, existsOk);
    expect(r).toMatchObject({ ok: false, reason: "channel_mismatch", status: 403 });
    if (!r.ok) expect(r.message).toBe("This post does not belong to your connected Telegram channel.");
  });

  it("does not match on message id or a prefix/suffix of the channel id", async () => {
    expect((await verifyPostLinkAgainstChannels("https://t.me/c/12345/125", [mine], neverCalled, existsOk)).ok).toBe(false);
    expect((await verifyPostLinkAgainstChannels("https://t.me/c/123456789012/125", [mine], neverCalled, existsOk)).ok).toBe(false);
    expect((await verifyPostLinkAgainstChannels("https://t.me/c/1234567890/1", [mine], neverCalled, existsOk)).ok).toBe(true);
  });

  it("matches when the stored id has no -100 prefix", async () => {
    const r = await verifyPostLinkAgainstChannels("t.me/c/1234567890/5", [{ ...mine, telegramChannelId: "1234567890" }], neverCalled, existsOk);
    expect(r.ok).toBe(true);
  });

  it("matches any of the creator's own verified channels", async () => {
    const other: ConnectedChannelRef = { id: 8, telegramChannelId: "-1005555555555", channelName: "B", channelUsername: null };
    const r = await verifyPostLinkAgainstChannels("https://t.me/c/5555555555/3", [mine, other], neverCalled, existsOk);
    expect(r.ok && r.post.channel.id).toBe(8);
  });
});

describe("verifyPostLinkAgainstChannels — no connected channel / invalid", () => {
  it("returns no_connected_channel (403) when the creator has none", async () => {
    const r = await verifyPostLinkAgainstChannels("https://t.me/c/1234567890/125", [], neverCalled, existsOk);
    expect(r).toMatchObject({ ok: false, reason: "no_connected_channel", status: 403 });
  });

  it("ignores channel rows without a resolvable Telegram id", async () => {
    const r = await verifyPostLinkAgainstChannels(
      "https://t.me/c/1234567890/125",
      [{ id: 1, telegramChannelId: null, channelName: "x", channelUsername: null }],
      neverCalled, existsOk);
    expect(r).toMatchObject({ ok: false, reason: "no_connected_channel" });
  });

  it("returns 400 for malformed / unsupported / empty links before looking at channels", async () => {
    for (const bad of ["", "nonsense", "https://example.com/x", "https://t.me/+AbCdEfGhIjKl", "https://t.me/c/1234567890"]) {
      const r = await verifyPostLinkAgainstChannels(bad, [mine], neverCalled, existsOk);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.status).toBe(400);
    }
  });
});

describe("verifyPostLinkAgainstChannels — public links (id resolved via Telegram, never username compare)", () => {
  it("accepts when the username resolves to the connected channel id", async () => {
    const resolver: PublicChatResolver = vi.fn(async () => ({ ok: true as const, id: "-1001234567890", type: "channel" }));
    // Stored username deliberately different: usernames are NOT compared.
    const r = await verifyPostLinkAgainstChannels("https://t.me/SomeName/9", [{ ...mine, channelUsername: "stale_name" }], resolver, existsOk);
    expect(r.ok).toBe(true);
    expect(resolver).toHaveBeenCalledWith("somename");
  });

  it("rejects when the username resolves to another channel", async () => {
    const resolver: PublicChatResolver = async () => ({ ok: true, id: "-1007777777777", type: "channel" });
    // Same username as stored must NOT help if the ids differ.
    const r = await verifyPostLinkAgainstChannels("https://t.me/samename/9", [{ ...mine, channelUsername: "samename" }], resolver, existsOk);
    expect(r).toMatchObject({ ok: false, reason: "channel_mismatch" });
  });

  it("treats an unknown username as a mismatch", async () => {
    const r = await verifyPostLinkAgainstChannels("https://t.me/ghostname/9", [mine], async () => ({ ok: false, reason: "not_found" }), existsOk);
    expect(r).toMatchObject({ ok: false, reason: "channel_mismatch" });
  });

  it("never silently accepts when Telegram cannot be reached", async () => {
    const r = await verifyPostLinkAgainstChannels("https://t.me/somename/9", [{ ...mine, channelUsername: "somename" }], async () => ({
      ok: false,
      reason: "unavailable",
    }), existsOk);
    expect(r).toMatchObject({ ok: false, reason: "verification_unavailable", status: 503 });
    if (!r.ok) expect(r.message).toBe(VERIFY_FAILURE_MESSAGES.verification_unavailable);
  });
});


// ─────────────────────────────────────────────────────────────────────────────
// Exact message-id existence. The checker below is a SIMULATED Telegram (a stub
// that answers like Telegram's documented copyMessage responses). These tests prove
// the decision logic fails closed; they are NOT proof of a real Telegram post.
// ─────────────────────────────────────────────────────────────────────────────
describe("verifyPostLinkAgainstChannels — exact post existence (simulated Telegram)", () => {
  const channel = { ...mine, telegramChannelId: "-1004447210820" };
  // Simulated channel that only contains message ids 1..15.
  const telegramWith15 = (): PostExistenceChecker =>
    vi.fn(async ({ chatId, messageId }) => {
      if (chatId !== "-1004447210820") return { ok: false as const, reason: "bot_no_access" as const };
      return messageId >= 1 && messageId <= 15 ? { ok: true as const } : { ok: false as const, reason: "post_not_found" as const };
    });

  it("accepts existing post #15 and checks that exact message id against the connected channel's -100 id", async () => {
    const check = telegramWith15();
    const r = await verifyPostLinkAgainstChannels("https://t.me/c/4447210820/15", [channel], neverCalled, check);
    expect(r.ok).toBe(true);
    expect(check).toHaveBeenCalledWith({ chatId: "-1004447210820", messageId: 15 });
  });

  it("REJECTS non-existent post #152 in the same channel (valid format + matching channel is not enough)", async () => {
    const check = telegramWith15();
    const r = await verifyPostLinkAgainstChannels("https://t.me/c/4447210820/152", [channel], neverCalled, check);
    expect(r).toMatchObject({ ok: false, reason: "post_not_found", status: 404 });
    if (!r.ok) expect(r.message).toBe("Post not found. Please check the Telegram post link and try again.");
    expect(check).toHaveBeenCalledWith({ chatId: "-1004447210820", messageId: 152 });
  });

  it("rejects a post from another channel WITHOUT asking Telegram about it", async () => {
    const check = telegramWith15();
    const r = await verifyPostLinkAgainstChannels("https://t.me/c/1112223334/15", [channel], neverCalled, check);
    expect(r).toMatchObject({ ok: false, reason: "channel_mismatch" });
    expect(check).not.toHaveBeenCalled();
  });

  it("rejects an invalid Telegram URL without asking Telegram", async () => {
    const check = telegramWith15();
    for (const bad of ["https://t.me/c/4447210820", "https://example.com/c/4447210820/15", "hello", "https://t.me/c/4447210820/0"]) {
      const r = await verifyPostLinkAgainstChannels(bad, [channel], neverCalled, check);
      expect(r.ok).toBe(false);
    }
    expect(check).not.toHaveBeenCalled();
  });

  it.each([
    ["post_not_copyable", 422],
    ["bot_no_access", 403],
    ["probe_chat_unavailable", 409],
    ["unavailable", 503],
  ] as const)("a '%s' answer is a rejection (status %i), never acceptance", async (reason, status) => {
    const r = await verifyPostLinkAgainstChannels("https://t.me/c/4447210820/15", [channel], neverCalled, async () => ({ ok: false, reason }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(status);
  });

  it("a timeout / thrown error from the checker is a 503 rejection", async () => {
    const r = await verifyPostLinkAgainstChannels("https://t.me/c/4447210820/15", [channel], neverCalled, async () => {
      throw new Error("timeout");
    });
    expect(r).toMatchObject({ ok: false, reason: "post_verification_unavailable", status: 503 });
  });

  it("fails closed on a malformed checker answer (anything but an explicit ok:true)", async () => {
    for (const weird of [undefined, null, {}, { ok: "true" }, { ok: 1 }]) {
      const r = await verifyPostLinkAgainstChannels(
        "https://t.me/c/4447210820/15",
        [channel],
        neverCalled,
        (async () => weird) as unknown as PostExistenceChecker
      );
      expect(r.ok).toBe(false);
    }
  });

  it("public-style links are existence-checked against the connected channel id too", async () => {
    const check = telegramWith15();
    const resolver: PublicChatResolver = async () => ({ ok: true, id: "-1004447210820", type: "channel" });
    const bad = await verifyPostLinkAgainstChannels("https://t.me/somename/152", [channel], resolver, check);
    expect(bad).toMatchObject({ ok: false, reason: "post_not_found" });
    const good = await verifyPostLinkAgainstChannels("https://t.me/somename/15", [channel], resolver, check);
    expect(good.ok).toBe(true);
  });

  it("correcting an invalid link (#152 → #15) is accepted on the next attempt", async () => {
    const check = telegramWith15();
    expect((await verifyPostLinkAgainstChannels("https://t.me/c/4447210820/152", [channel], neverCalled, check)).ok).toBe(false);
    expect((await verifyPostLinkAgainstChannels("https://t.me/c/4447210820/15", [channel], neverCalled, check)).ok).toBe(true);
  });
});
