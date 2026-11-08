/**
 * Parsing for links that point at a single Telegram channel POST (message),
 * as pasted by a creator in the Publish flow.
 *
 * This module is PURE (no network, no DB) and only answers "what does this
 * link syntactically claim to point at?". It intentionally proves nothing:
 *   - it does not prove the channel exists,
 *   - it does not prove the message exists,
 *   - it does not prove the channel belongs to anyone.
 * Ownership is decided server-side by src/lib/channelPostVerification.ts,
 * which compares the parsed CHANNEL IDENTITY against the creator's connected
 * channel row. The channel identity and the message id are kept strictly
 * separate in the result.
 *
 * Supported shapes:
 *   Private channel   https://t.me/c/1234567890/125
 *                     https://t.me/c/1234567890/12/125   (comment/thread form)
 *   Public channel    https://t.me/username/125
 *                     https://t.me/s/username/125        (web preview form)
 *   Deep links        tg://privatepost?channel=1234567890&post=125
 *                     tg://resolve?domain=username&post=125
 * Hosts: t.me, www.t.me, telegram.me, telegram.dog. Scheme optional. Query
 * strings (?single, ?comment=, ?thread=) and #fragments are ignored.
 */

export type PostLinkFailureReason =
  | "empty"
  | "too_long"
  | "invalid_url"
  | "not_telegram_link"
  | "invite_link"
  | "channel_link_without_post"
  | "unsupported_link"
  | "invalid_message_id";

export interface ParsedPrivatePostLink {
  kind: "private";
  /** Channel id exactly as it appears in the link (no -100 prefix). */
  internalChannelId: string;
  /** Bot-API style chat id: "-100" + internalChannelId. */
  telegramChatId: string;
  messageId: number;
  /** Canonical, normalized link (safe to store and display). */
  canonicalLink: string;
}

export interface ParsedPublicPostLink {
  kind: "public";
  /** Lower-cased username, no "@". */
  username: string;
  messageId: number;
  canonicalLink: string;
}

export type ParsedPostLink = ParsedPrivatePostLink | ParsedPublicPostLink;

export type PostLinkParseResult =
  | { ok: true; link: ParsedPostLink }
  | { ok: false; reason: PostLinkFailureReason };

export const POST_LINK_FAILURE_MESSAGES: Record<PostLinkFailureReason, string> = {
  empty: "Paste a link to a post from your Telegram channel.",
  too_long: "That link is too long to be a Telegram post link.",
  invalid_url: "That doesn't look like a valid link. Copy the post link from Telegram and paste it again.",
  not_telegram_link: "That isn't a Telegram link. Use a link that starts with https://t.me/.",
  invite_link:
    "That's a channel invite link, not a post link. Open a post in your channel, tap “Copy Link”, and paste that instead.",
  channel_link_without_post:
    "That link points to a channel, not to a specific post. Open a post in your channel and copy its link.",
  unsupported_link: "That Telegram link format isn't supported. Use a post link like https://t.me/c/1234567890/125.",
  invalid_message_id: "The post number in that link isn't valid. Copy the link of the post again from Telegram.",
};

const MAX_LINK_LENGTH = 512;
const TELEGRAM_HOSTS = new Set(["t.me", "www.t.me", "telegram.me", "www.telegram.me", "telegram.dog"]);
const INTERNAL_CHANNEL_ID_RE = /^[1-9][0-9]{4,12}$/;
const MESSAGE_ID_RE = /^[1-9][0-9]{0,9}$/;
const MAX_MESSAGE_ID = 2_147_483_647;
const USERNAME_RE = /^[a-zA-Z][a-zA-Z0-9_]{2,31}$/;
// First path segments that are Telegram features, never channel usernames.
const RESERVED_FIRST_SEGMENTS = new Set([
  "joinchat",
  "addstickers",
  "addemoji",
  "addtheme",
  "addlist",
  "share",
  "proxy",
  "socks",
  "login",
  "setlanguage",
  "boost",
  "invoice",
  "giftcode",
  "bg",
  "confirmphone",
  "contact",
  "iv",
  "nft",
  "stickers",
  "web",
]);

function parseMessageId(raw: string | null | undefined): number | null {
  if (!raw || !MESSAGE_ID_RE.test(raw)) return null;
  const n = Number(raw);
  return n >= 1 && n <= MAX_MESSAGE_ID ? n : null;
}

function privateResult(internalChannelId: string, messageId: number): ParsedPrivatePostLink {
  return {
    kind: "private",
    internalChannelId,
    telegramChatId: `-100${internalChannelId}`,
    messageId,
    canonicalLink: `https://t.me/c/${internalChannelId}/${messageId}`,
  };
}

function publicResult(username: string, messageId: number): ParsedPublicPostLink {
  const lower = username.toLowerCase();
  return { kind: "public", username: lower, messageId, canonicalLink: `https://t.me/${lower}/${messageId}` };
}

