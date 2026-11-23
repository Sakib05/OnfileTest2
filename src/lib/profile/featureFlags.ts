/**
 * Profile feature flags.
 *
 * CUSTOM_PROFILE_PICTURE_ENABLED — TEMPORARILY `false`.
 *
 * The custom profile picture feature (upload + crop + remove) was switched off because it was unreliable. While
 * `false`:
 *   • Edit Profile only offers Display name + (read-only) Username — see `components/profile/EditProfile.tsx`.
 *   • <TelegramAvatar/> ignores any custom picture URL (priority: Telegram photo → initials).
 *   • `/api/user/me` and the public creator payloads never expose a custom picture URL and never read
 *     `users.profile_image_key` (see `src/db/userColumns.ts`).
 *   • `POST` / `DELETE /api/user/avatar` answer 403 `profile_picture_disabled` before touching anything.
 *
 * Everything else (cropper, upload service, image pipeline, DB columns, migrations) is kept intact so the feature
 * can be restored. See docs/PROFILE_PICTURE_TEMPORARILY_DISABLED.md for the exact restore steps.
 *
 * This is a plain constant (not an env var) on purpose: it is shared by server and client code and must not depend
 * on production environment configuration.
 */
export const CUSTOM_PROFILE_PICTURE_ENABLED: boolean = false;
