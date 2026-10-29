import { NextRequest, NextResponse } from "next/server";
import { verifyChannelOwnershipAndBotAccess } from "@/lib/telegramBot";
import { finalizeVerifiedChannelConnection } from "@/lib/channelConnection";
import { getPendingByTelegramRequest, updatePendingChannelRequest } from "@/lib/pendingChannelRequests";

interface TelegramChatShared {
  request_id: number;
  chat_id: number;
  title?: string;
  username?: string;
}

interface TelegramUpdate {
  update_id: number;
  message?: {
    chat: { id: number; type: string };
    from?: { id: number };
    chat_shared?: TelegramChatShared;
  };
}

/**
 * Receives Telegram Bot API updates. The only update this route currently
 * acts on is the `chat_shared` service message produced by the native
 * `request_chat` keyboard button (see /api/channels/connect-request) —
 * Telegram's confirmation that the user picked a channel (and, if needed,
 * added the bot as an administrator with the requested rights).
 *
 * Nothing from this payload is trusted at face value: the bot's admin
 * status and the user's admin/creator status are independently re-verified
 * against the live Telegram Bot API before anything is persisted (see
 * verifyChannelOwnershipAndBotAccess). This endpoint is idempotent —
 * duplicate/replayed updates for an already-resolved request are ignored —
 * and always responds 200 so Telegram does not endlessly retry delivery.
 *
 * Requires `TELEGRAM_WEBHOOK_SECRET` to be configured and the webhook to be
 * registered with Telegram (via `setWebhook`, including the matching
 * `secret_token`) outside of this code — that one-time setup is a deployment
 * step, not something this route can perform for itself.
 */
export async function POST(req: NextRequest) {
  const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (expectedSecret) {
    const providedSecret = req.headers.get("x-telegram-bot-api-secret-token");
    if (providedSecret !== expectedSecret) {
      return NextResponse.json({ ok: false }, { status: 401 });
    }
  }

  let update: TelegramUpdate;
  try {
    update = await req.json();
  } catch {
    return NextResponse.json({ ok: true });
  }

  try {
    const chatShared = update.message?.chat_shared;
    const telegramUserId = update.message?.from?.id;

    if (!chatShared || !telegramUserId) {
      // Not an update this route handles (e.g. a regular text message).
      return NextResponse.json({ ok: true });
    }

    const pending = getPendingByTelegramRequest(telegramUserId, chatShared.request_id);
    if (!pending) {
      // Unknown or already-expired request — ignore rather than guess.
      return NextResponse.json({ ok: true });
    }
    if (pending.status !== "pending") {
      // Already resolved (duplicate delivery); no-op keeps this idempotent.
      return NextResponse.json({ ok: true });
    }

    const verification = await verifyChannelOwnershipAndBotAccess(String(chatShared.chat_id), telegramUserId);
    if (!verification.ok) {
      updatePendingChannelRequest(pending.correlationToken, {
        status: "failed",
        failureReason: verification.reason,
      });
      return NextResponse.json({ ok: true });
    }

    const finalized = await finalizeVerifiedChannelConnection(verification, pending.identity, req.headers.get("user-agent"));
    if (!finalized.ok) {
      updatePendingChannelRequest(pending.correlationToken, {
        status: "failed",
        failureReason: "telegram_api_error",
      });
      return NextResponse.json({ ok: true });
    }

    updatePendingChannelRequest(pending.correlationToken, {
      status: "verified",
      channel: finalized.result.channel,
      newSession: finalized.result.newSession ?? undefined,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("telegram_webhook_failed", err instanceof Error ? err.message : "unknown_error");
    // Still 200: Telegram would otherwise retry indefinitely for a problem
    // that a retry won't fix.
    return NextResponse.json({ ok: true });
  }
}
