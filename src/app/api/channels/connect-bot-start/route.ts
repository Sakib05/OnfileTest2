import { NextRequest, NextResponse } from "next/server";
import { isSameOriginRequest } from "@/lib/auth";
import { resolveConnectingIdentity } from "@/lib/channelConnection";
import { getBotUsername } from "@/lib/telegramBot";
import {
  beginBotConnect,
  claimPickerDelivery,
  getRequestByToken,
  releasePickerDelivery,
  revertBotConnectStart,
  type ConnectLifecycleState,
} from "@/lib/pendingChannelRequests";
import {
  buildBotChatLink,
  buildBotDeepLink,
  createBotStartPayload,
  deliverPickerKeyboardToExistingChat,
} from "@/lib/botConnectFlow";
import { getClientIp, rateLimit } from "@/lib/rateLimit";

/**
 * "Connect" — step 2 of the bot-guided channel connection flow.
 *
 *   1. Authenticates the user (session / signed setup cookie — never the browser's word).
 *   2. Loads the request by its bearer token and checks it belongs to that user.
 *   3. Atomically starts the SERVER-SIDE 10-minute window (`connect_started_at`,
 *      `expires_at`). Calling it again is idempotent and never extends the window.
 *   4. Delivers the welcome message + native channel picker:
 *        mode "existing_chat" — the user already started the bot: the server sends the message
 *          itself and `botUrl` is the PLAIN chat link (no `?start=`, so no new "/start").
 *        mode "start_link"    — first-time / blocked user: Telegram forbids bots from messaging
 *          first, so `botUrl` is the signed `?start=` deep link; the webhook delivers the same
 *          message once the user presses Telegram's Start button.
 *      A transient Telegram failure answers 502 and rolls the request back to `prepared` so
 *      "Connect" can simply be tapped again (no half-started countdown).
 *
 * The response carries `expiresAt` + `serverTime` so the Mini App can render a countdown that
 * follows the server clock. The countdown shown in the UI is cosmetic; the server enforces it.
 */
export async function POST(req: NextRequest) {
  if (!isSameOriginRequest(req)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }
  const ip = getClientIp(req);
  const { allowed } = rateLimit(`channel-connect-bot-start:${ip}`, 15, 60_000);
  if (!allowed) {
    return NextResponse.json({ error: "Too many attempts. Please wait a moment and try again." }, { status: 429 });
  }

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    console.error("connect_bot_start_failed", { stage: "missing_bot_token" });
    return NextResponse.json({ error: "Server is not configured for Telegram channel connections." }, { status: 503 });
  }

  let body: { token?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const token = typeof body.token === "string" && body.token ? body.token : null;
  if (!token) return NextResponse.json({ error: "A token is required" }, { status: 400 });

  try {
    const identityResult = await resolveConnectingIdentity(req);
    if (!identityResult.ok) {
      return NextResponse.json({ status: "unauthorized", error: identityResult.error }, { status: 401 });
    }
    const identity = identityResult.identity;

    const existing = await getRequestByToken(token);
    // Unknown token, or someone else's request: indistinguishable on purpose.
    if (!existing || existing.identity.telegramUserId !== identity.telegramUserId) {
      return NextResponse.json(
        { status: "expired", state: "expired", error: "This connection request is no longer active. Please start again." },
        { status: 404 }
      );
    }

    const refusal = (lifecycle: ConnectLifecycleState) =>
      NextResponse.json(
        {
          status: lifecycle === "expired" ? "expired" : lifecycle === "connected" ? "verified" : "failed",
          state: lifecycle,
          error:
            lifecycle === "expired"
              ? "This connection request expired. Please start again."
              : lifecycle === "cancelled"
                ? "This connection request was replaced or cancelled. Please start again."
                : "This connection request can no longer be started. Please start again.",
        },
        { status: lifecycle === "expired" ? 410 : 409 }
      );

    const begun = await beginBotConnect(existing.id);
    if (begun.kind === "not_startable") return refusal(begun.lifecycle);
    const pending = begun.pending;

    const botUsername = await getBotUsername(botToken);
    if (!botUsername) {
      if (begun.kind === "started") await revertBotConnectStart(pending.id);
      console.error("connect_bot_start_failed", { stage: "bot_username_unresolved" });
      return NextResponse.json(
        { error: "Channel connection is temporarily unavailable. Please try again later.", reason: "bot_not_resolved" },
        { status: 502 }
      );
    }

    const base = {
      expiresAt: pending.expiresAt.toISOString(),
      serverTime: new Date().toISOString(),
      botUsername,
      ref: pending.telegramRequestId,
    };

    // Retry / double tap: the message was already delivered — never send a second one.
    if (pending.pickerSentAt) {
      return NextResponse.json({ ...base, state: pending.lifecycle, mode: "existing_chat", botUrl: buildBotChatLink(botUsername) });
    }

    // Reserve delivery BEFORE sending so two concurrent "Connect" calls can't both send.
    if (!(await claimPickerDelivery(pending.id))) {
      return NextResponse.json({
        ...base,
        state: "awaiting_channel_selection",
        mode: "existing_chat",
        botUrl: buildBotChatLink(botUsername),
      });
    }

    const delivery = await deliverPickerKeyboardToExistingChat(identity.telegramUserId, pending);

    if (delivery.mode === "error") {
      await releasePickerDelivery(pending.id);
      await revertBotConnectStart(pending.id);
      console.error("connect_bot_start_failed", { stage: "deliver_keyboard", reason: delivery.reason, detail: delivery.detail });
      return NextResponse.json(
        { error: "We couldn't reach Telegram right now. Please try again shortly.", reason: delivery.reason },
        { status: 502 }
      );
    }

    if (delivery.mode === "existing_chat") {
      return NextResponse.json({
        ...base,
        state: "awaiting_channel_selection",
        mode: "existing_chat",
        botUrl: buildBotChatLink(botUsername),
      });
    }

    // First-time / blocked user: the message is delivered by the webhook after Telegram's Start button.
    await releasePickerDelivery(pending.id);
    const payload = createBotStartPayload(pending.telegramRequestId, identity.telegramUserId);
    return NextResponse.json({
      ...base,
      state: "connecting",
      mode: "start_link",
      fallbackReason: delivery.reason,
      botUrl: buildBotDeepLink(botUsername, payload),
    });
  } catch (err) {
    console.error("connect_bot_start_failed", {
      stage: "unexpected",
      message: err instanceof Error ? err.message : "unknown_error",
    });
    return NextResponse.json({ error: "Internal server error. Please try again shortly." }, { status: 500 });
  }
}
