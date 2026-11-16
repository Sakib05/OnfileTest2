import { NextResponse, type NextRequest } from "next/server";
import { CHANNEL_FAILURE_MESSAGES, type ResolvedConnectingIdentity } from "@/lib/channelConnection";
import { createSession, getSessionUser, SESSION_COOKIE_NAME, getSessionCookieOptions } from "@/lib/auth";
import { SETUP_COOKIE_NAME } from "@/lib/setupToken";
import type { PendingChannelRequestRecord } from "@/lib/pendingChannelRequests";

/**
 * The one JSON shape every channel-connection status endpoint answers with (GET /api/channels/connect-status
 * and POST /api/channels/connect-verify), derived purely from the stored request:
 *
 *   pending   + stage awaiting_selection | channel_selected | verifying
 *   failed    + error/reason
 *   verified  + channel   (only after the server re-checked the channel really is connected to the right account)
 *   expired   (404)
 *
 * Read-only apart from minting the session cookie of a brand-new account once its channel is verified.
 */
export async function buildConnectStatusResponse(
  req: NextRequest,
  pending: PendingChannelRequestRecord,
  identity: ResolvedConnectingIdentity
): Promise<NextResponse> {
  const meta = {
    state: pending.lifecycle,
    expiresAt: pending.expiresAt.toISOString(),
    serverTime: new Date().toISOString(),
    ref: pending.telegramRequestId,
  };

  if (pending.lifecycle === "expired") {
    return NextResponse.json({ status: "expired", ...meta }, { status: 404 });
  }

  if (pending.status === "pending") {
    // `stage` lets the UI tell apart: nothing selected yet → `awaiting_selection`; a channel was shared but the
    // user has not tapped Verify yet → `channel_selected`; the Verify action is checking with Telegram right
    // now → `verifying`. `state` is the finer-grained lifecycle.
    const stage = pending.claimed ? "verifying" : pending.selectedChatId ? "channel_selected" : "awaiting_selection";
    return NextResponse.json({ status: "pending", stage, ...meta });
  }

  if (pending.status === "failed") {
    return NextResponse.json({
      status: "failed",
      error: CHANNEL_FAILURE_MESSAGES[pending.failureReason ?? ""] ?? "Channel verification failed.",
      reason: pending.failureReason,
      ...meta,
    });
  }

  // status === "verified": confirm the connection really exists for the right account.
  const channel = pending.channel;
  const ownerOk =
    !!channel &&
    channel.status === "verified" &&
    pending.resolvedUserId !== null &&
    channel.userId === pending.resolvedUserId &&
    (identity.sessionUserId === null || identity.sessionUserId === pending.resolvedUserId);
  if (!ownerOk) {
    console.error("connect_status_verification_mismatch", { pendingId: pending.id });
    return NextResponse.json({
      status: "failed",
      error: CHANNEL_FAILURE_MESSAGES.verification_mismatch,
      reason: "verification_mismatch",
      ...meta,
      state: "failed",
    });
  }

  const res = NextResponse.json({ status: "verified", channel, ...meta });

  if (pending.isNewAccount && pending.resolvedUserId) {
    // Avoid minting a redundant session if the browser already picked one up
    // from an earlier successful poll (e.g. a retried/duplicate request).
    const existingUser = await getSessionUser(req);
    if (!existingUser || existingUser.id !== pending.resolvedUserId) {
      const { token: sessionToken, expiresAt } = await createSession(pending.resolvedUserId, req.headers.get("user-agent"));
      res.cookies.set(SESSION_COOKIE_NAME, sessionToken, { ...getSessionCookieOptions(), expires: expiresAt });
      res.cookies.delete(SETUP_COOKIE_NAME);
    }
  }

  return res;
}
