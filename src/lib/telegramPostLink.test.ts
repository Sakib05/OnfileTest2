import { describe, expect, it } from "vitest";
import { parseTelegramPostLink, postIdentityKey, toInternalChannelId } from "@/lib/telegramPostLink";

function ok(raw: string) {
  const r = parseTelegramPostLink(raw);
  if (!r.ok) throw new Error(`expected ok for ${raw}, got ${r.reason}`);
  return r.link;
}
function reason(raw: unknown) {
  const r = parseTelegramPostLink(raw);
  if (r.ok) throw new Error(`expected failure for ${String(raw)}`);
  return r.reason;
}

describe("parseTelegramPostLink — private channel links", () => {
  it("parses https://t.me/c/<id>/<msg> and keeps channel and message separate", () => {
    const l = ok("https://t.me/c/1234567890/125");
    expect(l).toMatchObject({
      kind: "private",
      internalChannelId: "1234567890",
      telegramChatId: "-1001234567890",
      messageId: 125,
      canonicalLink: "https://t.me/c/1234567890/125",
    });
  });

  it("accepts missing scheme, www, telegram.me, query and fragment", () => {
    for (const raw of [
      "t.me/c/1234567890/125",
      "http://www.t.me/c/1234567890/125",
      "https://telegram.me/c/1234567890/125?single",
      "https://t.me/c/1234567890/125#x",
      "  https://t.me/c/1234567890/125\n",
    ]) {
      expect(ok(raw)).toMatchObject({ kind: "private", internalChannelId: "1234567890", messageId: 125 });
    }
  });

  it("uses the LAST segment as the message id in the thread form", () => {
    expect(ok("https://t.me/c/1234567890/12/125")).toMatchObject({ internalChannelId: "1234567890", messageId: 125 });
  });

  it("parses the tg://privatepost deep link", () => {
    expect(ok("tg://privatepost?channel=1234567890&post=125")).toMatchObject({
      kind: "private",
      internalChannelId: "1234567890",
      messageId: 125,
    });
  });

  it("rejects a /c/ link with no post, a bad id, or a bad message id", () => {
    expect(reason("https://t.me/c/1234567890")).toBe("channel_link_without_post");
    expect(reason("https://t.me/c/abc/125")).toBe("unsupported_link");
    expect(reason("https://t.me/c/1234567890/abc")).toBe("invalid_message_id");
    expect(reason("https://t.me/c/1234567890/0")).toBe("invalid_message_id");
    expect(reason("https://t.me/c/1234567890/99999999999")).toBe("invalid_message_id");
    expect(reason("https://t.me/c/1234567890/1/2/3")).toBe("unsupported_link");
  });
});

describe("parseTelegramPostLink — public links", () => {
  it("parses t.me/<username>/<msg> and lower-cases the username", () => {
    expect(ok("https://t.me/MyChannel/42")).toMatchObject({ kind: "public", username: "mychannel", messageId: 42 });
  });
  it("parses the /s/ web-preview form and tg://resolve", () => {
    expect(ok("https://t.me/s/mychannel/42")).toMatchObject({ kind: "public", username: "mychannel", messageId: 42 });
    expect(ok("tg://resolve?domain=mychannel&post=42")).toMatchObject({ kind: "public", username: "mychannel", messageId: 42 });
  });
  it("rejects a bare channel link", () => {
    expect(reason("https://t.me/mychannel")).toBe("channel_link_without_post");
  });
});

describe("parseTelegramPostLink — invalid input", () => {
  it("rejects empty / non-string input", () => {
    expect(reason("")).toBe("empty");
    expect(reason("   ")).toBe("empty");
    expect(reason(undefined)).toBe("empty");
    expect(reason(123)).toBe("empty");
  });
  it("rejects invite links explicitly", () => {
    expect(reason("https://t.me/+AbCdEfGhIjKlMnOp")).toBe("invite_link");
    expect(reason("https://t.me/joinchat/AbCdEfGhIjKlMnOp")).toBe("invite_link");
  });
  it("rejects non-Telegram hosts, look-alike hosts and other schemes", () => {
    expect(reason("https://example.com/c/1234567890/125")).toBe("not_telegram_link");
    expect(reason("https://t.me.evil.com/c/1234567890/125")).toBe("not_telegram_link");
    expect(reason("https://evil.com/t.me/c/1234567890/125")).toBe("not_telegram_link");
    expect(reason("javascript:alert(1)")).toBe("invalid_url");
    expect(reason("ftp://t.me/c/1234567890/125")).toBe("invalid_url");
    expect(reason("https://user:pw@t.me/c/1234567890/125")).toBe("invalid_url");
  });
  it("rejects malformed and unsupported shapes", () => {
    expect(reason("not a link")).toBe("invalid_url");
    expect(reason("https://t.me/")).toBe("unsupported_link");
    expect(reason("https://t.me/addstickers/foo")).toBe("unsupported_link");
    expect(reason("https://t.me/share/url")).toBe("unsupported_link");
    expect(reason("tg://msg?text=hi")).toBe("unsupported_link");
    expect(reason("x".repeat(600))).toBe("too_long");
    expect(ok("https://t.me/c/1234567890/125/")).toMatchObject({ messageId: 125 });
  });
});

describe("helpers", () => {
  it("postIdentityKey is stable across link variants", () => {
    expect(postIdentityKey(ok("t.me/c/1234567890/125?single"))).toBe(postIdentityKey(ok("https://t.me/c/1234567890/9/125")));
    expect(postIdentityKey(ok("https://t.me/c/1234567890/125"))).not.toBe(postIdentityKey(ok("https://t.me/c/1234567890/126")));
  });
  it("toInternalChannelId normalizes stored ids", () => {
    expect(toInternalChannelId("-1001234567890")).toBe("1234567890");
    expect(toInternalChannelId("1234567890")).toBe("1234567890");
    expect(toInternalChannelId("-123")).toBeNull();
    expect(toInternalChannelId(null)).toBeNull();
  });
});
