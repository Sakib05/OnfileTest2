# Custom profile picture — TEMPORARILY DISABLED

The custom profile picture feature (upload → crop → remove) was switched off because it was unreliable. It is **disabled,
not removed**: all code, services, migrations and docs are kept so it can be restored. **No database change was made.**

## What users get now

| Area | Behaviour |
| --- | --- |
| Edit Profile | **Display name** (editable, max 64, empty → Telegram name) and **Username** (`@name`, read-only, **lock icon only**). A display-only avatar sits on top. No upload / change / remove button, no file picker, no cropper, no progress or upload errors. |
| Profile Card | Unchanged redesign: avatar, display name, Creator badge, `ID: <telegram id>` + copy, pencil → Edit Profile. No gear, no Files/Downloads/Earned. |
| Avatar everywhere | **Telegram photo → initials.** Missing or failing Telegram photo → the existing initials circle (never a broken image). Applies to the Profile Card, Edit Profile, shared-file creator row and shared-playlist creator row (all via `TelegramAvatar`). |
| Display name sync | Unchanged: `PATCH /api/user/me { displayName }` writes `users.display_name_custom`; Telegram login only syncs `first_name`/`username`/`avatar_url`. |
| Username | Unchanged: `PATCH /api/user/me { username }` is rejected with 400. |

## How it was disabled (single switch + inactive code)

`src/lib/profile/featureFlags.ts` → `CUSTOM_PROFILE_PICTURE_ENABLED = false` (plain constant, no env var, so no production
configuration changes are involved).

| File | Effect while the flag is `false` |
| --- | --- |
| `src/components/profile/EditProfile.tsx` | **Rewritten**: Display name + Username only. Imports no cropper / upload code. |
| `src/components/profile/EditProfileWithPicture.tsx` | **The previous Edit Profile (with picture/cropper), moved here, unchanged in behaviour. Not rendered anywhere.** |
| `src/components/profile/AvatarCropper.tsx`, `src/lib/profile/avatar{Client,Image,Errors,Service}.ts`, `cropMath.ts`, `imageFormat.ts` | Kept as-is; no longer reachable from the UI. |
| `src/lib/profile/displayNameClient.ts` | **New.** `saveDisplayName` moved out of `avatarClient.ts` (which re-exports it) so the active screen never loads upload code. |
| `src/app/api/user/avatar/route.ts` | `POST` and `DELETE` return **403 `profile_picture_disabled`** before reading the body, the session or the DB (nothing is stored, nothing deleted). Original handlers remain below the guard. |
| `src/components/ui/TelegramAvatar.tsx` + `avatarCandidates()` in `src/lib/avatar.ts` | `customUrl` is ignored; candidates = Telegram photo only; initials underneath. |
| `src/lib/profile/identity.ts` | `resolveIdentity` returns `customAvatarUrl: null`; `profileImageKey` is optional. |
| `src/db/userColumns.ts` (**new**) | Explicit column sets that **omit `profile_image_key`** (see "Database safety"). |
| `src/lib/auth.ts`, `api/auth/telegram`, `api/user/me`, `api/link/[slug]`, `lib/publicPlaylist.ts`, `lib/channelConnection.ts`, `lib/profile/serialize.ts` | Read/return rows via those column sets, so profile loading / login / account creation never touch `profile_image_key`. |

## Database safety

* **`src/db/schema.ts` is unchanged.** Both columns are still declared: `display_name_custom` (**still required** — it
  powers display-name customisation) and `profile_image_key`. `drizzle-kit push`, `/migrations/profile_customization` and
  DBByte configuration are untouched. No SQL was run against any production database; no data or stored image was deleted.
* The app **no longer requires `profile_image_key`**: no active query selects, returns or writes it (the implicit
  `SELECT *`-style reads were replaced by `userColumns` / `publicCreatorColumns`). So if you later drop that column in the
  database, profile loading, login, Display Name updates and account creation keep working.
* **If you decide to drop `profile_image_key` permanently**, do it in this order (none of it was done here):
  1. Remove `profileImageKey` from `src/db/schema.ts` (otherwise `drizzle-kit push` will try to re-add it / tests insert it).
  2. Delete the picture feature code that references `users.profileImageKey`: `src/lib/profile/avatarService.ts`
     (+ its tests), the `profileImageKey` branches in `src/db/userColumns.ts`, and the avatar route/tests.
  3. Then run your SQL migration (`ALTER TABLE users DROP COLUMN profile_image_key`). Do **not** drop `display_name_custom`.
* Findings reported rather than changed: (a) the repository contains no `package-lock.json` — one was generated for this
  delivery; (b) the avatar test fixtures (`src/test/fixtures/avatar/*`) were missing from the repository, so tests that
  need them failed at baseline — they were regenerated with the repo's own `scripts/generate-avatar-fixtures.mjs`;
  (c) pre-existing ESLint errors (`react-hooks/*` in unrelated files) are listed in `deliverables/PROFILE_PICTURE_DISABLED_REPORT.md`.

## Restoring the feature later

1. `src/lib/profile/featureFlags.ts` → set `CUSTOM_PROFILE_PICTURE_ENABLED = true`.
   This alone re-enables: the avatar API (`/api/user/avatar`), the `profile_image_key` column in `userColumns`, custom
   URLs in `/api/user/me` + public creator payloads, and custom pictures in `TelegramAvatar` (custom → Telegram → initials).
2. In `src/components/tabs/ProfileTab.tsx` render `EditProfileWithPicture` instead of `EditProfile`
   (`import EditProfile from "@/components/profile/EditProfileWithPicture"`), **or** copy the picture section back into
   `EditProfile.tsx`. Remember the lock-icon-only username row in the old screen is already updated.
3. Make sure the production database still has `users.profile_image_key` (`migrations/profile_customization/up.sql`) and
   that DBByte env vars (`DBBYTE_*`) are configured — if the column was dropped, re-add it first.
4. Run `npx vitest run src/components/profile src/app/api/user` — `EditProfileWithPicture.test.tsx`,
   `profile.e2e.test.ts` and `TelegramAvatar.customEnabled.test.tsx` already test the restored behaviour (they force the
   flag on); the "disabled" tests (`EditProfile.test.tsx`, `profile.disabled.e2e.test.ts`, `TelegramAvatar.test.tsx`,
   `CreatorRow.test.tsx`, `ProfileCard.test.tsx` avatar tests) must then be updated/removed.
5. Related docs: `PROFILE_PICTURE_CROPPER.md`, `PROFILE_CARD_AND_EDIT_PROFILE.md`, `DBBYTE_THUMBNAILS.md`.
