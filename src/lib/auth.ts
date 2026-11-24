import crypto from "crypto";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { sessions, users, type User } from "@/db/schema";
import { and, eq, gt } from "drizzle-orm";

export const SESSION_COOKIE_NAME = "onfile_session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

// How long a Telegram Mini App `initData` payload is accepted as "fresh".
// Telegram re-signs initData every time the Mini App is (re)launched, so a
// short window is enough while still tolerating clock drift / slow devices.
const INIT_DATA_MAX_AGE_SECONDS = 24 * 60 * 60; // 24 hours

export interface TelegramInitDataUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  language_code?: string;
  is_premium?: boolean;
}

export interface ValidatedInitData {
  user: TelegramInitDataUser;
  authDate: number;
}

export type InitDataValidationResult =
  | { ok: true; data: ValidatedInitData }
  | { ok: false; reason: string };

/**
 * Validates Telegram Mini App `initData` using Telegram's official
 * algorithm (https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app):
 *
 *   data_check_string = all fields except `hash`, sorted alphabetically by
 *                        key, joined as "key=value" with "\n"
 *   secret_key = HMAC_SHA256(key = "WebAppData", data = <bot_token>)
 *   expected_hash = HEX(HMAC_SHA256(key = secret_key, data = data_check_string))
 *
 * The request is rejected if the hash does not match, required fields are
 * missing, the payload cannot be parsed, or `auth_date` is too old/too far
 * in the future. This is the ONLY place a Telegram identity should ever be
 * derived from client-supplied data.
 */
export function validateTelegramInitData(
  initData: string,
  botToken: string
): InitDataValidationResult {
  if (!initData || typeof initData !== "string") {
    return { ok: false, reason: "missing_init_data" };
  }
  if (initData.length > 8192) {
    return { ok: false, reason: "malformed_init_data" };
  }

  let params: URLSearchParams;
  try {
    params = new URLSearchParams(initData);
  } catch {
    return { ok: false, reason: "malformed_init_data" };
  }

  const hash = params.get("hash");
  if (!hash) {
    return { ok: false, reason: "missing_hash" };
  }
  // Telegram's hash is always a 64-char lowercase hex SHA-256 digest.
  if (!/^[a-f0-9]{64}$/i.test(hash)) {
    return { ok: false, reason: "malformed_hash" };
  }

  const pairs: string[] = [];
  params.forEach((value, key) => {
    if (key === "hash") return;
    pairs.push(`${key}=${value}`);
  });
  pairs.sort();
  const dataCheckString = pairs.join("\n");

  const secretKey = crypto.createHmac("sha256", "WebAppData").update(botToken).digest();
  const computedHash = crypto.createHmac("sha256", secretKey).update(dataCheckString).digest("hex");

  const providedHashBuf = Buffer.from(hash.toLowerCase(), "hex");
  const computedHashBuf = Buffer.from(computedHash, "hex");
  if (
    providedHashBuf.length !== computedHashBuf.length ||
    !crypto.timingSafeEqual(providedHashBuf, computedHashBuf)
  ) {
    return { ok: false, reason: "invalid_signature" };
  }

  const authDateRaw = params.get("auth_date");
  const authDate = authDateRaw ? parseInt(authDateRaw, 10) : NaN;
  if (!authDateRaw || Number.isNaN(authDate)) {
    return { ok: false, reason: "missing_auth_date" };
  }
  const ageSeconds = Math.floor(Date.now() / 1000) - authDate;
  if (ageSeconds > INIT_DATA_MAX_AGE_SECONDS || ageSeconds < -300) {
    return { ok: false, reason: "expired" };
  }

  const userRaw = params.get("user");
  if (!userRaw) {
    return { ok: false, reason: "missing_user" };
  }

  let user: TelegramInitDataUser;
  try {
    const parsed = JSON.parse(userRaw);
    if (!parsed || typeof parsed.id !== "number" || !Number.isFinite(parsed.id)) {
      return { ok: false, reason: "malformed_user" };
    }
    user = parsed;
  } catch {
    return { ok: false, reason: "malformed_user" };
  }

  return { ok: true, data: { user, authDate } };
}

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function generateSessionToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export function getSessionCookieOptions() {
  return {
    maxAge: SESSION_MAX_AGE_SECONDS,
    httpOnly: true as const,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/" as const,
  };
}

/** Creates a new opaque session for a user. Only the SHA-256 hash is stored. */
export async function createSession(userId: number, userAgent?: string | null) {
  const token = generateSessionToken();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000);

  await db.insert(sessions).values({
    userId,
    tokenHash,
    expiresAt,
    userAgent: userAgent?.slice(0, 500) ?? null,
  });

  return { token, expiresAt };
}

/** Looks up the authenticated user for a request's session cookie, if valid. */
export async function getSessionUser(req: NextRequest): Promise<User | null> {
  const token = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;
  // Opaque tokens are base64url; reject obviously malformed cookies early.
  if (token.length < 20 || token.length > 512) return null;

  const tokenHash = hashToken(token);
  const [row] = await db
    .select({ user: users, sessionId: sessions.id })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(and(eq(sessions.tokenHash, tokenHash), gt(sessions.expiresAt, new Date())))
    .limit(1);

  if (!row) return null;

  // Best-effort last-used bump; failures here must never block the request.
  db.update(sessions)
    .set({ lastUsedAt: new Date() })
    .where(eq(sessions.id, row.sessionId))
    .catch(() => {});

  return row.user;
}

/** Convenience helper mirroring the previous `userId` cookie contract. */
export async function getSessionUserId(req: NextRequest): Promise<number | null> {
  const user = await getSessionUser(req);
  return user ? user.id : null;
}

/**
 * Enforces that a request carries a valid session. Returns the authenticated
 * user, or a ready-to-return 401 NextResponse when there isn't one. Never
 * trusts any client-supplied user id — the identity always comes from the
 * server-side session lookup above.
 */
export async function requireSessionUser(
  req: NextRequest
): Promise<{ user: User } | { response: NextResponse }> {
  const user = await getSessionUser(req);
  if (!user) {
    return { response: unauthorized() };
  }
  return { user };
}

export function unauthorized(message = "Unauthorized") {
  return NextResponse.json({ error: message }, { status: 401 });
}

export async function destroySessionByToken(token: string) {
  const tokenHash = hashToken(token);
  await db.delete(sessions).where(eq(sessions.tokenHash, tokenHash));
}

/** Revokes every session belonging to a user (e.g. "log out everywhere"). */
export async function destroyAllSessionsForUser(userId: number) {
  await db.delete(sessions).where(eq(sessions.userId, userId));
}

/**
 * Minimal same-origin check for cookie-authenticated, state-changing
 * requests. Browsers always send `Origin` on cross-site fetch/XHR, so this
 * blocks classic CSRF from a foreign web page. It intentionally allows
 * requests with no Origin/Referer at all (some Telegram WebView contexts
 * omit them) — this is a defense-in-depth layer on top of the `SameSite=Lax`
 * cookie, not the only protection.
 */
export function isSameOriginRequest(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  try {
    const originUrl = new URL(origin);
    const hostHeader = req.headers.get("host");
    return !!hostHeader && originUrl.host === hostHeader;
  } catch {
    return false;
  }
}
