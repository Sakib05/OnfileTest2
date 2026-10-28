import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { channels, users } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import {
  createSession,
  getSessionCookieOptions,
  getSessionUser,
  isSameOriginRequest,
  SESSION_COOKIE_NAME,
} from "@/lib/auth";
import { verifySetupToken, SETUP_COOKIE_NAME } from "@/lib/setupToken";
import {
  normalizeChannelIdentifier,
  verifyChannelOwnershipAndBotAccess,
} from "@/lib/telegramBot";
import { getClientIp, rateLimit } from "@/lib/rateLimit";

const FAILURE_MESSAGES: Record<string, string> = {
  missing_bot_token: "Channel verification is temporarily unavailable. Please try again later.",
  invalid_channel: "We couldn't find that channel. Double-check the username or link and try again.",
  not_a_channel: "That identifier isn't a Telegram channel. Groups and users aren't supported.",
  bot_not_in_channel: "Add our bot to your channel as an administrator, then try again.",
  bot_not_admin: "Our bot is in the channel but needs to be an administrator.",
  bot_missing_permissions: "Our bot needs permission to post messages in your channel.",
  user_not_admin: "You must be an administrator (or the owner) of this channel to connect it.",
  telegram_api_error: "We couldn't reach Telegram right now. Please try again shortly.",
  channel_already_connected: "This channel is already connected to another Onfile account.",
};

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
 * Connects + verifies a Telegram channel. This endpoint is reachable in two
 * identity states:
 *   - Returning creator with a valid session: attaches/replaces their
 *     channel.
 *   - New Telegram identity holding a valid (short-lived) setup cookie:
 *     verification success is what finally creates the permanent `users`
 *     row and issues a real session, in the same transaction-like flow.
 *
 * Client-submitted `channelIdentifier` is only ever used to ASK Telegram
 * what the chat is; `isVerified`/ownership is never accepted from the
 * client and is always derived from live Telegram Bot API responses.
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

  // Resolve identity: prefer an existing session (returning creator);
  // otherwise fall back to the short-lived setup cookie (new creator).
  const sessionUser = await getSessionUser(req);
  let telegramUserId: number;
  let telegramProfile: { username?: string; first_name?: string; last_name?: string; photo_url?: string; language_code?: string } | null = null;

  if (sessionUser) {
    if (!sessionUser.telegramId) {
      return NextResponse.json({ error: "Account is missing a linked Telegram identity." }, { status: 409 });
    }
    telegramUserId = Number(sessionUser.telegramId);
  } else {
    const setupToken = req.cookies.get(SETUP_COOKIE_NAME)?.value;
    const setupResult = verifySetupToken(setupToken);
    if (!setupResult.ok) {
      const reasonMessages: Record<string, string> = {
        missing: "Please sign in with Telegram again before connecting a channel.",
        malformed: "Your setup session is invalid. Please sign in with Telegram again.",
        invalid_signature: "Your setup session is invalid. Please sign in with Telegram again.",
        expired: "Your setup session has expired. Please sign in with Telegram again.",
        server_misconfigured: "Server is not configured for account setup. Please try again later.",
      };
      return NextResponse.json({ error: reasonMessages[setupResult.reason] ?? "Setup session invalid." }, { status: 401 });
    }
    telegramUserId = setupResult.user.id;
    telegramProfile = setupResult.user;
  }

  const verification = await verifyChannelOwnershipAndBotAccess(identifier, telegramUserId);
  if (!verification.ok) {
    return NextResponse.json(
      { error: FAILURE_MESSAGES[verification.reason] ?? "Channel verification failed.", reason: verification.reason },
      { status: 422 }
    );
  }

  // Reject if this exact Telegram channel is already actively connected to
  // a DIFFERENT creator account (prevents one channel backing two payouts).
  const [existingChannel] = await db
    .select()
    .from(channels)
    .where(and(eq(channels.telegramChannelId, verification.chat.id), eq(channels.status, "verified")));

  if (existingChannel && (!sessionUser || existingChannel.userId !== sessionUser.id)) {
    return NextResponse.json(
      { error: FAILURE_MESSAGES.channel_already_connected, reason: "channel_already_connected" },
      { status: 409 }
    );
  }

  try {
    let userId: number;
    let justCreatedSession: { token: string; expiresAt: Date } | null = null;

    if (sessionUser) {
      userId = sessionUser.id;
    } else {
      // Finalize account creation now that a channel has been verified.
      // onConflictDoUpdate makes concurrent duplicate setup attempts for the
      // same Telegram account converge on a single row instead of racing.
      const [created] = await db
        .insert(users)
        .values({
          telegramId: String(telegramUserId),
          username: telegramProfile?.username,
          firstName: telegramProfile?.first_name,
          lastName: telegramProfile?.last_name,
          avatarUrl: telegramProfile?.photo_url,
          language: telegramProfile?.language_code ?? "en",
          referralCode: nanoid(8).toUpperCase(),
        })
        .onConflictDoUpdate({
          target: users.telegramId,
          set: { updatedAt: new Date() },
        })
        .returning();
      userId = created.id;
      justCreatedSession = await createSession(userId, req.headers.get("user-agent"));
    }

    if (existingChannel && existingChannel.userId === userId) {
      // Re-verifying the same creator's existing channel row.
      const [updated] = await db
        .update(channels)
        .set({
          channelName: verification.chat.title ?? existingChannel.channelName,
          channelUsername: verification.chat.username ?? existingChannel.channelUsername,
          status: "verified",
          isVerified: true,
          botIsAdmin: true,
          verifiedAt: new Date(),
          lastCheckedAt: new Date(),
          disconnectedAt: null,
          updatedAt: new Date(),
        })
        .where(eq(channels.id, existingChannel.id))
        .returning();

      return finishChannelResponse(updated, justCreatedSession);
    }

    const [channel] = await db
      .insert(channels)
      .values({
        userId,
        telegramChannelId: verification.chat.id,
        channelName: verification.chat.title,
        channelUsername: verification.chat.username,
        status: "verified",
        isVerified: true,
        botIsAdmin: true,
        verifiedAt: new Date(),
        lastCheckedAt: new Date(),
      })
      .returning();

    return finishChannelResponse(channel, justCreatedSession);
  } catch (err) {
    console.error("channel_connect_failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

function finishChannelResponse(
  channel: typeof channels.$inferSelect,
  newSession: { token: string; expiresAt: Date } | null
) {
  const res = NextResponse.json({ channel });
  if (newSession) {
    res.cookies.set(SESSION_COOKIE_NAME, newSession.token, {
      ...getSessionCookieOptions(),
      expires: newSession.expiresAt,
    });
    res.cookies.delete(SETUP_COOKIE_NAME);
  }
  return res;
}

/** Disconnects a channel owned by the authenticated creator. */
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
  return NextResponse.json({ channel: updated });
}
