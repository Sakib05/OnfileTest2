import { getTableColumns } from "drizzle-orm";
import { users, type User } from "./schema";
import { CUSTOM_PROFILE_PICTURE_ENABLED } from "@/lib/profile/featureFlags";

/**
 * Column sets for reading `users` WITHOUT depending on `users.profile_image_key`.
 *
 * Why: the custom profile picture feature is temporarily disabled (see src/lib/profile/featureFlags.ts), so the
 * application must keep loading profiles / sessions even if that column is later dropped from the database.
 * `db.select().from(users)` would implicitly list EVERY column of the Drizzle table, including `profile_image_key`,
 * so the active read paths use these explicit column sets instead.
 *
 * IMPORTANT: `src/db/schema.ts` is intentionally NOT changed (the column is still declared there), so
 * `drizzle-kit push` / the SQL files in /migrations stay consistent with the current production database.
 * When CUSTOM_PROFILE_PICTURE_ENABLED is switched back on, the column is included again automatically.
 */

const all = getTableColumns(users);

type UserColumnsWithoutImageKey = Omit<typeof all, "profileImageKey">;

function withoutImageKey(): UserColumnsWithoutImageKey {
  return Object.fromEntries(
    Object.entries(all).filter(([name]) => name !== "profileImageKey")
  ) as UserColumnsWithoutImageKey;
}

/** All `users` columns the app needs for sessions / profile (profile_image_key only when the feature is on). */
export const userColumns: UserColumnsWithoutImageKey = CUSTOM_PROFILE_PICTURE_ENABLED
  ? (all as unknown as UserColumnsWithoutImageKey)
  : withoutImageKey();

/** A `users` row as loaded by `userColumns`. `profileImageKey` is present only while the feature is enabled. */
export type SessionUser = Omit<User, "profileImageKey"> & { profileImageKey?: string | null };

const publicBase = {
  firstName: users.firstName,
  displayNameCustom: users.displayNameCustom,
  username: users.username,
  avatarUrl: users.avatarUrl,
};

/** Columns for the PUBLIC creator payload (shared file / playlist pages). Nothing private. */
export const publicCreatorColumns: typeof publicBase = CUSTOM_PROFILE_PICTURE_ENABLED
  ? ({ ...publicBase, profileImageKey: users.profileImageKey } as unknown as typeof publicBase)
  : publicBase;
