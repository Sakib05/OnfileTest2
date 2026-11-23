import type { User } from "@/db/schema";
import { buildThumbnailUrl } from "@/lib/thumbnails/config";
import { sanitizeAvatarUrl } from "@/lib/avatar";
import { resolveIdentity } from "./identity";

const urlFor = (key: string) => buildThumbnailUrl(key);

/**
 * The authenticated user's OWN profile, as returned by /api/user/me. Derived strictly from the server-side
 * session row — `telegramId` is the real `users.telegram_id` (never `users.id`, never client-supplied).
 *
 * Fields:
 *   firstName / avatarUrl   — what Telegram last told us (kept for backwards compatibility)
 *   displayNameCustom       — the user's custom name (null when unset)
 *   displayName             — EFFECTIVE name: custom → Telegram first name (null if neither)
 *   customAvatarUrl         — URL of the custom picture (null when none) — wins over `avatarUrl`
 */
export function serializeSessionUser(
  user: User,
  extra: { isAdmin?: boolean } = {}
) {
  const identity = resolveIdentity(
    {
      firstName: user.firstName,
      displayNameCustom: user.displayNameCustom,
      username: user.username,
      avatarUrl: user.avatarUrl,
      profileImageKey: user.profileImageKey,
    },
    urlFor
  );
  return {
    id: user.id,
    telegramId: user.telegramId ?? undefined,
    username: user.username ?? undefined,
    firstName: user.firstName ?? undefined,
    lastName: user.lastName ?? undefined,
    avatarUrl: user.avatarUrl ?? undefined,
    displayNameCustom: user.displayNameCustom ?? undefined,
    displayName: identity.displayName ?? undefined,
    customAvatarUrl: identity.customAvatarUrl ?? undefined,
    balance: user.balance ?? "0",
    pendingBalance: user.pendingBalance ?? "0",
    referralEarnings: user.referralEarnings ?? "0",
    totalDownloads: user.totalDownloads ?? 0,
    totalEarnings: user.totalEarnings ?? "0",
    referralCode: user.referralCode ?? undefined,
    darkMode: user.darkMode ?? false,
    language: user.language ?? "en",
    ...(extra.isAdmin !== undefined ? { isAdmin: extra.isAdmin } : {}),
  };
}

/** Columns needed to build a public creator payload (select exactly these — nothing private). */
export interface PublicCreatorRow {
  firstName: string | null;
  displayNameCustom: string | null;
  username: string | null;
  avatarUrl: string | null;
  profileImageKey: string | null;
}

export interface PublicCreator {
  /** EFFECTIVE display name (custom → Telegram first name). */
  firstName: string | null;
  username: string | null;
  /** Telegram photo (sanitised). */
  avatarUrl: string | null;
  /** Custom picture; takes priority over `avatarUrl` in <TelegramAvatar/>. */
  customAvatarUrl: string | null;
}

/** Public creator info for shared links / playlists. Never exposes ids, balances or the Telegram id. */
export function toPublicCreator(row: PublicCreatorRow): PublicCreator {
  const identity = resolveIdentity(row, urlFor);
  return {
    firstName: identity.displayName,
    username: row.username ?? null,
    avatarUrl: sanitizeAvatarUrl(row.avatarUrl),
    customAvatarUrl: identity.customAvatarUrl,
  };
}
