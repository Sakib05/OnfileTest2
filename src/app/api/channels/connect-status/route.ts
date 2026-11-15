import { NextRequest, NextResponse } from "next/server";
import { getRequestByRef, getRequestByToken, type PendingChannelRequestRecord } from "@/lib/pendingChannelRequests";
import { CHANNEL_FAILURE_MESSAGES, resolveConnectingIdentity } from "@/lib/channelConnection";
import { createSession, getSessionUser, SESSION_COOKIE_NAME, getSessionCookieOptions } from "@/lib/auth";
import { SETUP_COOKIE_NAME } from "@/lib/setupToken";

/**
 * Polled by the Mini App after it sends the user to Telegram's native chat
 * selector (see /api/channels/connect-request). The actual verification
 * happens out-of-band in /api/telegram/webhook once Telegram confirms the
 * selection; this endpoint only reports that already-verified result back
 * to the browser.
 *
 * The pending request itself now lives in Postgres (see
 * src/lib/pendingChannelRequests.ts), so polling works correctly across
 * different Vercel instances and survives a server restart between the
 * request being created and the webhook resolving it.
 *
 * For brand-new creators, the webhook intentionally does NOT mint a session
 * (there is no browser response for it to attach a cookie to). This route is
 * the first point that actually responds to the browser after verification,
 * so it mints the real session here — and only here, and only once a valid
 * session cookie isn't already present — rather than ever persisting a raw,
 * usable session token in the database while waiting for the browser to
 * poll.
 *
 * Bot-guided flow additions (backwards compatible — `status`/`stage` are unchanged):
 *   - the request can be addressed by `?token=` (the browser's bearer token) OR by
 *     `?ref=` (the public request reference carried by the "Return to Onfile" link, used
 *     when the Mini App was reopened without its local storage). Either way the request
 *     MUST belong to the authenticated Telegram user, otherwise it looks like "expired".
 *   - every answer carries `state` (the derived lifecycle), `expiresAt` and `serverTime`
 *     (UTC ISO strings) so the countdown follows the SERVER clock; an expired request is
 *     reported by the server regardless of what the browser's timer says.
 *   - a "verified" answer is only returned after re-checking that the connected channel
 *     still exists, is verified, and belongs to the account that owns the request.
 *
 * Status values: pending | verified | failed | expired | unauthorized.
 */
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  const refParam = req.nextUrl.searchParams.get("ref");
  if (!token && !refParam) {
    return NextResponse.json({ error: "A token is required" }, { status: 400 });
  }
  const ref = refParam !== null && /^\d{1,10}$/.test(refParam) ? Number(refParam) : null;
  if (!token && ref === null) {
    return NextResponse.json({ error: "A valid request reference is required" }, { status: 400 });
  }

  // The bearer token (or ref) alone is not enough: the request must belong to the
  // Telegram user authenticated by the session / signed setup cookie. A request presented
  // by anyone else is indistinguishable from an unknown one.
  const identityResult = await resolveConnectingIdentity(req);
  if (!identityResult.ok) {
    return NextResponse.json({ status: "unauthorized", error: identityResult.error }, { status: 401 });
  }
  const identity = identityResult.identity;

  let pending: PendingChannelRequestRecord | undefined;
  if (token) {
    pending = await getRequestByToken(token);
    if (pending && pending.identity.telegramUserId !== identity.telegramUserId) {
      console.error("connect_status_identity_mismatch");
      pending = undefined;
    }
  } else if (ref !== null) {
    pending = await getRequestByRef(identity.telegramUserId, ref);
  }
  if (!pending) {
    return NextResponse.json({ status: "expired", state: "expired" }, { status: 404 });
  }

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
    // `stage` lets the UI distinguish "waiting for the user to pick a channel" from
    // "channel selected — verifying with Telegram" (a webhook delivery has claimed the
    // request). `state` is the finer-grained lifecycle.
    return NextResponse.json({ status: "pending", stage: pending.claimed ? "verifying" : "awaiting_selection", ...meta });
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
