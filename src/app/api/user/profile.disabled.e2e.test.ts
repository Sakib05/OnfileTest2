import { createHmac } from "crypto";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";

/**
 * DATABASE-BACKED integration test of the CURRENT behaviour: custom profile pictures are DISABLED
 * (CUSTOM_PROFILE_PICTURE_ENABLED = false). Real Postgres, real route handlers, real sessions.
 * The restored behaviour is covered by profile.e2e.test.ts (which forces the flag on).
 */
const env = vi.hoisted(() => {
  process.env.DBBYTE_API_KEY = "test-key";
  process.env.DBBYTE_BUCKET = "test-bucket";
  process.env.DBBYTE_CDN_BASE_URL = "https://cdn.test/tok";
  process.env.TELEGRAM_BOT_TOKEN = "123456:TEST_TOKEN_FOR_PROFILE_DISABLED_E2E";
  return { puts: 0, deletes: 0 };
});
vi.mock("@/lib/thumbnails/storage", () => ({
  getThumbnailStorage: () => ({
    provider: "fake",
    put: async (key: string) => (env.puts++, { key }),
    delete: async () => void env.deletes++,
  }),
}));

import { db } from "@/db";
import { users, thumbnailOrphans } from "@/db/schema";
import { userColumns, publicCreatorColumns } from "@/db/userColumns";
import { createSession } from "@/lib/auth";
import { GET as getMe, PATCH as patchMe } from "./me/route";
import { POST as uploadAvatar, DELETE as deleteAvatar } from "./avatar/route";
import { POST as telegramLogin } from "../auth/telegram/route";
import { toPublicCreator } from "@/lib/profile/serialize";

const tag = `pdis${Date.now()}`;
const TG_ID = `8${Date.now()}`.slice(0, 12);
let userId = 0;
let token = "";
const created: number[] = [];

function req(path: string, init: { method?: string; token?: string; json?: unknown; form?: FormData } = {}) {
  const headers: Record<string, string> = { host: "localhost", origin: "http://localhost" };
  if (init.token) headers.cookie = `onfile_session=${init.token}`;
  if (init.json !== undefined) headers["content-type"] = "application/json";
  return new NextRequest(`http://localhost${path}`, {
    method: init.method ?? "GET",
    headers,
    body: init.json !== undefined ? JSON.stringify(init.json) : init.form,
  });
}
const me = async () => (await (await getMe(req("/api/user/me", { token }))).json()).user;
const row = async () => (await db.select().from(users).where(eq(users.id, userId)))[0];

function signedInitData(user: Record<string, unknown>) {
  const params = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), query_id: "AAE", user: JSON.stringify(user) });
  const dcs = [...params.entries()].map(([k, v]) => `${k}=${v}`).sort().join("\n");
  const secret = createHmac("sha256", "WebAppData").update(process.env.TELEGRAM_BOT_TOKEN!).digest();
  params.set("hash", createHmac("sha256", secret).update(dcs).digest("hex"));
  return params.toString();
}

beforeAll(async () => {
  const [a] = await db.insert(users).values({
    telegramId: TG_ID, username: "tg_name", firstName: "TgFirst", avatarUrl: "https://t.me/i/userpic/320/a.jpg",
    referralCode: `${tag}`.slice(-8).toUpperCase(),
    // A picture key left over from when the feature was live: it must be ignored, not required.
    profileImageKey: "avatar-legacy-0123456789abcdef.webp",
  }).returning();
  userId = a.id;
  created.push(a.id);
  token = (await createSession(a.id)).token;
});
afterAll(async () => {
  await db.delete(thumbnailOrphans);
  await db.delete(users).where(inArray(users.id, created));
});

describe("column sets do not require profile_image_key", () => {
  it("userColumns / publicCreatorColumns omit it (the Drizzle schema itself is unchanged)", () => {
    expect(Object.keys(userColumns)).not.toContain("profileImageKey");
    expect(Object.keys(publicCreatorColumns)).not.toContain("profileImageKey");
    expect(Object.keys(userColumns)).toContain("displayNameCustom"); // display-name customisation still needs this one
    expect(users.profileImageKey).toBeDefined(); // schema.ts untouched
  });
});

describe("profile loading with the picture feature disabled", () => {
  it("returns Telegram id, effective name and the Telegram photo — and NO custom picture, even if a legacy key exists", async () => {
    const u = await me();
    expect(u.telegramId).toBe(TG_ID);
    expect(u.displayName).toBe("TgFirst");
    expect(u.avatarUrl).toBe("https://t.me/i/userpic/320/a.jpg");
    expect(u.customAvatarUrl).toBeUndefined();
    expect(JSON.stringify(u)).not.toContain("avatar-legacy");
  });

  it("public creator info has no custom picture (Telegram photo + name only)", async () => {
    const [c] = await db.select(publicCreatorColumns).from(users).where(eq(users.id, userId));
    const pub = toPublicCreator(c);
    expect(pub.customAvatarUrl).toBeNull();
    expect(pub.avatarUrl).toBe("https://t.me/i/userpic/320/a.jpg");
    expect(pub.firstName).toBe("TgFirst");
  });
});

