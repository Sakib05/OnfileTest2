import type { NextRequest } from "next/server";
import { db } from "@/db";
import { channels, users } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { createSession, getSessionUser } from "@/lib/auth";
import { verifySetupToken, SETUP_COOKIE_NAME } from "@/lib/setupToken";
import type { ChannelVerificationResult } from "@/lib/telegramBot";

/**
 * Backend enforcement for the product rule "a creator must have a verified
 * private channel before using channel-dependent features" (publishing
 * files, creating playlists/smart links, etc). This is intentionally the
 * ONLY source of truth consulted by those routes — it re-reads the live
 * `channels` table rather than trusting anything cached on the client
 * (localStorage, React state, etc), so a disconnected/revoked channel
 * immediately blocks those actions again.
 */
export async function userHasVerifiedChannel(userId: number): Promise<boolean> {
  const [row] = await db
    .select({ id: channels.id })
    .from(channels)
    .where(and(eq(channels.userId, userId), eq(channels.status, "verified")))
    .limit(1);
  return !!row;
}

export const CHANNEL_FAILURE_MESSAGES: Record<string, string> = {
  missing_bot_token: "Channel verification is temporarily unavailable. Please try again later.",
  invalid_channel: "We couldn't find that channel. Please try selecting it again.",
  not_a_channel: "That selection isn't a Telegram channel. Groups and users aren't supported.",
  channel_is_public: "Onfile only supports private channels. Please select or create a private channel and try again.",
  bot_not_in_channel: "Add our bot to your channel as an administrator, then try again.",
  bot_not_admin: "Our bot is in the channel but needs to be an administrator.",
  bot_missing_permissions: "Our bot needs permission to post messages in your channel.",
  user_not_admin: "You must be an administrator (or the owner) of this channel to connect it.",
  telegram_api_error: "We couldn't reach Telegram right now. Please try again shortly.",
  channel_already_connected: "This channel is already connected to another Onfile account.",
};

export interface ResolvedConnectingIdentity {
  telegramUserId: number;
  sessionUserId: number | null;
  telegramProfile: {
    username?: string;
    first_name?: string;
    last_name?: string;
    photo_url?: string;
    language_code?: string;
  } | null;
}

export type ResolveIdentityResult =
  | { ok: true; identity: ResolvedConnectingIdentity }
  | { ok: false; error: string };

/**
 * Resolves "who is connecting a channel right now" from a request, exactly
 * the same way for every entry point into channel connection: prefer an
 * existing session (returning creator); otherwise fall back to the
 * short-lived Telegram-identity setup cookie minted right after sign-in.
 * Never trusts anything else supplied by the client.
 */
export async function resolveConnectingIdentity(req: NextRequest): Promise<ResolveIdentityResult> {
  const sessionUser = await getSessionUser(req);
  if (sessionUser) {
    if (!sessionUser.telegramId) {
      return { ok: false, error: "Account is missing a linked Telegram identity." };
    }
    return {
      ok: true,
      identity: { telegramUserId: Number(sessionUser.telegramId), sessionUserId: sessionUser.id, telegramProfile: null },
    };
  }

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
    return { ok: false, error: reasonMessages[setupResult.reason] ?? "Setup session invalid." };
  }

  return {
    ok: true,
    identity: { telegramUserId: setupResult.user.id, sessionUserId: null, telegramProfile: setupResult.user },
  };
}

export interface FinalizedChannelConnection {
  channel: typeof channels.$inferSelect;
  userId: number;
  isNewAccount: boolean;
  newSession: { token: string; expiresAt: Date } | null;
}

export type FinalizeResult =
  | { ok: true; result: FinalizedChannelConnection }
  | { ok: false; error: string; status: number };

export interface FinalizeOptions {
  /**
   * Whether to mint a real session immediately for a brand-new account.
   * Defaults to true, which is correct for synchronous HTTP flows (the
   * legacy manual-identifier endpoint) that can set the session cookie
   * directly on their own response.
   *
   * The asynchronous webhook-driven flow (see
   * src/app/api/telegram/webhook/route.ts) passes `false` here: it has no
   * HTTP response to the *browser* to attach a cookie to, so minting a
   * session there would mean persisting a raw, usable session token in the
   * pending-request table until the browser polls for it. Instead that flow
   * defers session creation to the polling endpoint
   * (/api/channels/connect-status), which creates the session at the moment
   * it can actually deliver the cookie — nothing sensitive sits in the
   * database in the meantime.
   */
  createSessionForNewAccount?: boolean;
}

/**
 * Persists a Telegram-verified channel for the resolved identity. This is
 * the ONLY place a channel row (and, for brand-new creators, the permanent
 * `users` row) is written — called identically whether verification was
 * triggered by the legacy manual-identifier endpoint or by the native
 * chat-selection + webhook flow. `verification` must already come from a
 * live Telegram Bot API check; nothing here trusts client-supplied state.
 */
export async function finalizeVerifiedChannelConnection(
  verification: Extract<ChannelVerificationResult, { ok: true }>,
  identity: ResolvedConnectingIdentity,
  userAgent?: string | null,
  options?: FinalizeOptions
): Promise<FinalizeResult> {
  const createSessionForNewAccount = options?.createSessionForNewAccount ?? true;
  // Reject if this exact Telegram channel is already actively connected to a
  // DIFFERENT creator account (prevents one channel backing two payouts).
  const [existingChannel] = await db
    .select()
    .from(channels)
    .where(and(eq(channels.telegramChannelId, verification.chat.id), eq(channels.status, "verified")));

  if (existingChannel && existingChannel.userId !== identity.sessionUserId) {
    return { ok: false, error: CHANNEL_FAILURE_MESSAGES.channel_already_connected, status: 409 };
  }

  try {
    let userId: number;
    let isNewAccount = false;
    let justCreatedSession: { token: string; expiresAt: Date } | null = null;

    if (identity.sessionUserId) {
      userId = identity.sessionUserId;
    } else {
      // Finalize account creation now that a channel has been verified.
      const [created] = await db
        .insert(users)
        .values({
          telegramId: String(identity.telegramUserId),
          username: identity.telegramProfile?.username,
          firstName: identity.telegramProfile?.first_name,
          lastName: identity.telegramProfile?.last_name,
          avatarUrl: identity.telegramProfile?.photo_url,
          language: identity.telegramProfile?.language_code ?? "en",
          referralCode: nanoid(8).toUpperCase(),
        })
        .onConflictDoUpdate({
          target: users.telegramId,
          set: { updatedAt: new Date() },
        })
        .returning();
      userId = created.id;
      isNewAccount = true;
      if (createSessionForNewAccount) {
        justCreatedSession = await createSession(userId, userAgent ?? null);
      }
    }

    if (existingChannel && existingChannel.userId === userId) {
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

      return { ok: true, result: { channel: updated, userId, isNewAccount, newSession: justCreatedSession } };
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

    return { ok: true, result: { channel, userId, isNewAccount, newSession: justCreatedSession } };
  } catch (err) {
    console.error("channel_connect_failed", err instanceof Error ? err.message : "unknown_error");
    return { ok: false, error: "Internal server error", status: 500 };
  }
}
