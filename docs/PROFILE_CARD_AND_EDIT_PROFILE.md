> ⚠️ **TEMPORARILY DISABLED.** Custom profile pictures (upload / crop / remove) are switched off in the UI and API. The code described below is kept for a future restore — see [`PROFILE_PICTURE_TEMPORARILY_DISABLED.md`](./PROFILE_PICTURE_TEMPORARILY_DISABLED.md). Edit Profile currently offers Display name + a lock-icon-only Username.

# Profile Card redesign + Edit Profile (custom picture & display name)

**Migration required: YES (additive, 2 nullable columns) — `migrations/profile_customization/`. NOT executed against Production by this change.**

## What changed
* **Me › Profile Card** is now an identity card: picture, display name, **Creator** badge, `ID: <Telegram ID>` + copy button, and a **pencil** (Edit Profile). The Files / Downloads / Earned statistics (and their layout) were removed from the card. The underlying data (`total_downloads`, `total_earnings`, wallet, APIs) is untouched.
* The old gear → "Account Settings" sub-page (which let users edit username/first name) is replaced by **Edit Profile**.
* The **@username** is no longer shown on the card. It is still stored, still synced from Telegram, and shown **read-only** on Edit Profile (lock icon only; the "Managed by Telegram" label was removed). The server rejects any attempt to PATCH it.

## Telegram User ID
* Source: `users.telegram_id`, returned by `GET /api/user/me` from the **server-side session user** (`serializeSessionUser`, `src/lib/profile/serialize.ts`). `users.id` is never shown; nothing is generated; the client never supplies an id.
* Copy: `ProfileCard` calls the existing `copyText()` (`src/lib/playlistShareClient.ts`: Clipboard API → `execCommand` fallback) with the digits only. Success → toast + check icon for ~1.6 s; failure → toast telling the user to press-and-hold the (selectable) ID.

## Avatar priority (one implementation: `<TelegramAvatar/>`)
1. **Custom picture** — `users.profile_image_key` → URL (`buildThumbnailUrl`) → prop `customUrl`
2. **Telegram photo** — `users.avatar_url` → prop `photoUrl` (unchanged host allow-list)
3. **Initial-letter avatar** — the existing circle, always rendered underneath (no layout shift, no broken-image icon)

A candidate that fails to load is skipped, so a broken custom image falls back to Telegram, then initials. Removing the custom picture clears the key → Telegram photo → initials. The same component/rule is used on the Profile Card, Edit Profile and the public creator row (`CreatorRow`, `/api/link/[slug]`, `/api/p/[slug]` via `toPublicCreator`).

## Data model (migration)
| column | type | meaning |
|---|---|---|
| `users.display_name_custom` | `varchar(64) NULL` | custom name; NULL → Telegram `first_name` |
| `users.profile_image_key` | `varchar(255) NULL` | object key in the existing thumbnail storage; NULL → no custom picture |

Neither column is ever written by `/api/auth/telegram` (Telegram sync), so a custom name/picture survives re-login (covered by `src/app/api/user/profile.e2e.test.ts`). No column was renamed or dropped; no rows are modified. Apply with `npx drizzle-kit push` on a DEV database, or review/run `migrations/profile_customization/up.sql` yourself for Production. Rollback: `down.sql`.

## Storage & validation (reused, not duplicated)
`src/lib/profile/avatarService.ts` uses the existing `ThumbnailStorage` seam (DBByte), `processThumbnail` (magic-byte sniffing, decoder cross-check, animated / > 2 MB / > 40 MP rejection, re-encode), the orphan queue and the upload gate. Only the optimised image is stored — the original upload is discarded. Replace order: store new → commit key → delete old (failure → orphan queue). The browser centre-crops to ≤ 512×512 before upload (`src/lib/profile/avatarClient.ts`) so the preview equals the stored image and uploads are small.

## API
* `POST /api/user/avatar` (multipart `file`) · `DELETE /api/user/avatar` — session + same-origin required, rate-limited, own row only.
* `PATCH /api/user/me { displayName }` — validated by `validateDisplayName` (trim/collapse spaces, ≤ 64 code points, no control/bidi/zero-width chars, no `<` `>`); `""` clears it. `username` → 400.
* `GET /api/user/me` additionally returns `displayName`, `displayNameCustom`, `customAvatarUrl`.

## Tests added
`identity.test.ts`, `avatarService.test.ts`, `avatar.test.ts` (custom URL sanitiser), `TelegramAvatar.test.tsx` (3 priority states + fallbacks), `ProfileCard.test.tsx`, `EditProfile.test.tsx`, `profile.e2e.test.ts` (DB-backed).

## Not covered / manual device checks
Real Telegram clients (clipboard inside the WebView, native BackButton, light/dark theme sync), the real DBByte bucket (tests use an in-memory provider) and visual review on small Android screens were **not** tested automatically.
