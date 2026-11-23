import crypto from "crypto";
import type { SlotKey } from "./constants";

/**
 * Serve tokens: when /api/ads/serve shows an ad it signs {campaign, slot, expiry}. /api/ads/event only accepts an
 * impression/click that carries a valid token, so a client can't invent events for campaigns it was never served,
 * can't retarget them to another slot, and can't replay an old token forever. Tokens carry no user data.
 */
export const SERVE_TOKEN_TTL_MS = 30 * 60 * 1000;

function secret(): string {
  const explicit = process.env.AD_TOKEN_SECRET || process.env.SETUP_TOKEN_SECRET || process.env.TELEGRAM_BOT_TOKEN;
  if (explicit) return explicit;
  // Last resort: derived from another server-side secret (never sent to the client).
  return crypto.createHash("sha256").update(`onfile-ads:${process.env.DATABASE_URL ?? "dev"}`).digest("hex");
}

export interface ServePayload {
  c: string; // campaign public id
  s: SlotKey;
  e: number; // expiry (ms epoch)
}

function mac(body: string, key: string): string {
  return crypto.createHmac("sha256", key).update(body).digest("base64url");
}

export function signServeToken(campaignRef: string, slot: SlotKey, now = Date.now(), key = secret()): string {
  const payload: ServePayload = { c: campaignRef, s: slot, e: now + SERVE_TOKEN_TTL_MS };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${mac(body, key)}`;
}

export function verifyServeToken(token: unknown, now = Date.now(), key = secret()): ServePayload | null {
  if (typeof token !== "string" || token.length > 400) return null;
  const [body, sig, extra] = token.split(".");
  if (!body || !sig || extra !== undefined) return null;
  const expected = mac(body, key);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as ServePayload;
    if (typeof p.c !== "string" || typeof p.e !== "number" || p.e < now) return null;
    if (p.s !== "library" && p.s !== "file_access" && p.s !== "playlist_between") return null;
    return p;
  } catch {
    return null;
  }
}

/** Opaque, non-reversible viewer key for de-duplication: signed-in users by id, anonymous visitors by hashed IP + UA. */
export function viewerKeyFor(userId: number | null | undefined, ip: string, userAgent: string | null): string {
  if (userId) return `u${userId}`;
  return `a${crypto.createHash("sha256").update(`${secret()}|${ip}|${userAgent ?? ""}`).digest("hex").slice(0, 24)}`;
}

/** Public campaign reference, e.g. "AD-7K3M9QXA". Unambiguous alphabet (no 0/O/1/I). */
export function generatePublicId(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.randomBytes(8);
  let out = "";
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return `AD-${out}`;
}

export function isValidPublicId(v: unknown): v is string {
  return typeof v === "string" && /^AD-[A-Z2-9]{8}$/.test(v);
}
