import { createHmac } from "crypto";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";

const env = vi.hoisted(() => {
  process.env.DBBYTE_API_KEY = "test-key";
  process.env.DBBYTE_BUCKET = "test-bucket";
  process.env.DBBYTE_CDN_BASE_URL = "https://cdn.test/tok";
  process.env.TELEGRAM_BOT_TOKEN = "123456:TEST_TOKEN_FOR_PROFILE_E2E";
  return { objects: new Map<string, number>() };
});
// In-memory storage provider (no network). Everything else — routes, DB, sessions, sharp — is real.
vi.mock("@/lib/thumbnails/storage", () => ({
  getThumbnailStorage: () => ({
    provider: "fake",
    put: async (key: string, body: Uint8Array) => (env.objects.set(key, body.length), { key }),
    delete: async (key: string) => void env.objects.delete(key),
  }),
}));

import { db } from "@/db";
import { users, thumbnailOrphans } from "@/db/schema";
import { createSession } from "@/lib/auth";
import { GET as getMe, PATCH as patchMe } from "./me/route";
import { POST as uploadAvatar, DELETE as deleteAvatar } from "./avatar/route";
import { POST as telegramLogin } from "../auth/telegram/route";
import { toPublicCreator } from "@/lib/profile/serialize";

/** DATABASE-BACKED integration test (real Postgres, real handlers, real sessions). Not a device / Telegram test. */
const tag = `prof${Date.now()}`;
const TG_ID_A = `9${Date.now()}`.slice(0, 12);
let userA = 0;
let userB = 0;
let tokenA = "";
let tokenB = "";
const created: number[] = [];

function req(path: string, init: { method?: string; token?: string; json?: unknown; form?: FormData; origin?: string } = {}) {
  const headers: Record<string, string> = { host: "localhost" };
  headers.origin = init.origin ?? "http://localhost";
  if (init.token) headers.cookie = `onfile_session=${init.token}`;
  if (init.json !== undefined) headers["content-type"] = "application/json";
  return new NextRequest(`http://localhost${path}`, {
    method: init.method ?? "GET",
    headers,
    body: init.json !== undefined ? JSON.stringify(init.json) : init.form,
  });
}

async function png(color: [number, number, number]): Promise<File> {
  const sharp = (await import("sharp")).default;
  const buf = await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: color[0], g: color[1], b: color[2] } } }).png().toBuffer();
  return new File([new Uint8Array(buf)], "a.png", { type: "image/png" });
}
const formWith = (file: File | string) => {
  const f = new FormData();
  f.append("file", file);
  return f;
};

function signedInitData(user: Record<string, unknown>) {
  const params = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), query_id: "AAE", user: JSON.stringify(user) });
  const dcs = [...params.entries()].map(([k, v]) => `${k}=${v}`).sort().join("\n");
  const secret = createHmac("sha256", "WebAppData").update(process.env.TELEGRAM_BOT_TOKEN!).digest();
  params.set("hash", createHmac("sha256", secret).update(dcs).digest("hex"));
  return params.toString();
}

const me = async (token?: string) => (await (await getMe(req("/api/user/me", { token }))).json()).user;
const row = async (id: number) => (await db.select().from(users).where(eq(users.id, id)))[0];

beforeAll(async () => {
  const [a] = await db.insert(users).values({
    telegramId: TG_ID_A, username: "tg_name_a", firstName: "TgFirst", avatarUrl: "https://t.me/i/userpic/320/a.jpg",
    referralCode: `${tag}a`.slice(-8).toUpperCase(),
  }).returning();
  const [b] = await db.insert(users).values({ telegramId: `${tag}b`, firstName: "Other", referralCode: `${tag}b`.slice(-8).toUpperCase() }).returning();
  userA = a.id; userB = b.id;
  created.push(a.id, b.id);
  tokenA = (await createSession(a.id)).token;
  tokenB = (await createSession(b.id)).token;
});
afterAll(async () => {
  await db.delete(thumbnailOrphans);
  await db.delete(users).where(inArray(users.id, created));
});

