import { NextRequest, NextResponse } from "next/server";
import { isSameOriginRequest } from "@/lib/auth";
import { cancelPendingByToken } from "@/lib/pendingChannelRequests";
import { getClientIp, rateLimit } from "@/lib/rateLimit";

/**
 * Lets the browser proactively mark its own in-flight connection request as
 * cancelled as soon as `Telegram.WebApp.requestChat`'s callback reports the
 * selection was not sent (the user dismissed the native chat picker, or
 * Telegram could not deliver the resulting `chat_shared` message) — instead
 * of leaving the request in "pending" until its TTL expires. The token is
 * the same opaque, unguessable bearer used to poll
 * /api/channels/connect-status; nothing here accepts or trusts a
 * Telegram/user id directly from the client.
 */
export async function POST(req: NextRequest) {
  if (!isSameOriginRequest(req)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }

  const ip = getClientIp(req);
  const { allowed } = rateLimit(`channel-connect-cancel:${ip}`, 20, 60_000);
  if (!allowed) {
    return NextResponse.json({ error: "Too many attempts. Please wait a moment and try again." }, { status: 429 });
  }

  let body: { token?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const token = typeof body.token === "string" ? body.token : null;
  if (!token) {
    return NextResponse.json({ error: "A token is required" }, { status: 400 });
  }

  try {
    const cancelled = await cancelPendingByToken(token);
    return NextResponse.json({ ok: true, cancelled });
  } catch (err) {
    console.error("connect_cancel_failed", err instanceof Error ? err.message : "unknown_error");
    // Never blocks the client from resetting its own UI state.
    return NextResponse.json({ ok: true, cancelled: false });
  }
}