function parseTgDeepLink(url: URL): PostLinkParseResult {
  const action = url.hostname.toLowerCase();
  const q = url.searchParams;
  if (action === "privatepost") {
    const channel = q.get("channel");
    if (!channel || !INTERNAL_CHANNEL_ID_RE.test(channel)) return { ok: false, reason: "unsupported_link" };
    const post = q.get("post");
    if (!post) return { ok: false, reason: "channel_link_without_post" };
    const messageId = parseMessageId(post);
    if (messageId === null) return { ok: false, reason: "invalid_message_id" };
    return { ok: true, link: privateResult(channel, messageId) };
  }
  if (action === "resolve") {
    const domain = q.get("domain");
    if (!domain || !USERNAME_RE.test(domain) || RESERVED_FIRST_SEGMENTS.has(domain.toLowerCase())) {
      return { ok: false, reason: "unsupported_link" };
    }
    const post = q.get("post");
    if (!post) return { ok: false, reason: "channel_link_without_post" };
    const messageId = parseMessageId(post);
    if (messageId === null) return { ok: false, reason: "invalid_message_id" };
    return { ok: true, link: publicResult(domain, messageId) };
  }
  return { ok: false, reason: "unsupported_link" };
}

export function parseTelegramPostLink(raw: unknown): PostLinkParseResult {
  if (typeof raw !== "string") return { ok: false, reason: "empty" };
  const cleaned = raw.replace(/[\u200B-\u200D\uFEFF]/g, "").trim();
  if (!cleaned) return { ok: false, reason: "empty" };
  if (cleaned.length > MAX_LINK_LENGTH) return { ok: false, reason: "too_long" };
  if (/\s/.test(cleaned)) return { ok: false, reason: "invalid_url" };

  if (/^tg:\/\//i.test(cleaned)) {
    let tg: URL;
    try {
      tg = new URL(cleaned);
    } catch {
      return { ok: false, reason: "invalid_url" };
    }
    return parseTgDeepLink(tg);
  }

  const candidate = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(cleaned) ? cleaned : `https://${cleaned}`;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return { ok: false, reason: "invalid_url" };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return { ok: false, reason: "invalid_url" };
  if (!TELEGRAM_HOSTS.has(url.hostname.toLowerCase())) return { ok: false, reason: "not_telegram_link" };
  if (url.username || url.password) return { ok: false, reason: "invalid_url" };

  let path: string;
  try {
    path = decodeURIComponent(url.pathname);
  } catch {
    return { ok: false, reason: "invalid_url" };
  }
  const segments = path.split("/").filter(Boolean);
  if (segments.length === 0) return { ok: false, reason: "unsupported_link" };

  const first = segments[0];

  // Private invite links: /+HASH and /joinchat/HASH
  if (first.startsWith("+") || first.toLowerCase() === "joinchat") {
    return { ok: false, reason: "invite_link" };
  }

  // Private channel post: /c/<id>/<msg> or /c/<id>/<thread>/<msg>
  if (first === "c") {
    const id = segments[1];
    if (!id || !INTERNAL_CHANNEL_ID_RE.test(id)) return { ok: false, reason: "unsupported_link" };
    if (segments.length === 2) return { ok: false, reason: "channel_link_without_post" };
    if (segments.length > 4) return { ok: false, reason: "unsupported_link" };
    // For the thread form the LAST segment is the message id.
    const messageId = parseMessageId(segments[segments.length - 1]);
    if (messageId === null) return { ok: false, reason: "invalid_message_id" };
    if (segments.length === 4 && parseMessageId(segments[2]) === null) return { ok: false, reason: "invalid_message_id" };
    return { ok: true, link: privateResult(id, messageId) };
  }

  // Public channel web-preview form: /s/<username>/<msg>
  const publicSegments = first.toLowerCase() === "s" ? segments.slice(1) : segments;
  const username = publicSegments[0];
  if (!username || RESERVED_FIRST_SEGMENTS.has(username.toLowerCase()) || !USERNAME_RE.test(username)) {
    return { ok: false, reason: "unsupported_link" };
  }
  if (publicSegments.length === 1) return { ok: false, reason: "channel_link_without_post" };
  if (publicSegments.length > 3) return { ok: false, reason: "unsupported_link" };
  const messageId = parseMessageId(publicSegments[publicSegments.length - 1]);
  if (messageId === null) return { ok: false, reason: "invalid_message_id" };
  if (publicSegments.length === 3 && parseMessageId(publicSegments[1]) === null) {
    return { ok: false, reason: "invalid_message_id" };
  }
  return { ok: true, link: publicResult(username, messageId) };
}

/**
 * Canonical identity of the POST a link points at (channel + message), used
 * for duplicate detection. Private posts are keyed by chat id; public posts by
 * lower-cased username.
 */
export function postIdentityKey(link: ParsedPostLink): string {
  return link.kind === "private"
    ? `c:${link.internalChannelId}:${link.messageId}`
    : `u:${link.username}:${link.messageId}`;
}

/** Normalizes a stored Telegram channel id ("-1001234567890" / "1234567890") to its internal id. */
export function toInternalChannelId(stored: string | null | undefined): string | null {
  if (!stored) return null;
  const trimmed = stored.trim();
  const m = trimmed.match(/^-100([1-9][0-9]{4,12})$/) ?? trimmed.match(/^([1-9][0-9]{4,12})$/);
  return m ? m[1] : null;
}