describe("GET /api/user/me — identity", () => {
  it("returns the real Telegram id (not users.id) and the effective name; no custom picture yet", async () => {
    const u = await me(tokenA);
    expect(u.telegramId).toBe(TG_ID_A);
    expect(u.telegramId).not.toBe(String(u.id));
    expect(u.displayName).toBe("TgFirst");
    expect(u.customAvatarUrl).toBeUndefined();
    expect(u.avatarUrl).toBe("https://t.me/i/userpic/320/a.jpg");
  });

  it("is null without a session — a client can't ask for someone else's profile", async () => {
    expect(await me(undefined)).toBeNull();
  });
});

describe("display name", () => {
  it("saves a custom name to display_name_custom (first_name untouched) and returns it", async () => {
    const res = await patchMe(req("/api/user/me", { method: "PATCH", token: tokenA, json: { displayName: "  Cool   Creator " } }));
    expect(res.status).toBe(200);
    const u = (await res.json()).user;
    expect(u.displayName).toBe("Cool Creator");
    expect(u.displayNameCustom).toBe("Cool Creator");
    const r = await row(userA);
    expect(r.displayNameCustom).toBe("Cool Creator");
    expect(r.firstName).toBe("TgFirst");
    expect((await me(tokenA)).displayName).toBe("Cool Creator"); // persists across a fresh read ("refresh")
  });

  it("rejects invalid names", async () => {
    for (const bad of ["x".repeat(65), "<script>", "ctrl\u0007char", 5]) {
      const res = await patchMe(req("/api/user/me", { method: "PATCH", token: tokenA, json: { displayName: bad } }));
      expect(res.status).toBe(400);
    }
    expect((await row(userA)).displayNameCustom).toBe("Cool Creator");
  });

  it("the username is NOT editable", async () => {
    const res = await patchMe(req("/api/user/me", { method: "PATCH", token: tokenA, json: { username: "hacked" } }));
    expect(res.status).toBe(400);
    expect((await row(userA)).username).toBe("tg_name_a");
  });

  it("requires a session and a same-origin request", async () => {
    expect((await patchMe(req("/api/user/me", { method: "PATCH", json: { displayName: "x" } }))).status).toBe(401);
    expect((await patchMe(req("/api/user/me", { method: "PATCH", token: tokenA, origin: "https://evil.example", json: { displayName: "x" } }))).status).toBe(403);
  });

  it("only ever modifies the caller's own row", async () => {
    await patchMe(req("/api/user/me", { method: "PATCH", token: tokenB, json: { displayName: "Bee" } }));
    expect((await row(userA)).displayNameCustom).toBe("Cool Creator");
    expect((await row(userB)).displayNameCustom).toBe("Bee");
  });
});

