import { NextRequest, NextResponse } from "next/server";
import { isSameOriginRequest, SESSION_COOKIE_NAME, getSessionCookieOptions } from "@/lib/auth";
import {
  CHANNEL_FAILURE_MESSAGES,
  finalizeVerifiedChannelConnection,
  resolveConnectingIdentity,
} from "@/lib/channelConnection";
import { verifyChannelOwnershipAndBotAccess } from "@/lib/telegramBot";
import { findRecentAdminDiscoveryForUser } from "@/lib/botChannelEvents";
import { INVITE_LINK_FAILURE_MESSAGES, validatePrivateInviteLink } from "@/lib/inviteLink";
import { getClientIp, rateLimit } from "@/lib/rateLimit";
import { SETUP_COOKIE_NAME } from "@/lib/setupToken";

// How recently the bot must have been added as administrator (via a
// Telegram `my_chat_member` update — see /api/telegram/webhook) for Manual
// Connect to accept it. Generous enough to cover a user working through the
// 8-step guide at a normal pace, short enough that a long-stale admin event
// for an unrelated, long-ago channel isn't picked up by mistake.
const DISCOVERY_WINDOW_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Manual Connect's real verification endpoint (Bug 1 fix).
 *
 * CRITICAL CONSTRAINT: the Telegram Bot API has no method that resolves an
 * arbitrary invite-link string into a chat. A bot cannot call `getChat`,
 * `getChatMember`, or anything else with an invite-link hash and learn which
 * channel it belongs to — that capability simply does not exist for bots.
 * So the pasted link can *never* be the thing that gets resolved into a
 * chat id; it is only validated for being a well-formed PRIVATE invite link
 * (see src/lib/inviteLink.ts) as a UX/intent check.
 *
 * The actual channel is discovered independently: step 4 of the guide asks
 * the user to add Onfile Bot as an administrator *before* they ever reach
 * this step. The moment that happens, Telegram sends a `my_chat_member`
 * update to our webhook, which records "Telegram user X added our bot as
 * administrator to channel Y" (see src/lib/botChannelEvents.ts). This route
 * looks up that record for the authenticated user, then independently
 * re-verifies it live (bot is still admin with the right permissions, the
 * channel is private, the user is still an admin/creator of it) before
 * persisting anything — exactly the same verification used by the
 * `chat_shared` picker flow (verifyChannelOwnershipAndBotAccess), so Manual
 * Connect and "Connect Channel via Bot" share one security boundary.
 *
 * If no such admin event has been observed recently, this honestly reports
 * that limitation instead of pretending the invite link itself proves
 * anything — never a fabricated success.
 */
export async function POST(req: NextRequest) {
  if (!isSameOriginRequest(req)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }

  const ip = getClientIp(req);
  const { allowed } = rateLimit(`channel-connect-manual:${ip}`, 10, 60_000);
  if (!allowed) {
    return NextResponse.json({ error: "Too many attempts. Please wait a moment and try again." }, { status: 429 });
  }

  let body: { inviteLink?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const linkValidation = validatePrivateInviteLink(typeof body.inviteLink === "string" ? body.inviteLink : "");
  if (!linkValidation.ok) {
    console.log("connect_manual_invalid_link_format", { reason: linkValidation.reason });
    return NextResponse.json(
      { error: INVITE_LINK_FAILURE_MESSAGES[linkValidation.reason], reason: `invite_link_${linkValidation.reason}` },
      { status: 400 }
    );
  }

  const identityResult = await resolveConnectingIdentity(req);
  if (!identityResult.ok) {
    return NextResponse.json({ error: identityResult.error }, { status: 401 });
  }
  const identity = identityResult.identity;

  try {
    const discovery = await findRecentAdminDiscoveryForUser(identity.telegramUserId, DISCOVERY_WINDOW_MS);
    if (!discovery) {
      console.log("connect_manual_no_admin_discovery", { telegramUserId: identity.telegramUserId });
      return NextResponse.json(
        {
          error:
            "We couldn't confirm that Onfile Bot was added as an administrator to a private channel for your Telegram account yet. Please complete steps 3–5 (add Onfile Bot as an administrator in your channel) first, then press Next again.",
          reason: "bot_admin_not_detected",
        },
        { status: 422 }
      );
    }

    console.log("connect_manual_discovery_found", { telegramUserId: identity.telegramUserId, chatId: discovery.telegramChatId });

    const verification = await verifyChannelOwnershipAndBotAccess(discovery.telegramChatId, identity.telegramUserId);
    if (!verification.ok) {
      console.log("connect_manual_verification_failed", { reason: verification.reason });
      return NextResponse.json(
        { error: CHANNEL_FAILURE_MESSAGES[verification.reason] ?? "Channel verification failed.", reason: verification.reason },
        { status: 422 }
      );
    }

    const finalized = await finalizeVerifiedChannelConnection(verification, identity, req.headers.get("user-agent"));
    if (!finalized.ok) {
      console.error("connect_manual_finalize_failed", { error: finalized.error });
      return NextResponse.json({ error: finalized.error }, { status: finalized.status });
    }

    console.log("connect_manual_connection_persisted", { channelId: finalized.result.channel.id });

    const res = NextResponse.json({ channel: finalized.result.channel });
    if (finalized.result.newSession) {
      res.cookies.set(SESSION_COOKIE_NAME, finalized.result.newSession.token, {
        ...getSessionCookieOptions(),
        expires: finalized.result.newSession.expiresAt,
      });
      res.cookies.delete(SETUP_COOKIE_NAME);
    }
    return res;
  } catch (err) {
    console.error("connect_manual_unexpected_error", err instanceof Error ? err.message : "unknown_error");
    return NextResponse.json({ error: "Internal server error. Please try again shortly." }, { status: 500 });
  }
}
