import crypto from "crypto";
import type { TelegramInitDataUser } from "@/lib/auth";

/**
 * Temporary "creator setup" state.
 *
 * Why not a database row? The product requirement is to avoid creating any
 * persistent user record before a creator has connected (and we've verified)
 * their Telegram channel. Telegram identity verification alone does NOT
 * prove channel ownership, so we can't finalize an account right after
 * `initData` validation — but we also don't want to write throwaway "pending
 * user" rows for every visitor who opens the Mini App.
 *
 * Instead we mint a short-lived, HMAC-signed, opaque bearer token that
 * encodes the already-verified Telegram profile. It is handed back to the
 * browser as an HTTP-only cookie and never touches the database. When the
 * creator successfully verifies a channel, the channel endpoint decodes this
 * token, and only THEN creates the permanent `users` row (in the same
 * request that creates the channel + session).
 *
 * Trade-offs (documented for the security review):
 *  - Pro: zero database writes for visitors who never finish setup; nothing
 *    to clean up or garbage-collect.
 *  - Pro: tamper-proof (HMAC) and short-lived (20 minutes), so a leaked
 *    token has a small blast radius and cannot be replayed indefinitely.
 *  - Con: cannot be revoked server-side before it expires (there is no row
 *    to delete). Mitigated by the short TTL and by binding the cookie to
 *    HttpOnly/Secure/SameSite=Lax.
 *  - Con: if the signing secret leaks, an attacker could forge arbitrary
 *    Telegram profiles inside a setup token. This is why channel
 *    verification MUST independently check Telegram Bot API state (bot is
 *    an admin of that exact channel) before any account/channel row is
 *    created — the setup token alone is never treated as sufficient
 *    authorization for anything beyond "pre-fill this Telegram identity".
 */

export const SETUP_COOKIE_NAME = "onfile_setup";
const SETUP_TOKEN_TTL_SECONDS = 20 * 60; // 20 minutes

interface SetupPayload {
  tg: TelegramInitDataUser;
  iat: number;
  exp: number;
}

function getSigningSecret(): string {
  const secret = process.env.SETUP_TOKEN_SECRET || process.env.TELEGRAM_BOT_TOKEN;
  if (!secret) {
    throw new Error("missing_setup_secret");
  }
  return secret;
}

function sign(payload: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(payload).digest("base64url");
}

export function createSetupToken(tgUser: TelegramInitDataUser): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: SetupPayload = {
    tg: tgUser,
    iat: now,
    exp: now + SETUP_TOKEN_TTL_SECONDS,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const secret = getSigningSecret();
  const signature = sign(body, secret);
  return `${body}.${signature}`;
}

export type SetupTokenResult =
  | { ok: true; user: TelegramInitDataUser }
  | { ok: false; reason: "missing" | "malformed" | "invalid_signature" | "expired" | "server_misconfigured" };

export function verifySetupToken(token: string | undefined | null): SetupTokenResult {
  if (!token) return { ok: false, reason: "missing" };
  const parts = token.split(".");
  if (parts.length !== 2) return { ok: false, reason: "malformed" };
  const [body, signature] = parts;

  let secret: string;
  try {
    secret = getSigningSecret();
  } catch {
    return { ok: false, reason: "server_misconfigured" };
  }

  const expectedSignature = sign(body, secret);
  const sigBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expectedSignature);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return { ok: false, reason: "invalid_signature" };
  }

  let payload: SetupPayload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed" };
  }

  if (!payload || typeof payload.exp !== "number" || !payload.tg || typeof payload.tg.id !== "number") {
    return { ok: false, reason: "malformed" };
  }

  if (Math.floor(Date.now() / 1000) > payload.exp) {
    return { ok: false, reason: "expired" };
  }

  return { ok: true, user: payload.tg };
}

export function getSetupCookieOptions() {
  return {
    maxAge: SETUP_TOKEN_TTL_SECONDS,
    httpOnly: true as const,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/" as const,
  };
}
