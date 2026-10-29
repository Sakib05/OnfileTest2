import { NextRequest, NextResponse } from "next/server";
import { isSameOriginRequest } from "@/lib/auth";
import { resolveConnectingIdentity } from "@/lib/channelConnection";
import { getBotUsername, sendChatSelectionPrompt } from "@/lib/telegramBot";
import { createPendingChannelRequest } from "@/lib/pendingChannelRequests";
import { getClientIp, rateLimit } from "@/lib/rateLimit";

const REQUEST_FAILURE_MESSAGES: Record<string, string> = {
  missing_bot_token: "Channel connection is temporarily unavailable. Please try again later.",
  bot_not_resolved: "Channel connection is temporarily unavailable. Please try again later.",
  telegram_api_error: "We couldn't reach Telegram right now. Please try again shortly.",
};

/**
 * Step 1 of the native Telegram channel connection flow: sends the signed-in
 * Telegram user a message (in their private chat with the bot) containing a
 * `request_chat` keyboard button. Tapping it opens Telegram's own "Select a
 * chat" screen, which will also prompt to add the bot as an administrator
 * with the exact rights Onfile needs if it isn't one already — both native
 * Telegram screens, not anything rendered by Onfile.
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
    return NextResponse.json(
      { error: "Server is not configured for Telegram channel connections." },
      { status: 503 }
    );
  }

  const identityResult = await resolveConnectingIdentity(req);
  if (!identityResult.ok) {
    return NextResponse.json({ error: identityResult.error }, { status: 401 });
  }
  const identity = identityResult.identity;

  const botUsername = await getBotUsername(botToken);
  if (!botUsername) {
    return NextResponse.json({ error: REQUEST_FAILURE_MESSAGES.bot_not_resolved }, { status: 503 });
  }

  const pending = await createPendingChannelRequest(identity);

  const sendResult = await sendChatSelectionPrompt(botToken, identity.telegramUserId, pending.telegramRequestId);
  if (!sendResult.ok) {
    if (sendResult.reason === "cannot_message_user") {
      return NextResponse.json(
        {
          error: "Open your chat with the Onfile bot and tap Start, then try again.",
          reason: "cannot_message_user",
          botUsername,
        },
        { status: 409 }
      );
    }
    return NextResponse.json(
      { error: REQUEST_FAILURE_MESSAGES[sendResult.reason] ?? "Could not start the connection flow.", reason: sendResult.reason },
      { status: 502 }
    );
  }

  return NextResponse.json({ token: pending.correlationToken, botUsername });
}
