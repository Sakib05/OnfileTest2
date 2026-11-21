import crypto from "crypto";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import sharp from "sharp";
import { db } from "@/db";
import { thumbnailOrphans, users } from "@/db/schema";
import { createSession } from "@/lib/auth";
import type { ThumbnailStorage } from "@/lib/thumbnails/provider";
import { GET, PATCH } from "./me/route";
import { DELETE as AVATAR_DELETE, POST as AVATAR_POST } from "./avatar/route";
import { POST as LOGIN } from "../auth/telegram/route";

/**
 * DATABASE-BACKED integration test of the creator profile API: Display Name, read-only username/Telegram identity,
 * profile picture upload validation, and persistence of an edited name across the Telegram login sync.
 * Real Postgres + real route handlers + real sessions. The image STORAGE PROVIDER is an in-memory fake (no real DBByte
 * call is made) and Telegram sign-in uses a payload signed locally with a test bot token — neither is a real Telegram
 * or DBByte integration test.
 */

// In-memory stand-in for the thumbnail storage provider (DBByte in production).
const store = new Map<string, Uint8Array>();
const deleted: string[] = [];
const fakeStorage: ThumbnailStorage = {
  provider: "dbbyte",
  async put(key, body) {
    store.set(key, body);
    return { key };
  },
  async delete(key) {
    store.delete(key);
    deleted.push(key);
  },
};
vi.mock("@/lib/thumbnails/storage", () => ({ getThumbnailStorage: () => fakeStorage }));
vi.mock("@/lib/rateLimit", () => ({ getClientIp: () => "test", rateLimit: () => ({ allowed: true, remaining: 99 }) }));

const tag = `pf${Date.now()}`;
const TG_ID = String(900_700_000 + (Date.now() % 100_000));
const BOT_TOKEN = "123456:TEST_TOKEN_FOR_LOCAL_TESTS";
const created: number[] = [];
let user: { id: number; token: string };
let other: { id: number; token: string };

const env0 = { ...process.env };
beforeAll(async () => {
  process.env.TELEGRAM_BOT_TOKEN = BOT_TOKEN;
  process.env.DBBYTE_API_KEY = "test-key";
  process.env.DBBYTE_BUCKET = "test-bucket";
  process.env.DBBYTE_CDN_BASE_URL = "https://cdn.dbbyte.com/tok";
  const mk = async (tgId: string, extra: Partial<typeof users.$inferInsert> = {}) => {
    const [u] = await db
      .insert(users)
      .values({ telegramId: tgId, username: `u_${tgId}`, firstName: "Alice", lastName: "Smith", avatarUrl: "https://t.me/i/userpic/320/alice.jpg", referralCode: tgId.slice(-8), ...extra })
      .returning();
    created.push(u.id);
    return { id: u.id, token: (await createSession(u.id)).token };
  };
  user = await mk(TG_ID);
  other = await mk(`${tag}-other`, { firstName: "Bob" });
});
afterAll(async () => {
  process.env = env0;
  await db.delete(thumbnailOrphans).where(inArray(thumbnailOrphans.reason, ["avatar_replaced_cleanup_failed"]));
  if (created.length) await db.delete(users).where(inArray(users.id, created));
});
beforeEach(() => {
  deleted.length = 0;
});

const cookie = (t: string) => ({ cookie: `onfile_session=${t}`, host: "localhost" });
const getMe = (t?: string) => GET(new NextRequest("http://localhost/api/user/me", { headers: t ? cookie(t) : {} }));
const patch = (t: string | null, json: unknown) =>
  PATCH(new NextRequest("http://localhost/api/user/me", { method: "PATCH", headers: { ...(t ? cookie(t) : { host: "localhost" }), "content-type": "application/json" }, body: JSON.stringify(json) }));
const dbUser = async (id: number) => (await db.select().from(users).where(eq(users.id, id)))[0];

describe("GET /api/user/me", () => {
  it("returns the default (Telegram) avatar when no picture was uploaded, and no secrets", async () => {
    const body = await (await getMe(user.token)).json();
    expect(body.user.avatarUrl).toBe("https://t.me/i/userpic/320/alice.jpg");
    expect(body.user.hasCustomAvatar).toBe(false);
    expect(JSON.stringify(body)).not.toMatch(/tokenHash|password|profileImageKey/);
  });
  it("returns null user without a session", async () => {
    expect((await (await getMe()).json()).user).toBeNull();
  });
});

