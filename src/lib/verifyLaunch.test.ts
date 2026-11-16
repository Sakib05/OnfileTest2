import { describe, expect, it } from "vitest";
import { interpretVerifyResponse, verifyFailureMessage, VERIFY_ERROR_COPY } from "@/lib/verifyLaunch";

const ok = { ok: true };
const channel = { id: 3, channelName: "C", channelUsername: null, status: "verified" };

describe("interpretVerifyResponse — only a server-confirmed, verified channel is 'verified'", () => {
  it("verified + 200 + verified channel → verified (client-visible summary only)", () => {
    expect(interpretVerifyResponse(ok, { status: "verified", channel: { ...channel, telegramChannelId: "-100123" } })).toEqual({
      kind: "verified",
      channel: { id: 3, channelName: "C", channelUsername: null },
    });
  });

  it("anything short of that is NOT verified", () => {
    const notVerified = [
      interpretVerifyResponse({ ok: false }, { status: "verified", channel }), // non-2xx
      interpretVerifyResponse(ok, { status: "verified" }), // no channel
      interpretVerifyResponse(ok, { status: "verified", channel: { ...channel, status: "disconnected" } }),
      interpretVerifyResponse(ok, { status: "verified", channel: { ...channel, id: "3" } }),
      interpretVerifyResponse(ok, null),
      interpretVerifyResponse(ok, {}),
      interpretVerifyResponse(ok, { status: "something-new" }),
    ];
    for (const outcome of notVerified) expect(outcome.kind).not.toBe("verified");
  });

  it("maps the other server verdicts", () => {
    expect(interpretVerifyResponse(ok, { status: "pending", stage: "verifying" }).kind).toBe("verifying");
    expect(interpretVerifyResponse(ok, { status: "pending", stage: "awaiting_selection" }).kind).toBe("awaiting_selection");
    expect(interpretVerifyResponse(ok, { status: "pending" }).kind).toBe("awaiting_selection");
    expect(interpretVerifyResponse({ ok: false }, { status: "expired" }).kind).toBe("expired");
    expect(interpretVerifyResponse(ok, { status: "failed", error: "nope", reason: "x" })).toEqual({ kind: "failed", message: "nope", reason: "x" });
    expect(interpretVerifyResponse({ ok: false }, { status: "unauthorized" })).toEqual({ kind: "unauthorized", message: VERIFY_ERROR_COPY.unauthorized });
  });

  it("every non-verified outcome has a human-readable message", () => {
    for (const outcome of [
      { kind: "verifying" as const },
      { kind: "awaiting_selection" as const },
      { kind: "expired" as const },
      { kind: "error" as const },
      { kind: "failed" as const, message: "failed message" },
      { kind: "unauthorized" as const, message: "unauthorized message" },
    ]) {
      expect(verifyFailureMessage(outcome).length).toBeGreaterThan(5);
    }
  });
});
