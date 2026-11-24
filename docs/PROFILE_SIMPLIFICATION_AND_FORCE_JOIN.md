# Profile simplification + Force Join

## A. Profile
* **Removed from the UI**: Upload / Change / Remove photo, the file picker, the 1:1 cropper (`AvatarCropper` component + its test deleted), upload progress/error UI.
* **Avatar** priority is now Telegram photo → initial-letter avatar (`TelegramAvatar` ignores any stored custom picture; no broken/empty image — the initials circle is always rendered underneath).
* **Edit Profile** edits the Display Name only, through the existing authenticated `PATCH /api/user/me` (same validation/errors). The username is read-only text with a small lock icon beside it (no explanatory label). Telegram username / user id can't be changed (the API still rejects `username`).
* **Kept on purpose (temporary product decision, not a deletion):** `POST/DELETE /api/user/avatar`, `src/lib/profile/avatar*`, `cropMath`, `imageFormat`, the `profile_image_*` columns, stored images and the DBByte configuration. Their tests still run. Public creator payloads still include `customAvatarUrl`, but no UI reads it.
* Telegram sync is unchanged; it never touches `display_name_custom` (the custom display name).

## B. Advertise
The repository already contained the Creator Advertising dashboard (see `ADVERTISING_SYSTEM.md`); it was audited against the brief and kept. This change adds what was missing:
* **Force Join** placement (members-only gate on one owned file) — end to end (wizard, validation, ownership, admin approval, server enforcement, UI gate, tests).
* **`chat_member` webhook handling** for verified joins.

Audit result for the existing code: creator endpoints require a session and scope by `user_id`; there is no public list endpoint; clients can't set status/counters/pricing; impressions/clicks need a signed serve token and are de-duplicated by a unique key; admin endpoints use `requireAdmin`; no wallet is touched (no hold mechanism exists → campaigns stay *pending payment/admin confirmation*); no rates are hard-coded; external ad networks are not integrated (`source` column + `src/lib/ads/*` stay the extension point).

## Migration
**None required.** Force join reuses existing `ad_campaigns` columns (`file_id`, `placements`, `objective`, …). `migrations/ad_campaigns_v2` (from the earlier Advertise work) is still required where it hasn't been applied. Nothing was executed against production.
Operational step: re-run `scripts/configure-telegram-webhook.mjs` per environment so Telegram sends `chat_member` updates.

## Known limitations
* Content Access objective and campaign-specific invite links are not offered (not reliably measurable / bot lacks `can_invite_users`).
* Only one force-join gate per file; gate is per file (not per playlist).
* Force join fails closed when Telegram can't answer, and requires a Telegram session (outside Telegram the gate explains this).
* Rate limiting is the existing in-memory limiter (per instance).
* Terms/Privacy texts still describe the old enquiry form (flagged earlier).
* 11 pre-existing ESLint errors (`react-hooks/set-state-in-effect` etc.) in untouched files: PerformanceChart, PublishWizard, ThumbnailField, HomeTab, ProfileTab, WalletTab, useNotifications.
* Avatar test fixtures aren't committed; run `node scripts/generate-avatar-fixtures.mjs` before `npx vitest run`.
