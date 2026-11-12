import { NextRequest, NextResponse } from "next/server";
import { isSameOriginRequest } from "@/lib/auth";
import { resolveConnectingIdentity } from "@/lib/channelConnection";
import { getBotUsername } from "@/lib/telegramBot";
import { createPendingChannelRequest } from "@/lib/pendingChannelRequests";
import { buildBotDeepLink, createBotStartPayload } from "@/lib/botConnectFlow";
import { getClientIp, rateLimit } from "@/lib/rateLimit";

/**
 * Step 1 of the "Connect channel via bot" fallback (for Telegram clients
 * that cannot use the Mini App Direct Channel Picker). Creates a pending
 * channel request bound to the authenticated Telegram user and returns:
 *   - `token`: the opaque polling bearer for /api/channels/connect-status
 *     (same mechanism as the Direct Picker; only its hash is stored), and
 *   - `botUrl`: `https://t.me/<configured bot>?start=<signed payload>`.
 * The payload is an HMAC-signed, user-bound reference to the request — it
 * contains no secret and is useless to anyone but the intended user, and
 * only until the request expires (10 min) or is used.
 *
 * The browser never supplies a Telegram id: identity comes from the
 * session / signed setup cookie via resolveConnectingIdentity, exactly like
 * /api/channels/connect-request.
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

    // The configured bot's real @username (from getMe) — never hardcoded.
    const botUsername = await getBotUsername(botToken);
    if (!botUsername) {
      console.error("connect_bot_request_failed", { stage: "bot_username_unresolved" });
      return NextResponse.json(
        { error: "Channel connection is temporarily unavailable. Please try again later.", reason: "bot_not_resolved" },
        { status: 502 }
      );
    }

    const pending = await createPendingChannelRequest(identity, { method: "bot" });
    const payload = createBotStartPayload(pending.telegramRequestId, identity.telegramUserId);

    return NextResponse.json({
      token: pending.correlationToken,
      botUrl: buildBotDeepLink(botUsername, payload),
      botUsername,
    });
  } catch (err) {
    console.error("connect_bot_request_failed", {
      stage: "unexpected",
      message: err instanceof Error ? err.message : "unknown_error",
    });
    return NextResponse.json({ error: "Internal server error. Please try again shortly." }, { status: 500 });
  }
}
