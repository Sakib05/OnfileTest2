import { NextRequest, NextResponse } from "next/server";
import { getPendingByToken } from "@/lib/pendingChannelRequests";
import { CHANNEL_FAILURE_MESSAGES } from "@/lib/channelConnection";
import { SESSION_COOKIE_NAME, getSessionCookieOptions } from "@/lib/auth";
import { SETUP_COOKIE_NAME } from "@/lib/setupToken";

/**
 * Polled by the Mini App after it sends the user to Telegram's native chat
 * selector (see /api/channels/connect-request). The actual verification
 * happens out-of-band in /api/telegram/webhook once Telegram confirms the
 * selection; this endpoint only reports that already-verified result back
 * to the browser and — for brand-new creators — hands over the real session
 * cookie that was minted during verification.
 */
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  if (!token) {
    return NextResponse.json({ error: "A token is required" }, { status: 400 });
  }

  const pending = getPendingByToken(token);
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
  if (pending.newSession) {
    res.cookies.set(SESSION_COOKIE_NAME, pending.newSession.token, {
      ...getSessionCookieOptions(),
      expires: pending.newSession.expiresAt,
    });
    res.cookies.delete(SETUP_COOKIE_NAME);
  }
  return res;
}