describe("custom picture", () => {
  let firstKey = "";

  it("upload validates the real image, stores the optimised object and exposes the custom URL", async () => {
    const res = await uploadAvatar(req("/api/user/avatar", { method: "POST", token: tokenA, form: formWith(await png([200, 30, 30])) }));
    expect(res.status).toBe(201);
    const u = (await res.json()).user;
    firstKey = (await row(userA)).profileImageKey!;
    expect(firstKey).toMatch(new RegExp(`^avatar-${userA}-[0-9a-f]{16}\\.(webp|png|jpg)$`));
    expect(u.customAvatarUrl).toBe(`https://cdn.test/tok/test-bucket/${firstKey}`);
    expect(env.objects.has(firstKey)).toBe(true);
    expect(u.avatarUrl).toBe("https://t.me/i/userpic/320/a.jpg"); // Telegram photo is kept as the fallback
  });

  it("replacing stores a new object and deletes the old one", async () => {
    const res = await uploadAvatar(req("/api/user/avatar", { method: "POST", token: tokenA, form: formWith(await png([30, 30, 200])) }));
    expect(res.status).toBe(201);
    const secondKey = (await row(userA)).profileImageKey!;
    expect(secondKey).not.toBe(firstKey);
    expect(env.objects.has(secondKey)).toBe(true);
    expect(env.objects.has(firstKey)).toBe(false);
  });

  it("rejects a non-image disguised as a PNG, and an unauthenticated upload", async () => {
    const fake = new File([new TextEncoder().encode("<?php echo 1; ?>")], "x.png", { type: "image/png" });
    const bad = await uploadAvatar(req("/api/user/avatar", { method: "POST", token: tokenA, form: formWith(fake) }));
    expect(bad.status).toBe(415);
    const anon = await uploadAvatar(req("/api/user/avatar", { method: "POST", form: formWith(await png([1, 2, 3])) }));
    expect(anon.status).toBe(401);
  });

  it("Telegram re-login refreshes Telegram fields but NEVER overwrites the custom name or picture", async () => {
    const before = await row(userA);
    const res = await telegramLogin(
      new NextRequest("http://localhost/api/auth/telegram", {
        method: "POST",
        headers: { host: "localhost", "content-type": "application/json", "x-forwarded-for": `10.9.${Date.now() % 250}.1` },
        body: JSON.stringify({
          initData: signedInitData({ id: Number(TG_ID_A), first_name: "NewTelegramName", username: "new_tg_name", photo_url: "https://t.me/i/userpic/320/new.jpg" }),
        }),
      })
    );
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("authenticated");
    const after = await row(userA);
    expect(after.firstName).toBe("NewTelegramName");
    expect(after.username).toBe("new_tg_name");
    expect(after.avatarUrl).toBe("https://t.me/i/userpic/320/new.jpg");
    expect(after.displayNameCustom).toBe("Cool Creator");
    expect(after.profileImageKey).toBe(before.profileImageKey);
    expect(after.telegramId).toBe(TG_ID_A); // identity unchanged
    expect(after.id).toBe(userA);
    const u = await me(tokenA);
    expect(u.displayName).toBe("Cool Creator");
    expect(u.customAvatarUrl).toContain(before.profileImageKey!);
  });

  it("public creator info prefers the custom picture and name, and never leaks ids", async () => {
    const r = await row(userA);
    const pub = toPublicCreator(r);
    expect(pub.firstName).toBe("Cool Creator");
    expect(pub.customAvatarUrl).toContain(r.profileImageKey!);
    expect(pub.avatarUrl).toBe("https://t.me/i/userpic/320/new.jpg");
    expect(Object.keys(pub).sort()).toEqual(["avatarUrl", "customAvatarUrl", "firstName", "username"]);
  });

  it("removing restores the Telegram photo (custom URL gone, object deleted); removing again is a no-op", async () => {
    const key = (await row(userA)).profileImageKey!;
    const res = await deleteAvatar(req("/api/user/avatar", { method: "DELETE", token: tokenA }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.removed).toBe(true);
    expect(body.user.customAvatarUrl).toBeUndefined();
    expect(body.user.avatarUrl).toBe("https://t.me/i/userpic/320/new.jpg");
    expect((await row(userA)).profileImageKey).toBeNull();
    expect(env.objects.has(key)).toBe(false);
    expect((await (await deleteAvatar(req("/api/user/avatar", { method: "DELETE", token: tokenA }))).json()).removed).toBe(false);
  });

  it("with no custom and no Telegram photo the payload has neither (client renders initials)", async () => {
    await db.update(users).set({ avatarUrl: null }).where(eq(users.id, userA));
    const u = await me(tokenA);
    expect(u.customAvatarUrl).toBeUndefined();
    expect(u.avatarUrl).toBeUndefined();
    expect(u.displayName).toBe("Cool Creator");
  });

  it("one user cannot touch another's picture", async () => {
    await uploadAvatar(req("/api/user/avatar", { method: "POST", token: tokenB, form: formWith(await png([9, 9, 9])) }));
    const keyB = (await row(userB)).profileImageKey!;
    await deleteAvatar(req("/api/user/avatar", { method: "DELETE", token: tokenA }));
    expect((await row(userB)).profileImageKey).toBe(keyB);
    expect(env.objects.has(keyB)).toBe(true);
  });
});
