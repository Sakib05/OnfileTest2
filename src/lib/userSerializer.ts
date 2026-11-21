import type { User } from "@/db/schema";
import { isAdminUser } from "@/lib/adminAuth";
import { resolveAvatarUrl } from "@/lib/profileImage";

/**
 * The ONE place the authenticated creator's own profile is shaped for the client (used by GET and PATCH
 * /api/user/me). `avatarUrl` is the picture to display: the creator's uploaded picture if they set one, otherwise the
 * existing default (Telegram photo / initial-letter fallback). Never includes the session token, hashes or other
 * users' data.
 */
export function serializeUser(user: User, opts: { includeAdmin?: boolean } = {}) {
  return {
    id: user.id,
    telegramId: user.telegramId ?? undefined,
    username: user.username ?? undefined,
    firstName: user.firstName ?? undefined,
    lastName: user.lastName ?? undefined,
    avatarUrl: resolveAvatarUrl(user) ?? undefined,
    hasCustomAvatar: !!user.profileImageKey,
    balance: user.balance ?? "0",
    pendingBalance: user.pendingBalance ?? "0",
    referralEarnings: user.referralEarnings ?? "0",
    totalDownloads: user.totalDownloads ?? 0,
    totalEarnings: user.totalEarnings ?? "0",
    referralCode: user.referralCode ?? undefined,
    darkMode: user.darkMode ?? false,
    language: user.language ?? "en",
    createdAt: user.createdAt ? user.createdAt.toISOString() : undefined,
    ...(opts.includeAdmin ? { isAdmin: isAdminUser(user) } : {}),
  };
}
