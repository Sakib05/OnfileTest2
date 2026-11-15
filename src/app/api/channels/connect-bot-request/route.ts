import { NextRequest, NextResponse } from "next/server";
import { isSameOriginRequest } from "@/lib/auth";
import { resolveConnectingIdentity } from "@/lib/channelConnection";
import { getBotUsername } from "@/lib/telegramBot";
import {
  cancelOpenBotRequestsForUser,
  createPendingChannelRequest,
  getRequestByToken,
} from "@/lib/pendingChannelRequests";
import { getClientIp, rateLimit } from "@/lib/rateLimit";

/**
 * "Start" — step 1 of the bot-guided channel connection flow.
 *
 * Creates ONE pending channel request (state `prepared`) bound to the
 * authenticated Telegram user and returns its opaque polling `token`, the
 * public request `ref` and the bot's real @username. It deliberately does NOT
 * message the user and does NOT start the countdown: that is the job of
 * "Connect" (POST /api/channels/connect-bot-start), which starts the
 * authoritative 10-minute window and delivers the bot message.
 *
 * Duplicate handling: any earlier still-open (unclaimed) bot request of this
 * user is superseded (state `cancelled`), so there is never more than one live
 * request and a second session / double tap can never leave two valid pickers.
 * A request that is already being verified (claimed) is never touched.
 *
 * Identity comes from the session / signed setup cookie
 * (resolveConnectingIdentity) — the browser never supplies a Telegram user id,
 * chat id or channel id. The raw token is only ever returned here; the database
 * keeps its SHA-256 hash.
 */
export async function POST(req: NextRequest) {
  if (!isSameOriginRequest(req)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }

  const ip = getClientIp(req);
  const { allowed } = rateLimit(`channel-connect-bot-request:${ip}`, 10, 60_000);
  if (!allowed) {
    return NextResponse.json({ error: "Too many attempts. Please wait a moment and try again." }, { status: 429 });
  }

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    console.error("connect_bot_request_failed", { stage: "missing_bot_token" });
    return NextResponse.json({ error: "Server is not configured for Telegram channel connections." }, { status: 503 });
  }

  try {
    const identityResult = await resolveConnectingIdentity(req);
    if (!identityResult.ok) {
      return NextResponse.json({ error: identityResult.error }, { status: 401 });
    }
    const identity = identityResult.identity;

    // The configured bot's real @username (from getMe) — never hardcoded. Resolving it here
    // surfaces a misconfigured / unreachable bot at "Start" instead of after "Connect".
    const botUsername = await getBotUsername(botToken);
    if (!botUsername) {
      console.error("connect_bot_request_failed", { stage: "bot_username_unresolved" });
      return NextResponse.json(
        { error: "Channel connection is temporarily unavailable. Please try again later.", reason: "bot_not_resolved" },
        { status: 502 }
      );
    }

    await cancelOpenBotRequestsForUser(identity.telegramUserId);
    const created = await createPendingChannelRequest(identity, { method: "bot" });
    const pending = await getRequestByToken(created.correlationToken);
    if (!pending) {
      console.error("connect_bot_request_failed", { stage: "pending_not_readable" });
      return NextResponse.json({ error: "Internal server error. Please try again shortly." }, { status: 500 });
    }

    return NextResponse.json({
      token: created.correlationToken,
      ref: created.telegramRequestId,
      state: pending.lifecycle, // "prepared"
      botUsername,
      createdAt: pending.createdAt.toISOString(),
      serverTime: new Date().toISOString(),
    });
  } catch (err) {
    console.error("connect_bot_request_failed", {
      stage: "unexpected",
      message: err instanceof Error ? err.message : "unknown_error",
    });
    return NextResponse.json({ error: "Internal server error. Please try again shortly." }, { status: 500 });
  }
}
