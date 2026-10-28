import crypto from "crypto";

/**
 * File/playlist access passwords were previously stored and compared in
 * plaintext. This hashes them with a per-record random salt (scrypt), so a
 * database leak does not directly expose every creator's access passwords.
 * The stored format is `scrypt:<saltHex>:<hashHex>` so existing plaintext
 * values (if any exist in a pre-existing dev database) are safely detected
 * and treated as "no match" rather than crashing.
 */

const SCRYPT_KEYLEN = 64;

export function hashAccessPassword(plain: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(plain, salt, SCRYPT_KEYLEN).toString("hex");
  return `scrypt:${salt}:${hash}`;
}

export function verifyAccessPassword(plain: string, stored: string | null | undefined): boolean {
  if (!stored) return false;
  const parts = stored.split(":");
  if (parts.length !== 3 || parts[0] !== "scrypt") {
    // Not a hash we generated (e.g. legacy plaintext) — never match it.
    return false;
  }
  const [, salt, hashHex] = parts;
  try {
    const expected = Buffer.from(hashHex, "hex");
    const actual = crypto.scryptSync(plain, salt, SCRYPT_KEYLEN);
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}
