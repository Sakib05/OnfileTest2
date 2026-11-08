import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// Auth and DB-backed deps are mocked: these tests prove the ROUTE derives the
// creator and channel only from the session / server-side data.
const getSessionUser = vi.fn();
vi.mock("@/lib/auth", () => ({
  getSessionUser: (...a: unknown[]) => getSessionUser(...a),
  isSameOriginRequest: (req: Request) => {
    const o = req.headers.get("origin");
    return !o || new URL(o).host === req.headers.get("host");
  },
  unauthorized: () => new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }),
}));

const listVerifiedChannels = vi.fn();
const resolvePublicChat = vi.fn();
vi.mock("@/lib/publishing/publishDeps", () => ({
  dbPublishDeps: {
    listVerifiedChannels: (...a: unknown[]) => listVerifiedChannels(...a),
    resolvePublicChat: (...a: unknown[]) => resolvePublicChat(...a),
  },
}));

import { POST } from "./route";

let ipCounter = 0;
function req(body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost/api/publish/verify-link", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { host: "localhost", "content-type": "application/json", ...headers },
  });
}

const channel = { id: 1, telegramChannelId: "-1001234567890", channelName: "Mine", channelUsername: null };

beforeEach(() => {
  getSessionUser.mockReset();
  listVerifiedChannels.mockReset();
  resolvePublicChat.mockReset();
  ipCounter++;
});

describe("POST /api/publish/verify-link", () => {
  it("401 without a session — channels are never queried", async () => {
    getSessionUser.mockResolvedValue(null);
    const res = await POST(req({ link: "https://t.me/c/1234567890/1" }));
    expect(res.status).toBe(401);
    expect(listVerifiedChannels).not.toHaveBeenCalled();
  });

  it("403 for a cross-origin request", async () => {
    getSessionUser.mockResolvedValue({ id: 100 + ipCounter });
    const res = await POST(req({ link: "https://t.me/c/1234567890/1" }, { origin: "https://evil.example" }));
    expect(res.status).toBe(403);
  });

  it("verifies a matching link using ONLY the session user's channels", async () => {
    const uid = 200 + ipCounter;
    getSessionUser.mockResolvedValue({ id: uid });
    listVerifiedChannels.mockResolvedValue([channel]);
    const res = await POST(
      req({ link: "https://t.me/c/1234567890/125", userId: 1, channelId: 5, telegramChannelId: "-100999" })
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({
      verified: true,
      canonicalLink: "https://t.me/c/1234567890/125",
      messageId: 125,
      messageExistenceVerified: false,
      channel: { name: "Mine" },
    });
    // Channel lookup used the authenticated id, not anything from the body.
    expect(listVerifiedChannels).toHaveBeenCalledWith(uid);
    // No internal identifiers leak back.
    expect(JSON.stringify(json)).not.toContain("-1001234567890");
  });

  it("403 channel_mismatch for another channel's post", async () => {
    getSessionUser.mockResolvedValue({ id: 300 + ipCounter });
    listVerifiedChannels.mockResolvedValue([channel]);
    const res = await POST(req({ link: "https://t.me/c/9999999999/125" }));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({
      reason: "channel_mismatch",
      error: "This post does not belong to your connected Telegram channel.",
    });
  });

  it("403 channel_required when no channel is connected", async () => {
    getSessionUser.mockResolvedValue({ id: 400 + ipCounter });
    listVerifiedChannels.mockResolvedValue([]);
    const res = await POST(req({ link: "https://t.me/c/1234567890/125" }));
    expect(res.status).toBe(403);
    expect((await res.json()).reason).toBe("channel_required");
  });

  it("400 for invalid and unsupported links", async () => {
    getSessionUser.mockResolvedValue({ id: 500 + ipCounter });
    listVerifiedChannels.mockResolvedValue([channel]);
    for (const link of ["", "hello", "https://example.com/a/b", "https://t.me/+AbCdEfGhIjKlMn", undefined]) {
      const res = await POST(req({ link }));
      expect(res.status).toBe(400);
    }
  });

  it("400 for a non-JSON body", async () => {
    getSessionUser.mockResolvedValue({ id: 600 + ipCounter });
    const res = await POST(req("not json"));
    expect(res.status).toBe(400);
  });

  it("503 when a public link can't be resolved by Telegram", async () => {
    getSessionUser.mockResolvedValue({ id: 700 + ipCounter });
    listVerifiedChannels.mockResolvedValue([channel]);
    resolvePublicChat.mockResolvedValue({ ok: false, reason: "unavailable" });
    const res = await POST(req({ link: "https://t.me/somename/4" }));
    expect(res.status).toBe(503);
    expect((await res.json()).reason).toBe("verification_unavailable");
  });

  it("429 after too many attempts", async () => {
    getSessionUser.mockResolvedValue({ id: 800 + ipCounter });
    listVerifiedChannels.mockResolvedValue([channel]);
    let last = 200;
    for (let i = 0; i < 31; i++) last = (await POST(req({ link: "https://t.me/c/1234567890/1" }))).status;
    expect(last).toBe(429);
  });
});
