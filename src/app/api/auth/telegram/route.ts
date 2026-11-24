import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import {
  createSession,
  getSessionCookieOptions,
  SESSION_COOKIE_NAME,
  validateTelegramInitData,
} from "@/lib/auth";
import { createSetupToken, getSetupCookieOptions, SETUP_COOKIE_NAME } from "@/lib/setupToken";
import { getClientIp, rateLimit } from "@/lib/rateLimit";

/**
 * Exchanges a freshly-signed Telegram Mini App `initData` payload for either:
 *   - a real, server-issued session (returning creators, recognized by
 *     `telegramId`), or
 *   - a short-lived "setup" cookie that pre-fills the verified Telegram
 *     identity for the channel-connection step (new creators).
 *
 * This is the ONLY place a request's Telegram identity is ever derived from
 * client-supplied data, and only after verifying Telegram's HMAC signature
 * with our bot token. No persistent `users` row is created here — see
 * src/lib/setupToken.ts and src/app/api/channels/route.ts for why.
 */
export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const { allowed } = rateLimit(`auth:${ip}`, 20, 60_000);
  if (!allowed) {
    return NextResponse.json({ error: "Too many requests. Please try again shortly." }, { status: 429 });
  }

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    return NextResponse.json(
      { error: "Server is not configured for Telegram authentication." },
      { status: 503 }
    );
  }

  let body: { initData?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (!body.initData || typeof body.initData !== "string") {
    return NextResponse.json({ error: "initData is required" }, { status: 400 });
  }

  const result = validateTelegramInitData(body.initData, botToken);
  if (!result.ok) {
    // Never echo back the raw initData or internal validation internals.
    return NextResponse.json({ error: "Invalid Telegram authentication data", reason: result.reason }, { status: 401 });
  }

  const tgUser = result.data.user;
  const telegramId = String(tgUser.id);

  try {
    const [existing] = await db.select().from(users).where(eq(users.telegramId, telegramId));

    if (existing) {
      // Returning creator: refresh their profile fields and issue a new
      // session. Using the unique `telegramId` index means concurrent
      // logins from the same Telegram account race safely at the DB level.
      await db
        .update(users)
        .set({
          username: tgUser.username ?? existing.username,
          firstName: tgUser.first_name ?? existing.firstName,
          lastName: tgUser.last_name ?? existing.lastName,
          avatarUrl: tgUser.photo_url ?? existing.avatarUrl,
          language: tgUser.language_code ?? existing.language,
          updatedAt: new Date(),
        })
        .where(eq(users.id, existing.id));

      const { token, expiresAt } = await createSession(existing.id, req.headers.get("user-agent"));
      const res = NextResponse.json({ status: "authenticated" });
      res.cookies.set(SESSION_COOKIE_NAME, token, { ...getSessionCookieOptions(), expires: expiresAt });
      res.cookies.delete(SETUP_COOKIE_NAME);
      return res;
    }

    // New Telegram identity: do NOT create a users row yet. Telegram
    // identity verification only proves who is launching the Mini App — it
    // does not prove they own any Telegram channel, which is a prerequisite
    // for a creator account in Onfile. Hand back a short-lived setup cookie
    // instead; the permanent account is created only after a channel is
    // verified (see /api/channels).
    const setupToken = createSetupToken(tgUser);
    const res = NextResponse.json({
      status: "setup_required",
      profile: {
        firstName: tgUser.first_name ?? null,
        lastName: tgUser.last_name ?? null,
        username: tgUser.username ?? null,
        avatarUrl: tgUser.photo_url ?? null,
      },
    });
    res.cookies.set(SETUP_COOKIE_NAME, setupToken, getSetupCookieOptions());
    return res;
  } catch (err) {
    console.error("telegram_auth_failed", err instanceof Error ? err.message : "unknown_error");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
