/**
 * Client helpers for the Telegram bot's "Verify" button.
 *
 * The button opens the Mini App at `/?connect=<public request ref>`. The Mini App then asks the backend to
 * verify THAT EXISTING request:
 *
 *   - `submitVerification(ref)` → POST /api/channels/connect-verify — the user-triggered start of the real
 *     verification. The server (never the client) checks the request, the Telegram identity, the channel the
 *     webhook stored, its privacy, the user's admin rights and the bot's admin permissions, and connects the
 *     channel only if all of that succeeds. Repeating it is safe (idempotent, atomic claim).
 *   - `fetchVerifyOutcome(ref)` → GET /api/channels/connect-status?ref= — read-only; used to wait for a
 *     verification that is already running (another tap / device).
 *
 * Nothing in the URL (or in this module) is trusted: a channel id / title / verdict is never read from the client.
 */

export interface VerifiedChannelSummary {
  id: number;
  channelName: string | null;
  channelUsername: string | null;
}

export type VerifyOutcome =
  | { kind: "verified"; channel: VerifiedChannelSummary }
  /** A verification is running with Telegram right now (this or another tap) — worth polling briefly. */
  | { kind: "verifying" }
  /** The user tapped Verify before choosing a channel in the bot chat. */
  | { kind: "awaiting_selection" }
  /** A channel is selected but its verification has not (successfully) started — tapping Verify again does it. */
  | { kind: "channel_selected" }
  | { kind: "failed"; message: string; reason?: string }
  /** Unknown ref, another user's ref, or past the server-authoritative expiry (the server never distinguishes). */
  | { kind: "expired" }
  | { kind: "unauthorized"; message: string }
  /** Network / 5xx / unrecognised body — NOT a verdict about the connection. */
  | { kind: "error" };

export const VERIFY_ERROR_COPY = {
  expired:
    "This verification link has expired or isn’t valid for your account. Open Channel Management in Onfile and connect your channel again.",
  awaiting_selection:
    "We haven’t received your channel selection yet. Choose your channel in the Onfile bot chat, then tap Verify again.",
  channel_selected: "Your channel is selected but couldn’t be verified yet. Tap Try Again to verify it.",
  verifying: "We’re still verifying your channel with Telegram. Please try again in a moment.",
  unauthorized: "Your Telegram session couldn’t be confirmed. Please reopen Onfile from Telegram and try again.",
  network: "We couldn’t reach Onfile to verify your connection. Check your connection and try again.",
  dashboard: "Your channel is verified, but we couldn’t load your dashboard. Please try again.",
  notTelegram: "Open Onfile from inside Telegram to verify your connection.",
  signIn: "We couldn’t sign you in with Telegram. Please try again.",
} as const;

/** Maps a /api/channels/connect-status response onto a typed outcome. */
export function interpretVerifyResponse(res: { ok: boolean }, data: Record<string, unknown> | null): VerifyOutcome {
  const status = data?.status;
  const channel = data?.channel as Record<string, unknown> | undefined;
  if (status === "verified" && res.ok && channel && typeof channel.id === "number" && channel.status === "verified") {
    return {
      kind: "verified",
      channel: {
        id: channel.id,
        channelName: typeof channel.channelName === "string" ? channel.channelName : null,
        channelUsername: typeof channel.channelUsername === "string" ? channel.channelUsername : null,
      },
    };
  }
  if (status === "pending") {
    if (data?.stage === "verifying") return { kind: "verifying" };
    return data?.stage === "channel_selected" ? { kind: "channel_selected" } : { kind: "awaiting_selection" };
  }
  if (status === "failed") {
    return {
      kind: "failed",
      message: typeof data?.error === "string" && data.error ? data.error : "Channel verification failed.",
      reason: typeof data?.reason === "string" ? data.reason : undefined,
    };
  }
  if (status === "expired") return { kind: "expired" };
  if (status === "unauthorized") {
    return {
      kind: "unauthorized",
      message: typeof data?.error === "string" && data.error ? data.error : VERIFY_ERROR_COPY.unauthorized,
    };
  }
  return { kind: "error" };
}

/**
 * The user's Verify action: asks the backend to verify and (only if every check passes) connect the channel that
 * Telegram reported for the EXISTING request `ref`. Never throws. The body carries ONLY the public request ref —
 * the server resolves the user from the authenticated session and the channel from its own stored row. Safe to
 * repeat: the server claims the request atomically, so a double tap / refresh / second device cannot finalize
 * it twice or create a second request.
 */
export async function submitVerification(ref: number): Promise<VerifyOutcome> {
  try {
    const res = await fetch("/api/channels/connect-verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({ ref }),
    });
    const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    return interpretVerifyResponse(res, data);
  } catch {
    return { kind: "error" };
  }
}

/**
 * One read-only status lookup of the EXISTING request `ref`. Never throws. (GET, so repeating it — a retry, a double
 * tap — cannot create a second request or repeat a side effect.)
 */
export async function fetchVerifyOutcome(ref: number): Promise<VerifyOutcome> {
  try {
    const res = await fetch(`/api/channels/connect-status?ref=${encodeURIComponent(String(ref))}`, { cache: "no-store" });
    const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    return interpretVerifyResponse(res, data);
  } catch {
    return { kind: "error" };
  }
}

/** Human-readable reason shown when the outcome is anything other than "verified". */
export function verifyFailureMessage(outcome: Exclude<VerifyOutcome, { kind: "verified" }>): string {
  switch (outcome.kind) {
    case "verifying":
      return VERIFY_ERROR_COPY.verifying;
    case "awaiting_selection":
      return VERIFY_ERROR_COPY.awaiting_selection;
    case "channel_selected":
      return VERIFY_ERROR_COPY.channel_selected;
    case "failed":
      return outcome.message;
    case "expired":
      return VERIFY_ERROR_COPY.expired;
    case "unauthorized":
      return outcome.message;
    case "error":
      return VERIFY_ERROR_COPY.network;
  }
}
