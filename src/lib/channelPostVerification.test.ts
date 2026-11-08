import { describe, expect, it, vi } from "vitest";
import {
  verifyPostLinkAgainstChannels,
  VERIFY_FAILURE_MESSAGES,
  type ConnectedChannelRef,
  type PublicChatResolver,
} from "@/lib/channelPostVerification";

const mine: ConnectedChannelRef = {
  id: 7,
  telegramChannelId: "-1001234567890",
  channelName: "My Private Channel",
  channelUsername: null,
};
const neverCalled: PublicChatResolver = vi.fn(async () => ({ ok: false as const, reason: "unavailable" as const }));

describe("verifyPostLinkAgainstChannels — private links (channel id comparison)", () => {
  it("accepts a link whose channel id equals the connected channel", async () => {
    const r = await verifyPostLinkAgainstChannels("https://t.me/c/1234567890/125", [mine], neverCalled);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.post.channel).toMatchObject({ id: 7, name: "My Private Channel" });
      expect(r.post.messageId).toBe(125);
      expect(r.post.canonicalLink).toBe("https://t.me/c/1234567890/125");
      // The message itself is never claimed to be verified.
      expect(r.post.messageExistenceVerified).toBe(false);
    }
    expect(neverCalled).not.toHaveBeenCalled();
  });

  it("rejects a link from a different channel (403 channel_mismatch)", async () => {
    const r = await verifyPostLinkAgainstChannels("https://t.me/c/9999999999/125", [mine], neverCalled);
    expect(r).toMatchObject({ ok: false, reason: "channel_mismatch", status: 403 });
    if (!r.ok) expect(r.message).toBe("This post does not belong to your connected Telegram channel.");
  });

  it("does not match on message id or a prefix/suffix of the channel id", async () => {
    expect((await verifyPostLinkAgainstChannels("https://t.me/c/12345/125", [mine], neverCalled)).ok).toBe(false);
    expect((await verifyPostLinkAgainstChannels("https://t.me/c/123456789012/125", [mine], neverCalled)).ok).toBe(false);
    expect((await verifyPostLinkAgainstChannels("https://t.me/c/1234567890/1", [mine], neverCalled)).ok).toBe(true);
  });

  it("matches when the stored id has no -100 prefix", async () => {
    const r = await verifyPostLinkAgainstChannels("t.me/c/1234567890/5", [{ ...mine, telegramChannelId: "1234567890" }], neverCalled);
    expect(r.ok).toBe(true);
  });

  it("matches any of the creator's own verified channels", async () => {
    const other: ConnectedChannelRef = { id: 8, telegramChannelId: "-1005555555555", channelName: "B", channelUsername: null };
    const r = await verifyPostLinkAgainstChannels("https://t.me/c/5555555555/3", [mine, other], neverCalled);
    expect(r.ok && r.post.channel.id).toBe(8);
  });
});

describe("verifyPostLinkAgainstChannels — no connected channel / invalid", () => {
  it("returns no_connected_channel (403) when the creator has none", async () => {
    const r = await verifyPostLinkAgainstChannels("https://t.me/c/1234567890/125", [], neverCalled);
    expect(r).toMatchObject({ ok: false, reason: "no_connected_channel", status: 403 });
  });

  it("ignores channel rows without a resolvable Telegram id", async () => {
    const r = await verifyPostLinkAgainstChannels(
      "https://t.me/c/1234567890/125",
      [{ id: 1, telegramChannelId: null, channelName: "x", channelUsername: null }],
      neverCalled
    );
    expect(r).toMatchObject({ ok: false, reason: "no_connected_channel" });
  });

  it("returns 400 for malformed / unsupported / empty links before looking at channels", async () => {
    for (const bad of ["", "nonsense", "https://example.com/x", "https://t.me/+AbCdEfGhIjKl", "https://t.me/c/1234567890"]) {
      const r = await verifyPostLinkAgainstChannels(bad, [mine], neverCalled);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.status).toBe(400);
    }
  });
});

describe("verifyPostLinkAgainstChannels — public links (id resolved via Telegram, never username compare)", () => {
  it("accepts when the username resolves to the connected channel id", async () => {
    const resolver: PublicChatResolver = vi.fn(async () => ({ ok: true as const, id: "-1001234567890", type: "channel" }));
    // Stored username deliberately different: usernames are NOT compared.
    const r = await verifyPostLinkAgainstChannels("https://t.me/SomeName/9", [{ ...mine, channelUsername: "stale_name" }], resolver);
    expect(r.ok).toBe(true);
    expect(resolver).toHaveBeenCalledWith("somename");
  });

  it("rejects when the username resolves to another channel", async () => {
    const resolver: PublicChatResolver = async () => ({ ok: true, id: "-1007777777777", type: "channel" });
    // Same username as stored must NOT help if the ids differ.
    const r = await verifyPostLinkAgainstChannels("https://t.me/samename/9", [{ ...mine, channelUsername: "samename" }], resolver);
    expect(r).toMatchObject({ ok: false, reason: "channel_mismatch" });
  });

  it("treats an unknown username as a mismatch", async () => {
    const r = await verifyPostLinkAgainstChannels("https://t.me/ghostname/9", [mine], async () => ({ ok: false, reason: "not_found" }));
    expect(r).toMatchObject({ ok: false, reason: "channel_mismatch" });
  });

  it("never silently accepts when Telegram cannot be reached", async () => {
    const r = await verifyPostLinkAgainstChannels("https://t.me/somename/9", [{ ...mine, channelUsername: "somename" }], async () => ({
      ok: false,
      reason: "unavailable",
    }));
    expect(r).toMatchObject({ ok: false, reason: "verification_unavailable", status: 503 });
    if (!r.ok) expect(r.message).toBe(VERIFY_FAILURE_MESSAGES.verification_unavailable);
  });
});
