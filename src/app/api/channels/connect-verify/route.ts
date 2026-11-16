import { NextRequest, NextResponse } from "next/server";
import { isSameOriginRequest } from "@/lib/auth";
import { CHANNEL_FAILURE_MESSAGES, resolveConnectingIdentity } from "@/lib/channelConnection";
import { buildConnectStatusResponse } from "@/lib/connectStatusResponse";
import { verifyPendingChannelRequest } from "@/lib/connectVerification";
import { getRequestByRef, getRequestByToken, type PendingChannelRequestRecord } from "@/lib/pendingChannelRequests";
import { getClientIp, rateLimit } from "@/lib/rateLimit";

/**
 * "Verify": the Mini App's user-triggered start of the REAL channel verification.
 *
 * The bot's "Verify" button opens the Mini App at `/?connect=<ref>`; the Mini App signs the Telegram user in and
 * calls this endpoint. Only now does the backend check the channel against Telegram and — if every check passes
 * — connect it (see verifyPendingChannelRequest). The Telegram webhook never does this.
 *
 * Request body: `{ ref: number }` (the public request reference from the Verify link) or `{ token: string }`
 * (the browser's bearer token). Neither is a credential on its own: the request must belong to the Telegram user
 * authenticated by the session / signed setup cookie, otherwise the answer is the same as for an unknown request.
 * No channel id, user id or verdict is ever read from the client — the channel is the one the webhook stored.
 *
 * Idempotent and race-safe: repeated taps, refreshes, two devices or simultaneous calls resolve to one outcome;
 * the request is finalized at most once (atomic claim) and a resolved request is only ever reported, not redone.
 *
 * Answers with the same JSON shape as GET /api/channels/connect-status.
 */
export async function POST(req: NextRequest) {
  if (!isSameOriginRequest(req)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }

  const ip = getClientIp(req);
  const { allowed } = rateLimit(`channel-connect-verify:${ip}`, 30, 60_000);
  if (!allowed) {
    return NextResponse.json({ error: "Too many attempts. Please wait a moment and try again." }, { status: 429 });
  }

  let body: { ref?: unknown; token?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const token = typeof body.token === "string" && body.token ? body.token : null;
  const ref = typeof body.ref === "number" && Number.isSafeInteger(body.ref) && body.ref > 0 ? body.ref : null;
  if (!token && ref === null) {
    return NextResponse.json({ error: "A valid request reference is required" }, { status: 400 });
  }

  // Who is verifying: the authenticated Telegram user, never anything supplied by the body.
  const identityResult = await resolveConnectingIdentity(req);
  if (!identityResult.ok) {
    return NextResponse.json({ status: "unauthorized", error: identityResult.error }, { status: 401 });
  }
  const identity = identityResult.identity;

  const load = async (): Promise<PendingChannelRequestRecord | undefined> => {
    if (token) {
      const found = await getRequestByToken(token);
      if (found && found.identity.telegramUserId !== identity.telegramUserId) {
        console.error("connect_verify_identity_mismatch");
        return undefined;
      }
      return found;
    }
    return getRequestByRef(identity.telegramUserId, ref as number);
  };

  try {
    const pending = await load();
    if (!pending) {
      return NextResponse.json({ status: "expired", state: "expired" }, { status: 404 });
    }

    const step = await verifyPendingChannelRequest(pending, req.headers.get("user-agent"));

    if (step.kind === "retryable") {
      // Nothing was decided and nothing was connected; the user can simply tap Verify again.
      return NextResponse.json(
        {
          status: "failed",
          retryable: true,
          reason: step.reason,
          error: CHANNEL_FAILURE_MESSAGES[step.reason] ?? "We couldn't verify your channel right now. Please try again.",
        },
        { status: 503 }
      );
    }

    // Everything else is reported from the stored state (the single source of truth).
    const current = (await load()) ?? pending;
    return buildConnectStatusResponse(req, current, identity);
  } catch (err) {
    console.error("connect_verify_failed", err instanceof Error ? err.message : "unknown_error");
    return NextResponse.json({ error: "We couldn't verify your channel right now. Please try again." }, { status: 500 });
  }
}
