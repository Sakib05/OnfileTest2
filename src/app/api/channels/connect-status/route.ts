import { NextRequest, NextResponse } from "next/server";
import { getPendingByToken } from "@/lib/pendingChannelRequests";
import { CHANNEL_FAILURE_MESSAGES } from "@/lib/channelConnection";
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
 */
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  if (!token) {
    return NextResponse.json({ error: "A token is required" }, { status: 400 });
  }

  const pending = await getPendingByToken(token);
  if (!pending) {
    return NextResponse.json({ status: "expired" }, { status: 404 });
  }

  if (pending.status === "pending") {
    return NextResponse.json({ status: "pending" });
  }

  if (pending.status === "failed") {
    return NextResponse.json({
      status: "failed",
      error: CHANNEL_FAILURE_MESSAGES[pending.failureReason ?? ""] ?? "Channel verification failed.",
      reason: pending.failureReason,
    });
  }

  const res = NextResponse.json({ status: "verified", channel: pending.channel });

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
