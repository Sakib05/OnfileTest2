import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchVerifyOutcome, interpretVerifyResponse, submitVerification, verifyFailureMessage, VERIFY_ERROR_COPY } from "@/lib/verifyLaunch";

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
    expect(interpretVerifyResponse(ok, { status: "pending", stage: "channel_selected" }).kind).toBe("channel_selected");
    expect(interpretVerifyResponse({ ok: false }, { status: "expired" }).kind).toBe("expired");
    expect(interpretVerifyResponse(ok, { status: "failed", error: "nope", reason: "x" })).toEqual({ kind: "failed", message: "nope", reason: "x" });
    expect(interpretVerifyResponse({ ok: false }, { status: "unauthorized" })).toEqual({ kind: "unauthorized", message: VERIFY_ERROR_COPY.unauthorized });
  });

  it("every non-verified outcome has a human-readable message", () => {
    for (const outcome of [
      { kind: "verifying" as const },
      { kind: "awaiting_selection" as const },
      { kind: "channel_selected" as const },
      { kind: "expired" as const },
      { kind: "error" as const },
      { kind: "failed" as const, message: "failed message" },
      { kind: "unauthorized" as const, message: "unauthorized message" },
    ]) {
      expect(verifyFailureMessage(outcome).length).toBeGreaterThan(5);
    }
  });
});

describe("submitVerification — the Verify action", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("POSTs ONLY the public request ref to connect-verify (no channel id, user id or verdict from the client)", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ status: "verified", channel }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const outcome = await submitVerification(1_073_741_900);
    expect(outcome.kind).toBe("verified");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/channels/connect-verify");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ ref: 1_073_741_900 });
  });

  it("never throws: a network failure is an 'error' outcome, not a verdict about the connection", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))));
    expect(await submitVerification(1)).toEqual({ kind: "error" });
    expect(await fetchVerifyOutcome(1)).toEqual({ kind: "error" });
  });

  it("fetchVerifyOutcome stays a read-only GET", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ status: "pending", stage: "verifying" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    expect((await fetchVerifyOutcome(7)).kind).toBe("verifying");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit | undefined];
    expect(url).toBe("/api/channels/connect-status?ref=7");
    expect(init?.method).toBeUndefined();
  });
});
