import { NextRequest, NextResponse } from "next/server";
import { isSameOriginRequest } from "@/lib/auth";
import { resolveConnectingIdentity } from "@/lib/channelConnection";
import { getBotUsername } from "@/lib/telegramBot";
import {
  cancelOpenBotRequestsForUser,
  cancelPendingByToken,
  createPendingChannelRequest,
  getPendingByToken,
} from "@/lib/pendingChannelRequests";
import {
  buildBotChatLink,
  buildBotDeepLink,
  createBotStartPayload,
  deliverPickerKeyboardToExistingChat,
} from "@/lib/botConnectFlow";
import { getClientIp, rateLimit } from "@/lib/rateLimit";

/**
 * Step 1 of the "Connect channel via bot" fallback (for Telegram clients
 * that cannot use the Mini App Direct Channel Picker). Creates ONE pending
 * channel request bound to the authenticated Telegram user (superseding any
 * earlier still-open bot request of theirs, so no duplicates pile up) and
 * decides HOW the user reaches the channel-selection keyboard:
 *
 *   mode "existing_chat" — the user already has a verified private chat with
 *     the bot. The server sends the "Select channel to connect" keyboard
 *     itself (sendMessage to that stored chat id) and `botUrl` is the PLAIN
 *     chat link `https://t.me/<bot>` — NO `?start=`, so Telegram posts no new
 *     "/start". (Telegram only allows this once the user has started the bot.)
 *   mode "start_link" — the bot cannot message the user (never started it,
 *     blocked it, or the stored chat is invalid). `botUrl` is the signed
 *     `https://t.me/<bot>?start=<HMAC payload>` deep link; Telegram's required
 *     first-time Start delivers the payload and the webhook sends the keyboard.
 *     `fallbackReason` says why (no_chat | bot_blocked | chat_invalid | lookup_failed).
 *   A transient Telegram error answers 502 and cancels the request — it never
 *   silently degrades to the start link (which would cause a "/start").
 *
 * Response also carries `token`: the opaque polling bearer for
 * /api/channels/connect-status (same mechanism as the Direct Picker; only its
 * hash is stored). The signed payload contains no secret, is user-bound and
 * is only valid until the request expires (10 min) or is used.
 *
 * The browser never supplies a Telegram user id or chat id: identity comes
 * from the session / signed setup cookie via resolveConnectingIdentity,
 * exactly like /api/channels/connect-request, and the chat id comes from our
 * own verified store (see src/lib/botPrivateChats.ts).
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

    // Only the newest request may complete: supersede earlier open bot requests.
    await cancelOpenBotRequestsForUser(identity.telegramUserId);
    const created = await createPendingChannelRequest(identity, { method: "bot" });
    const pending = await getPendingByToken(created.correlationToken);
    if (!pending) {
      console.error("connect_bot_request_failed", { stage: "pending_not_readable" });
      return NextResponse.json({ error: "Internal server error. Please try again shortly." }, { status: 500 });
    }

    const delivery = await deliverPickerKeyboardToExistingChat(identity.telegramUserId, pending);

    if (delivery.mode === "error") {
      await cancelPendingByToken(created.correlationToken);
      console.error("connect_bot_request_failed", { stage: "deliver_keyboard", reason: delivery.reason, detail: delivery.detail });
      return NextResponse.json(
        { error: "We couldn't reach Telegram right now. Please try again shortly.", reason: delivery.reason },
        { status: 502 }
      );
    }

    if (delivery.mode === "existing_chat") {
      return NextResponse.json({
        token: created.correlationToken,
        mode: "existing_chat",
        botUrl: buildBotChatLink(botUsername),
        botUsername,
      });
    }

    const payload = createBotStartPayload(created.telegramRequestId, identity.telegramUserId);
    return NextResponse.json({
      token: created.correlationToken,
      mode: "start_link",
      fallbackReason: delivery.reason,
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
