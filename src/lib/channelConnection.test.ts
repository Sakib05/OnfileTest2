import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import {
  CHANNEL_FAILURE_MESSAGES,
  PUBLIC_CHANNEL_ERROR_TITLE,
  resolveConnectingIdentity,
} from "@/lib/channelConnection";
import { createSetupToken, SETUP_COOKIE_NAME } from "@/lib/setupToken";

describe("Public channel rejection copy (must remain unchanged)", () => {
  it("keeps the exact required title", () => {
    expect(PUBLIC_CHANNEL_ERROR_TITLE).toBe("Public Channel Not Supported");
  });

  it("keeps the exact required message", () => {
    expect(CHANNEL_FAILURE_MESSAGES.channel_is_public).toBe(
      "Onfile only supports private Telegram channels. Please remove the Onfile Bot from this public channel and select a private channel instead."
    );
  });
});

describe("resolveConnectingIdentity — never trusts client-supplied Telegram ids", () => {
  it("rejects a request with no session and no setup cookie", async () => {
    const req = new NextRequest("http://localhost/api/channels/connect-manual", { method: "POST" });
    const result = await resolveConnectingIdentity(req);
    expect(result.ok).toBe(false);
  });

  it("resolves identity strictly from the signed setup cookie, not from any request body/header", async () => {
    process.env.SETUP_TOKEN_SECRET = process.env.SETUP_TOKEN_SECRET || "test-setup-secret";
    const token = createSetupToken({ id: 555444333, first_name: "Test", username: "tester" });

    const req = new NextRequest("http://localhost/api/channels/connect-manual", {
      method: "POST",
      headers: {
        cookie: `${SETUP_COOKIE_NAME}=${token}`,
        // Even if a caller tried to smuggle a different Telegram id via a
        // header, resolveConnectingIdentity must never read it.
        "x-telegram-user-id": "1",
      },
    });

    const result = await resolveConnectingIdentity(req);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.identity.telegramUserId).toBe(555444333);
      expect(result.identity.sessionUserId).toBeNull();
    }
  });

  it("rejects a tampered setup cookie", async () => {
    process.env.SETUP_TOKEN_SECRET = process.env.SETUP_TOKEN_SECRET || "test-setup-secret";
    const token = createSetupToken({ id: 555444333, first_name: "Test" });
    const tampered = token.slice(0, -2) + "xx";

    const req = new NextRequest("http://localhost/api/channels/connect-manual", {
      method: "POST",
      headers: { cookie: `${SETUP_COOKIE_NAME}=${tampered}` },
    });

    const result = await resolveConnectingIdentity(req);
    expect(result.ok).toBe(false);
  });
});
