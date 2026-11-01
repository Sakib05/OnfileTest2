/**
 * Validation for Telegram PRIVATE channel invite links, used by Manual
 * Connect (see src/components/setup/ManualConnectGuide.tsx and
 * src/components/setup/ChannelConnectScreen.tsx on the client, and
 * src/app/api/channels/connect-manual/route.ts on the server — the server
 * copy is authoritative; the client copy is only a fast UX gate).
 *
 * BUG FIX CONTEXT: the previous validator
 * (`looksLikeChannelLink`/`normalizeChannelIdentifier`) only accepted PUBLIC
 * channel forms (`@username`, `username`, `t.me/username`) and a raw numeric
 * chat id. Every *private* invite link — the only thing step 6 of the Manual
 * Connect guide actually asks the user to copy — has one of these shapes
 * instead, and was therefore always rejected:
 *   - https://t.me/+INVITE_HASH
 *   - http://t.me/+INVITE_HASH
 *   - t.me/+INVITE_HASH
 *   - https://t.me/joinchat/INVITE_HASH
 *   - t.me/joinchat/INVITE_HASH
 *
 * IMPORTANT: this module only checks that the pasted text is SYNTACTICALLY a
 * well-formed private invite link. It intentionally proves nothing about
 * which Telegram chat that link actually belongs to — the Telegram Bot API
 * has no method that resolves an arbitrary invite-link string to a chat, so
 * this can never be the security boundary (see src/lib/telegramBot.ts and
 * src/app/api/channels/connect-manual/route.ts for the actual verification,
 * which is based on a live `my_chat_member` bot-admin event, not this
 * format check).
 */

export type InviteLinkFailureReason =
  | "empty"
  | "invalid_url"
  | "public_channel_link"
  | "unsupported_telegram_link"
  | "malformed_invite_hash";

export interface NormalizedPrivateInviteLink {
  /** Canonical https://t.me/... form, safe to display back to the user. */
  normalizedUrl: string;
  kind: "plus" | "joinchat";
  hash: string;
}

export type InviteLinkValidationResult =
  | { ok: true; link: NormalizedPrivateInviteLink }
  | { ok: false; reason: InviteLinkFailureReason };

// Telegram invite hashes are base64url-ish (letters, digits, `-`, `_`).
// Real-world hashes are ~16-24 characters; a generous 8-64 range avoids
// false negatives across Telegram's own format changes while still
// rejecting obviously-truncated/garbage input.
const HASH_CHARSET_RE = /^[A-Za-z0-9_-]+$/;
const MIN_HASH_LEN = 8;
const MAX_HASH_LEN = 64;

// Public channel/username path: t.me/<username> (3-32 chars, letters,
// digits, underscore — Telegram's own username rules).
const PUBLIC_USERNAME_RE = /^[a-zA-Z][a-zA-Z0-9_]{2,31}$/;

function isValidHash(hash: string): boolean {
  return hash.length >= MIN_HASH_LEN && hash.length <= MAX_HASH_LEN && HASH_CHARSET_RE.test(hash);
}

/**
 * Validates and normalizes a creator-pasted Telegram link, accepting only
 * well-formed PRIVATE channel invite links and rejecting everything else
 * (public username links, unrelated/invalid URLs, empty input, malformed
 * invite hashes) — never misclassifying a private invite link as public or
 * vice versa.
 */
export function validatePrivateInviteLink(raw: string): InviteLinkValidationResult {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return { ok: false, reason: "empty" };

  // Strip whitespace that sometimes survives copy/paste from Telegram
  // clients (e.g. a trailing newline), and reasonable zero-width chars.
  const cleaned = trimmed.replace(/[\s\u200B-\u200D\uFEFF]+$/g, "").replace(/^[\s\u200B-\u200D\uFEFF]+/g, "");
  if (!cleaned) return { ok: false, reason: "empty" };

  // Normalize so a bare "t.me/..." (no scheme) parses the same as a full
  // URL — Telegram clients commonly display/copy links without a scheme.
  const candidate = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(cleaned) ? cleaned : `https://${cleaned}`;

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return { ok: false, reason: "invalid_url" };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, reason: "invalid_url" };
  }

  const host = url.hostname.toLowerCase();
  if (host !== "t.me" && host !== "telegram.me" && host !== "www.t.me") {
    return { ok: false, reason: "invalid_url" };
  }

  // Decode in case a `+` was percent-encoded (`%2B`) by whatever the user
  // copied from, then normalize away a trailing slash.
  let path: string;
  try {
    path = decodeURIComponent(url.pathname);
  } catch {
    return { ok: false, reason: "invalid_url" };
  }
  path = path.replace(/\/+$/, "");

  // Form: t.me/+HASH
  const plusMatch = path.match(/^\/\+([^/]+)$/);
  if (plusMatch) {
    const hash = plusMatch[1];
    if (!isValidHash(hash)) return { ok: false, reason: "malformed_invite_hash" };
    return { ok: true, link: { normalizedUrl: `https://t.me/+${hash}`, kind: "plus", hash } };
  }

  // Form: t.me/joinchat/HASH (legacy private invite link format — still
  // issued/accepted by Telegram today).
  const joinChatMatch = path.match(/^\/joinchat\/([^/]+)$/i);
  if (joinChatMatch) {
    const hash = joinChatMatch[1];
    if (!isValidHash(hash)) return { ok: false, reason: "malformed_invite_hash" };
    return { ok: true, link: { normalizedUrl: `https://t.me/joinchat/${hash}`, kind: "joinchat", hash } };
  }

  // Form: t.me/<username> — a PUBLIC channel/bot/user link. Must be
  // rejected explicitly (never silently treated as a private link) per
  // Onfile's private-channels-only requirement.
  const usernamePath = path.replace(/^\//, "");
  if (PUBLIC_USERNAME_RE.test(usernamePath)) {
    return { ok: false, reason: "public_channel_link" };
  }

  // Any other t.me path (e.g. /addstickers/..., /share/..., a malformed
  // "+": with invalid characters caught above, or just garbage).
  return { ok: false, reason: "unsupported_telegram_link" };
}

export const INVITE_LINK_FAILURE_MESSAGES: Record<InviteLinkFailureReason, string> = {
  empty: "Paste your channel's private invite link to continue.",
  invalid_url:
    "That doesn't look like a Telegram link. Paste the private invite link exactly as copied from your channel (e.g. https://t.me/+AbCdEfGhIjKlMnOp).",
  public_channel_link:
    "That's a public channel link (t.me/username). Onfile only supports private channels — open your channel, go to Invite Links, and copy the private invite link instead.",
  unsupported_telegram_link:
    "That Telegram link isn't a channel invite link. Paste your private channel's invite link instead (e.g. https://t.me/+AbCdEfGhIjKlMnOp).",
  malformed_invite_hash:
    "That invite link looks incomplete. Please copy the full private invite link again from your channel and paste it here.",
};
