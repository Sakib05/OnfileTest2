/**
 * Client helpers for the Telegram bot's "Verify" button.
 *
 * The button opens the Mini App at `/?connect=<public request ref>`. The Mini App then asks the backend
 * (GET /api/channels/connect-status?ref=) about THAT EXISTING request. The call is read-only: it never creates a
 * pending channel request, and the server only answers "verified" after re-checking that the request belongs to the
 * authenticated Telegram user and that the connected channel exists, is verified, and is owned by the same account.
 *
 * Nothing in the URL (or in this module) is trusted: a channel id / title is never read from the client.
 */

export interface VerifiedChannelSummary {
  id: number;
  channelName: string | null;
  channelUsername: string | null;
}

export type VerifyOutcome =
  | { kind: "verified"; channel: VerifiedChannelSummary }
  /** The webhook has claimed the selection and is verifying with Telegram right now — worth polling briefly. */
  | { kind: "verifying" }
  /** The user tapped Verify before choosing a channel in the bot chat. */
  | { kind: "awaiting_selection" }
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
  if (status === "pending") return data?.stage === "verifying" ? { kind: "verifying" } : { kind: "awaiting_selection" };
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
 * One read-only status lookup of the EXISTING request `ref`. Never throws. (GET, so repeating it — a retry, a double
 * tap, a webhook redelivery elsewhere — cannot create a second request or repeat a side effect.)
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
