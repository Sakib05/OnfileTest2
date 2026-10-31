import { NextRequest, NextResponse } from "next/server";
import { isSameOriginRequest } from "@/lib/auth";
import { resolveConnectingIdentity } from "@/lib/channelConnection";
import { createPreparedChatRequestButton } from "@/lib/telegramBot";
import { createPendingChannelRequest } from "@/lib/pendingChannelRequests";
import { getClientIp, rateLimit } from "@/lib/rateLimit";

const REQUEST_FAILURE_MESSAGES: Record<string, string> = {
  missing_bot_token: "Channel connection is temporarily unavailable. Please try again later.",
  bot_not_resolved: "Channel connection is temporarily unavailable. Please try again later.",
  telegram_api_error: "We couldn't reach Telegram right now. Please try again shortly.",
};

/**
 * Step 1 of the native Telegram direct-picker channel connection flow:
 * stores a `request_chat` keyboard button scoped to the signed-in Telegram
 * user via the Bot API method `savePreparedKeyboardButton`, and returns its
 * `id` to the browser. The Mini App then calls
 * `Telegram.WebApp.requestChat(id)` directly from the user's tap — opening
 * Telegram's native "Select a chat" screen immediately, with no bot chat to
 * open first. See src/lib/telegramBot.ts for the full flow explanation.
 */
export async function POST(req: NextRequest) {
  if (!isSameOriginRequest(req)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }

  const ip = getClientIp(req);
  const { allowed } = rateLimit(`channel-connect-request:${ip}`, 10, 60_000);
  if (!allowed) {
    return NextResponse.json({ error: "Too many attempts. Please wait a moment and try again." }, { status: 429 });
  }

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    console.error("connect_request_failed", { stage: "missing_bot_token" });
    return NextResponse.json(
      { error: "Server is not configured for Telegram channel connections." },
      { status: 503 }
    );
  }

  // Everything below performs network calls to Telegram and writes to the
  // database. Wrapped in a try/catch (mirroring every other route in this
  // codebase, e.g. /api/auth/telegram) so an unexpected exception here —
  // a dropped DB connection, an unhandled Telegram API shape, etc. — always
  // produces a clean, logged JSON response instead of an uncaught error
  // reaching the Vercel runtime, which is what turns into an opaque 502
  // with no application-level detail.
  try {
    const identityResult = await resolveConnectingIdentity(req);
    if (!identityResult.ok) {
      return NextResponse.json({ error: identityResult.error }, { status: 401 });
    }
    const identity = identityResult.identity;

    let pending: Awaited<ReturnType<typeof createPendingChannelRequest>>;
    try {
      pending = await createPendingChannelRequest(identity);
    } catch (err) {
      console.error("connect_request_failed", {
        stage: "create_pending_request",
        message: err instanceof Error ? err.message : "unknown_error",
      });
      return NextResponse.json(
        { error: "Could not start the connection flow. Please try again." },
        { status: 500 }
      );
    }

    const prepared = await createPreparedChatRequestButton(botToken, identity.telegramUserId, pending.telegramRequestId);
    if (!prepared.ok) {
      // The underlying Telegram description/error code was already logged
      // inside createPreparedChatRequestButton/callTelegramApi (safe: no
      // bot token, no DB credentials). Stage logged here so the two log
      // lines can be correlated to this specific request.
      console.error("connect_request_failed", { stage: "save_prepared_keyboard_button", reason: prepared.reason });
      return NextResponse.json(
        { error: REQUEST_FAILURE_MESSAGES[prepared.reason] ?? "Could not start the connection flow.", reason: prepared.reason },
        { status: 502 }
      );
    }

    return NextResponse.json({ token: pending.correlationToken, preparedButtonId: prepared.preparedButtonId });
  } catch (err) {
    console.error("connect_request_failed", {
      stage: "unexpected",
      message: err instanceof Error ? err.message : "unknown_error",
    });
    return NextResponse.json({ error: "Internal server error. Please try again shortly." }, { status: 500 });
  }
}