describe("PATCH /api/user/me — Display Name", () => {
  it("saves a valid display name, flags it as customised, and returns it", async () => {
    const res = await patch(user.token, { displayName: "  Alice   the   Creator " });
    expect(res.status).toBe(200);
    expect((await res.json()).user.firstName).toBe("Alice the Creator");
    const row = await dbUser(user.id);
    expect(row.firstName).toBe("Alice the Creator");
    expect(row.lastName).toBeNull();
    expect(row.displayNameCustom).toBe(true);
  });
  it("rejects empty, whitespace-only, too long, non-string and control-character names", async () => {
    for (const bad of ["", "   ", "x".repeat(65), 123, null, "evil\u0000name", "rtl\u202Etrick"]) {
      const res = await patch(user.token, { displayName: bad });
      expect(res.status).toBe(400);
    }
    expect((await dbUser(user.id)).firstName).toBe("Alice the Creator");
  });
  it("accepts exactly 64 characters", async () => {
    expect((await patch(user.token, { displayName: "y".repeat(64) })).status).toBe(200);
    expect((await patch(user.token, { displayName: "Alice the Creator" })).status).toBe(200);
  });
  it("requires authentication", async () => {
    expect((await patch(null, { displayName: "Hacker" })).status).toBe(401);
  });
  it("only ever edits the signed-in user (a user id in the body is ignored)", async () => {
    await patch(user.token, { displayName: "Alice the Creator", id: other.id, userId: other.id });
    expect((await dbUser(other.id)).firstName).toBe("Bob");
  });
});

describe("Telegram username / identity are read-only", () => {
  it("refuses to change the username and leaves the row untouched", async () => {
    const before = await dbUser(user.id);
    for (const body of [{ username: "hacked" }, { username: "" }, { displayName: "Ok Name", username: "hacked" }, { telegramId: "1" }]) {
      const res = await patch(user.token, body);
      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe("username_read_only");
    }
    const after = await dbUser(user.id);
    expect(after.username).toBe(before.username);
    expect(after.telegramId).toBe(before.telegramId);
    expect(after.firstName).toBe(before.firstName); // the mixed request changed nothing at all
  });
  it("ignores other identity / money fields sent to the profile endpoint", async () => {
    const before = await dbUser(user.id);
    const res = await patch(user.token, { displayName: "Alice the Creator", balance: "999999", referralCode: "STOLEN", avatarUrl: "https://evil.example/x.png", profileImageKey: "x", displayNameCustom: false });
    expect(res.status).toBe(200);
    const after = await dbUser(user.id);
    expect(after.balance).toBe(before.balance);
    expect(after.referralCode).toBe(before.referralCode);
    expect(after.avatarUrl).toBe(before.avatarUrl);
    expect(after.profileImageKey).toBeNull();
    expect(after.displayNameCustom).toBe(true);
  });
  it("an edited Display Name survives the Telegram login sync, while the username still follows Telegram", async () => {
    const authDate = Math.floor(Date.now() / 1000);
    const fields: Record<string, string> = {
      auth_date: String(authDate),
      query_id: "AAtest",
      user: JSON.stringify({ id: Number(TG_ID), first_name: "TelegramFirst", last_name: "TelegramLast", username: "new_tg_username", language_code: "en" }),
    };
    const dcs = Object.keys(fields).sort().map((k) => `${k}=${fields[k]}`).join("\n");
    const secret = crypto.createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
    const hash = crypto.createHmac("sha256", secret).update(dcs).digest("hex");
    const initData = new URLSearchParams({ ...fields, hash }).toString();
    const res = await LOGIN(new NextRequest("http://localhost/api/auth/telegram", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ initData }) }));
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("authenticated");
    const row = await dbUser(user.id);
    expect(row.firstName).toBe("Alice the Creator");
    expect(row.lastName).toBeNull();
    expect(row.username).toBe("new_tg_username");
  });
});

async function png(width = 300, height = 200) {
  return sharp({ create: { width, height, channels: 3, background: { r: 255, g: 97, b: 21 } } }).png().toBuffer();
}
async function jpg() {
  return sharp({ create: { width: 640, height: 480, channels: 3, background: { r: 10, g: 120, b: 200 } } }).jpeg().toBuffer();
}
async function webp() {
  return sharp({ create: { width: 400, height: 400, channels: 3, background: { r: 0, g: 200, b: 100 } } }).webp().toBuffer();
}
function upload(t: string | null, bytes: Uint8Array | string, name = "me.png", type = "image/png") {
  const form = new FormData();
  form.append("file", new File([bytes as BlobPart], name, { type }));
  return AVATAR_POST(new NextRequest("http://localhost/api/user/avatar", { method: "POST", headers: t ? cookie(t) : { host: "localhost" }, body: form }));
}

