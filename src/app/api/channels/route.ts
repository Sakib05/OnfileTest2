import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { channels } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { getSessionUser, isSameOriginRequest, SESSION_COOKIE_NAME, getSessionCookieOptions } from "@/lib/auth";
import {
  normalizeChannelIdentifier,
  verifyChannelOwnershipAndBotAccess,
  leaveChannel,
} from "@/lib/telegramBot";
import { getClientIp, rateLimit } from "@/lib/rateLimit";
import {
  CHANNEL_FAILURE_MESSAGES,
  finalizeVerifiedChannelConnection,
  resolveConnectingIdentity,
} from "@/lib/channelConnection";
import { SETUP_COOKIE_NAME } from "@/lib/setupToken";

/** Returns the current creator's connected channel(s), scoped to their session. */
export async function GET(req: NextRequest) {
  const user = await getSessionUser(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rows = await db.select().from(channels).where(eq(channels.userId, user.id));
  return NextResponse.json({ channels: rows });
}

/**
 * Legacy manual-identifier channel connection endpoint. Kept working for
 * backward compatibility and as a server-side fallback, but the Mini App UI
 * no longer uses this as the primary connection path — see
 * /api/channels/connect-request and /api/telegram/webhook for the native
 * Telegram "select chat, then add bot as admin" flow that now drives the
 * Channel Connect screens. Verification and persistence logic is shared
 * with that flow via src/lib/channelConnection.ts.
 */
export async function POST(req: NextRequest) {
  if (!isSameOriginRequest(req)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }

  const ip = getClientIp(req);
  const { allowed } = rateLimit(`channel-connect:${ip}`, 10, 60_000);
  if (!allowed) {
    return NextResponse.json({ error: "Too many attempts. Please wait a moment and try again." }, { status: 429 });
  }

  let body: { channelIdentifier?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const identifier = typeof body.channelIdentifier === "string" ? normalizeChannelIdentifier(body.channelIdentifier) : null;
  if (!identifier) {
    return NextResponse.json({ error: "A valid channel username or link is required." }, { status: 400 });
  }

  const identityResult = await resolveConnectingIdentity(req);
  if (!identityResult.ok) {
    return NextResponse.json({ error: identityResult.error }, { status: 401 });
  }
  const identity = identityResult.identity;

  const verification = await verifyChannelOwnershipAndBotAccess(identifier, identity.telegramUserId);
  if (!verification.ok) {
    return NextResponse.json(
      { error: CHANNEL_FAILURE_MESSAGES[verification.reason] ?? "Channel verification failed.", reason: verification.reason },
      { status: 422 }
    );
  }

  const finalized = await finalizeVerifiedChannelConnection(verification, identity, req.headers.get("user-agent"));
  if (!finalized.ok) {
    return NextResponse.json({ error: finalized.error }, { status: finalized.status });
  }

  const res = NextResponse.json({ channel: finalized.result.channel });
  if (finalized.result.newSession) {
    res.cookies.set(SESSION_COOKIE_NAME, finalized.result.newSession.token, {
      ...getSessionCookieOptions(),
      expires: finalized.result.newSession.expiresAt,
    });
    res.cookies.delete(SETUP_COOKIE_NAME);
  }
  return res;
}

/**
 * Disconnects a channel owned by the authenticated creator. Best-effort
 * removes the bot from the channel via Telegram's `leaveChat` method —
 * `botRemoved` in the response accurately reflects whether that call
 * actually succeeded; it is never reported as true when it failed.
 */
export async function DELETE(req: NextRequest) {
  if (!isSameOriginRequest(req)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }

  const user = await getSessionUser(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const channelId = parseInt(searchParams.get("id") || "", 10);
  if (!Number.isFinite(channelId)) {
    return NextResponse.json({ error: "A valid channel id is required" }, { status: 400 });
  }

  const [existing] = await db
    .select()
    .from(channels)
    .where(and(eq(channels.id, channelId), eq(channels.userId, user.id)));

  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let botRemoved = false;
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (botToken && existing.telegramChannelId) {
    try {
      botRemoved = await leaveChannel(botToken, existing.telegramChannelId);
    } catch {
      botRemoved = false;
    }
  }

  const [updated] = await db
    .update(channels)
    .set({
      status: "disconnected",
      isVerified: false,
      // Free the Telegram channel id so it can be reconnected (by this or
      // another account) later; we keep the name/username as a historical
      // record.
      telegramChannelId: null,
      disconnectedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(eq(channels.id, channelId), eq(channels.userId, user.id)))
    .returning();

  if (!updated) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ channel: updated, botRemoved });
}
