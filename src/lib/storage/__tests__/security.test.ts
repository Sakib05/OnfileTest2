import crypto from "crypto";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", async (orig) => {
  const actual = await orig<typeof import("@/lib/auth")>();
  return { ...actual, getSessionUser: vi.fn() };
});

import * as auth from "@/lib/auth";
import { validateTelegramInitData } from "@/lib/auth";
import { isAdminUser, requireAdmin } from "../admin";
import { getAdminTelegramIds } from "../alerts";
import { canAccessThumbnail } from "../thumbnails";
import { toOwnerFile, toOwnerPlaylist } from "@/lib/fileDto";
import { GET as cronGET } from "@/app/api/cron/storage/route";

const getSessionUser = vi.mocked(auth.getSessionUser);
const req = (init: { method?: string; headers?: Record<string, string> } = {}) =>
  new NextRequest("http://localhost:3000/api/admin/storage", { method: init.method ?? "GET", headers: init.headers });

describe("admin authorisation (server-side)", () => {
  beforeEach(() => {
    process.env.ADMIN_TELEGRAM_IDS = "1001, 1002";
    getSessionUser.mockReset();
  });

  it("parses the admin list defensively", () => {
    expect(getAdminTelegramIds({ ADMIN_TELEGRAM_IDS: "1, x, 2;3, 4" })).toEqual(["1", "4"]);
    expect(getAdminTelegramIds({})).toEqual([]);
  });

  it("denies everyone when no admin ids are configured", () => {
    expect(isAdminUser({ telegramId: "1001" }, {})).toBe(false);
  });

  it("401 without a session, 403 for non-admins, ok for admins", async () => {
    getSessionUser.mockResolvedValueOnce(null);
    const a = await requireAdmin(req());
    expect("response" in a && a.response.status).toBe(401);

    getSessionUser.mockResolvedValueOnce({ id: 5, telegramId: "999" } as never);
    const b = await requireAdmin(req());
    expect("response" in b && b.response.status).toBe(403);

    getSessionUser.mockResolvedValueOnce({ id: 6, telegramId: "1002" } as never);
    const c = await requireAdmin(req());
    expect("user" in c && c.user.id).toBe(6);
  });

  it("ignores any client-supplied Telegram id / header", async () => {
    getSessionUser.mockResolvedValueOnce({ id: 5, telegramId: "999" } as never);
    const r = await requireAdmin(req({ headers: { "x-telegram-id": "1001", "x-telegram-user-id": "1001" } }));
    expect("response" in r && r.response.status).toBe(403);
  });

  it("rejects cross-origin state-changing admin requests", async () => {
    getSessionUser.mockResolvedValue({ id: 6, telegramId: "1001" } as never);
    const r = await requireAdmin(req({ method: "POST", headers: { origin: "https://evil.example", host: "localhost:3000" } }), { mutating: true });
    expect("response" in r && r.response.status).toBe(403);
    const ok = await requireAdmin(req({ method: "POST", headers: { origin: "http://localhost:3000", host: "localhost:3000" } }), { mutating: true });
    expect("user" in ok).toBe(true);
  });
});

describe("thumbnail access rules", () => {
  it("allows published files to anyone and unpublished files only to their owner", () => {
    expect(canAccessThumbnail({ userId: 1, isPublished: true }, null)).toBe(true);
    expect(canAccessThumbnail({ userId: 1, isPublished: true }, 2)).toBe(true);
    expect(canAccessThumbnail({ userId: 1, isPublished: false }, null)).toBe(false);
    expect(canAccessThumbnail({ userId: 1, isPublished: false }, 2)).toBe(false); // wrong owner
    expect(canAccessThumbnail({ userId: 1, isPublished: false }, 1)).toBe(true);
    expect(canAccessThumbnail({ userId: 1, isPublished: null }, 2)).toBe(false);
  });
});

describe("Telegram session validation", () => {
  const token = "123456:TEST_BOT_TOKEN";
  const sign = (fields: Record<string, string>) => {
    const pairs = Object.entries(fields).map(([k, v]) => `${k}=${v}`).sort().join("\n");
    const secret = crypto.createHmac("sha256", "WebAppData").update(token).digest();
    return crypto.createHmac("sha256", secret).update(pairs).digest("hex");
  };
  const build = (authDate: number, tamper = false) => {
    const fields = { auth_date: String(authDate), user: JSON.stringify({ id: 42, first_name: "A" }), query_id: "q" };
    const hash = sign(fields);
    const p = new URLSearchParams({ ...fields, hash: tamper ? "0".repeat(64) : hash });
    return p.toString();
  };
  it("accepts a valid, fresh initData", () => {
    expect(validateTelegramInitData(build(Math.floor(Date.now() / 1000)), token).ok).toBe(true);
  });
  it("rejects invalid signatures, expired payloads and garbage", () => {
    expect(validateTelegramInitData(build(Math.floor(Date.now() / 1000), true), token)).toMatchObject({ ok: false, reason: "invalid_signature" });
    expect(validateTelegramInitData(build(Math.floor(Date.now() / 1000) - 3 * 86400), token)).toMatchObject({ ok: false, reason: "expired" });
    expect(validateTelegramInitData("", token).ok).toBe(false);
    expect(validateTelegramInitData("hash=zz", token).ok).toBe(false);
  });
});

describe("cron endpoint authorisation", () => {
  const call = (headers: Record<string, string> = {}) => cronGET(new NextRequest("http://localhost:3000/api/cron/storage", { headers }));
  it("fails closed without CRON_SECRET, and rejects missing/wrong bearer tokens", async () => {
    delete process.env.CRON_SECRET;
    expect((await call()).status).toBe(503);
    process.env.CRON_SECRET = "a-very-long-cron-secret-123";
    expect((await call()).status).toBe(401);
    expect((await call({ authorization: "Bearer wrong-secret-value-000000" })).status).toBe(401);
    expect((await call({ authorization: "a-very-long-cron-secret-123" })).status).toBe(401);
  });
});

describe("response serialisation never leaks password hashes", () => {
  it("strips password and exposes only hasPassword", () => {
    const f = toOwnerFile({ id: 1, title: "t", password: "scrypt:salt:hash" });
    expect(f).not.toHaveProperty("password");
    expect(f.hasPassword).toBe(true);
    expect(JSON.stringify(f)).not.toContain("scrypt");
    expect(toOwnerFile({ id: 2, password: null }).hasPassword).toBe(false);
    const pl = toOwnerPlaylist({ id: 3, password: "scrypt:a:b" });
    expect(pl).not.toHaveProperty("password");
    expect(pl.hasPassword).toBe(true);
  });
});
