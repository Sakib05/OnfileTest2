import { NextRequest, NextResponse } from "next/server";
import { getRequestByRef, getRequestByToken, type PendingChannelRequestRecord } from "@/lib/pendingChannelRequests";
import { resolveConnectingIdentity } from "@/lib/channelConnection";
import { buildConnectStatusResponse } from "@/lib/connectStatusResponse";

/**
 * READ-ONLY status of a channel-connection request, polled by the Mini App (and used by the Verify screen
 * while a verification is in flight). It never verifies or connects anything: verification is started only
 * by POST /api/channels/connect-verify, after the user taps Verify. Telegram's `chat_shared` webhook merely
 * stores the selected channel, which shows up here as `stage: "channel_selected"`.
 *
 * The pending request lives in Postgres (see src/lib/pendingChannelRequests.ts), so polling works across
 * serverless instances and survives restarts.
 *
 * The request can be addressed by `?token=` (the browser's bearer token) OR by `?ref=` (the public request
 * reference carried by the bot's Verify button). Either way the request MUST belong to the authenticated
 * Telegram user, otherwise it looks like "expired". Every answer carries `state` (the derived lifecycle),
 * `expiresAt` and `serverTime` (UTC ISO strings); an expired request is reported by the server regardless of
 * what the browser's timer says. A "verified" answer is only returned after re-checking that the connected
 * channel still exists, is verified, and belongs to the account that owns the request. For brand-new creators
 * the session cookie is minted here (see buildConnectStatusResponse).
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

  return buildConnectStatusResponse(req, pending, identity);
}