describe("custom picture endpoints are disabled", () => {
  it("POST /api/user/avatar answers 403 profile_picture_disabled — even for a valid session — and stores nothing", async () => {
    const form = new FormData();
    form.append("file", new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "a.png", { type: "image/png" }));
    const res = await uploadAvatar(req("/api/user/avatar", { method: "POST", token, form }));
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("profile_picture_disabled");
    expect(env.puts).toBe(0);
    expect((await row()).profileImageKey).toBe("avatar-legacy-0123456789abcdef.webp"); // untouched
  });

  it("unauthenticated uploads are refused too", async () => {
    const res = await uploadAvatar(req("/api/user/avatar", { method: "POST", form: new FormData() }));
    expect(res.status).toBe(403);
  });

  it("DELETE /api/user/avatar is refused and removes nothing (existing images are never deleted)", async () => {
    const res = await deleteAvatar(req("/api/user/avatar", { method: "DELETE", token }));
    expect(res.status).toBe(403);
    expect(env.deletes).toBe(0);
    expect((await row()).profileImageKey).toBe("avatar-legacy-0123456789abcdef.webp");
  });
});

describe("display name + username still behave exactly as before", () => {
  it("saves a normalised custom name to display_name_custom (first_name untouched)", async () => {
    const res = await patchMe(req("/api/user/me", { method: "PATCH", token, json: { displayName: "  Cool   Creator " } }));
    expect(res.status).toBe(200);
    const u = (await res.json()).user;
    expect(u.displayName).toBe("Cool Creator");
    expect(u.displayNameCustom).toBe("Cool Creator");
    expect(u.customAvatarUrl).toBeUndefined();
    const r = await row();
    expect(r.displayNameCustom).toBe("Cool Creator");
    expect(r.firstName).toBe("TgFirst");
    expect((await me()).displayName).toBe("Cool Creator");
  });

  it("rejects over-long / markup / control-character names", async () => {
    for (const bad of ["x".repeat(65), "<script>", "ctrl\u0007char", 5]) {
      expect((await patchMe(req("/api/user/me", { method: "PATCH", token, json: { displayName: bad } }))).status).toBe(400);
    }
    expect((await row()).displayNameCustom).toBe("Cool Creator");
  });

  it("an empty name resets to the Telegram name", async () => {
    const res = await patchMe(req("/api/user/me", { method: "PATCH", token, json: { displayName: "   " } }));
    expect(res.status).toBe(200);
    expect((await res.json()).user.displayName).toBe("TgFirst");
    expect((await row()).displayNameCustom).toBeNull();
  });

  it("the username is NOT editable (400, unchanged)", async () => {
    const res = await patchMe(req("/api/user/me", { method: "PATCH", token, json: { username: "hacked" } }));
    expect(res.status).toBe(400);
    expect((await row()).username).toBe("tg_name");
  });

  it("Telegram re-login still syncs Telegram fields and keeps the custom name (and issues a session)", async () => {
    await patchMe(req("/api/user/me", { method: "PATCH", token, json: { displayName: "Mine" } }));
    const res = await telegramLogin(
      new NextRequest("http://localhost/api/auth/telegram", {
        method: "POST",
        headers: { host: "localhost", "content-type": "application/json", "x-forwarded-for": `10.8.${Date.now() % 250}.1` },
        body: JSON.stringify({
          initData: signedInitData({ id: Number(TG_ID), first_name: "NewTg", username: "new_tg", photo_url: "https://t.me/i/userpic/320/new.jpg" }),
        }),
      })
    );
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("authenticated");
    const r = await row();
    expect(r.firstName).toBe("NewTg");
    expect(r.username).toBe("new_tg");
    expect(r.avatarUrl).toBe("https://t.me/i/userpic/320/new.jpg");
    expect(r.displayNameCustom).toBe("Mine");
    const u = await me();
    expect(u.displayName).toBe("Mine");
    expect(u.avatarUrl).toBe("https://t.me/i/userpic/320/new.jpg");
  });

  it("with no Telegram photo the payload has no picture at all (client renders initials)", async () => {
    await db.update(users).set({ avatarUrl: null }).where(eq(users.id, userId));
    const u = await me();
    expect(u.avatarUrl).toBeUndefined();
    expect(u.customAvatarUrl).toBeUndefined();
  });
});