describe("POST/DELETE /api/user/avatar — profile picture", () => {
  it("requires authentication", async () => {
    expect((await upload(null, await png())).status).toBe(401);
  });

  it("uploads a valid PNG, stores a square WebP via the existing storage, and exposes the CDN URL", async () => {
    const res = await upload(user.token, await png());
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.hasCustomAvatar).toBe(true);
    expect(body.avatarUrl).toMatch(/^https:\/\/cdn\.dbbyte\.com\/tok\/test-bucket\/avatar-\d+-[a-f0-9]{16}\.webp$/);
    const row = await dbUser(user.id);
    expect(row.profileImageKey).toMatch(/^avatar-\d+-[a-f0-9]{16}\.webp$/);
    expect(store.has(row.profileImageKey!)).toBe(true);
    // Telegram avatar column is untouched (default remains available if the picture is removed).
    expect(row.avatarUrl).toBe("https://t.me/i/userpic/320/alice.jpg");
    const me = await (await getMe(user.token)).json();
    expect(me.user.avatarUrl).toBe(body.avatarUrl);
    expect(me.user.hasCustomAvatar).toBe(true);
  });

  it("output is a 512×512 WebP with metadata stripped", async () => {
    const key = (await dbUser(user.id)).profileImageKey!;
    const meta = await sharp(Buffer.from(store.get(key)!)).metadata();
    expect(meta).toMatchObject({ format: "webp", width: 512, height: 512 }); // 300×200 source → centre-cropped square
    expect(meta.exif).toBeUndefined();
  });

  it("replaces an existing picture (JPEG) and deletes the old object", async () => {
    const oldKey = (await dbUser(user.id)).profileImageKey!;
    const res = await upload(user.token, await jpg(), "photo.jpg", "image/jpeg");
    expect(res.status).toBe(201);
    const newKey = (await dbUser(user.id)).profileImageKey!;
    expect(newKey).not.toBe(oldKey);
    expect(deleted).toContain(oldKey);
    expect(store.has(oldKey)).toBe(false);
    expect(store.has(newKey)).toBe(true);
  });

  it("accepts WebP", async () => {
    expect((await upload(user.token, await webp(), "a.webp", "image/webp")).status).toBe(201);
  });

  it("rejects unsupported / dangerous files regardless of the claimed name or MIME type", async () => {
    const keyBefore = (await dbUser(user.id)).profileImageKey;
    const cases: [string, Uint8Array | string, string, string][] = [
      ["plain text pretending to be PNG", "hello world, not an image", "evil.png", "image/png"],
      ["HTML/script payload", "<script>alert(1)</script>", "x.jpg", "image/jpeg"],
      ["SVG", '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', "x.svg", "image/svg+xml"],
      ["GIF", Buffer.from("GIF89a\x01\x00\x01\x00\x80\x00\x00\xff\xff\xff\x00\x00\x00!\xf9\x04\x01\x00\x00\x00\x00,\x00\x00\x00\x00\x01\x00\x01\x00\x00\x02\x02D\x01\x00;", "binary"), "x.gif", "image/gif"],
      ["truncated PNG header only", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]), "x.png", "image/png"],
      ["empty file", "", "x.png", "image/png"],
    ];
    for (const [label, bytes, name, type] of cases) {
      const res = await upload(user.token, bytes, name, type);
      expect(res.status, label).toBeGreaterThanOrEqual(400);
      expect(res.status, label).toBeLessThan(500);
    }
    expect((await dbUser(user.id)).profileImageKey).toBe(keyBefore);
  });

  it("rejects oversized images (> 2 MB) with 413 and stores nothing", async () => {
    const sizeBefore = store.size;
    const big = Buffer.concat([await png(), Buffer.alloc(2 * 1024 * 1024 + 10)]);
    const res = await upload(user.token, big);
    expect(res.status).toBe(413);
    expect((await res.json()).error).toMatch(/2 MB/);
    expect(store.size).toBe(sizeBefore);
  });

  it("rejects a missing file field", async () => {
    const res = await AVATAR_POST(new NextRequest("http://localhost/api/user/avatar", { method: "POST", headers: cookie(user.token), body: new FormData() }));
    expect(res.status).toBe(400);
  });

  it("DELETE removes the picture and the default avatar returns", async () => {
    const key = (await dbUser(user.id)).profileImageKey!;
    const res = await AVATAR_DELETE(new NextRequest("http://localhost/api/user/avatar", { method: "DELETE", headers: cookie(user.token) }));
    expect(res.status).toBe(200);
    expect(deleted).toContain(key);
    const me = await (await getMe(user.token)).json();
    expect(me.user.hasCustomAvatar).toBe(false);
    expect(me.user.avatarUrl).toBe("https://t.me/i/userpic/320/alice.jpg");
  });

  it("one creator can't affect another creator's picture", async () => {
    expect((await dbUser(other.id)).profileImageKey).toBeNull();
  });
});
