import { describe, expect, it } from "vitest";
import { validatePrivateInviteLink } from "@/lib/inviteLink";

describe("validatePrivateInviteLink — accepted private invite link formats (Bug 1)", () => {
  const validLinks = [
    "https://t.me/+AbCdEfGhIjKlMnOp",
    "http://t.me/+AbCdEfGhIjKlMnOp",
    "t.me/+AbCdEfGhIjKlMnOp",
    "https://t.me/joinchat/AbCdEfGhIjKlMnOp",
    "t.me/joinchat/AbCdEfGhIjKlMnOp",
  ];

  for (const link of validLinks) {
    it(`accepts "${link}"`, () => {
      const result = validatePrivateInviteLink(link);
      expect(result.ok).toBe(true);
    });
  }

  it("handles surrounding whitespace safely", () => {
    const result = validatePrivateInviteLink("   https://t.me/+AbCdEfGhIjKlMnOp   \n");
    expect(result.ok).toBe(true);
  });

  it("handles a trailing slash", () => {
    const result = validatePrivateInviteLink("https://t.me/+AbCdEfGhIjKlMnOp/");
    expect(result.ok).toBe(true);
  });

  it("is case-insensitive for scheme and host", () => {
    const result = validatePrivateInviteLink("HTTPS://T.ME/+AbCdEfGhIjKlMnOp");
    expect(result.ok).toBe(true);
  });

  it("normalizes to a canonical https URL", () => {
    const result = validatePrivateInviteLink("t.me/+AbCdEfGhIjKlMnOp");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.link.normalizedUrl).toBe("https://t.me/+AbCdEfGhIjKlMnOp");
      expect(result.link.kind).toBe("plus");
      expect(result.link.hash).toBe("AbCdEfGhIjKlMnOp");
    }
  });

  it("handles a percent-encoded plus sign", () => {
    const result = validatePrivateInviteLink("https://t.me/%2BAbCdEfGhIjKlMnOp");
    expect(result.ok).toBe(true);
  });
});

describe("validatePrivateInviteLink — rejections", () => {
  it("rejects empty input", () => {
    const result = validatePrivateInviteLink("");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("empty");
  });

  it("rejects whitespace-only input", () => {
    const result = validatePrivateInviteLink("   \n\t  ");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("empty");
  });

  it("rejects a public channel username link", () => {
    const result = validatePrivateInviteLink("https://t.me/your_channel");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("public_channel_link");
  });

  it("rejects a bare @username", () => {
    const result = validatePrivateInviteLink("@your_channel");
    expect(result.ok).toBe(false);
  });

  it("rejects an invalid URL", () => {
    const result = validatePrivateInviteLink("not a url at all ???");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("invalid_url");
  });

  it("rejects an unrelated domain", () => {
    const result = validatePrivateInviteLink("https://example.com/+AbCdEfGhIjKlMnOp");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("invalid_url");
  });

  it("rejects an unrelated Telegram URL", () => {
    const result = validatePrivateInviteLink("https://t.me/share/url?url=https://example.com");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("unsupported_telegram_link");
  });

  it("rejects a malformed invite hash that is too short", () => {
    const result = validatePrivateInviteLink("https://t.me/+ab");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("malformed_invite_hash");
  });

  it("rejects an invite hash with invalid characters", () => {
    const result = validatePrivateInviteLink("https://t.me/+abc def!!!");
    expect(result.ok).toBe(false);
  });

  it("rejects a malformed joinchat link with no hash", () => {
    const result = validatePrivateInviteLink("https://t.me/joinchat/");
    expect(result.ok).toBe(false);
  });

  it("never classifies a private invite link as a public channel link", () => {
    const result = validatePrivateInviteLink("https://t.me/+AbCdEfGhIjKlMnOp");
    expect(result.ok).toBe(true);
  });

  it("never classifies a public channel link as a valid private invite link", () => {
    const result = validatePrivateInviteLink("https://t.me/joinchat"); // missing hash segment entirely
    expect(result.ok).toBe(false);
  });
});
