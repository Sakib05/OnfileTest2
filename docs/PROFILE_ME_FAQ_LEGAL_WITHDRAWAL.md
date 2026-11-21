# Creator profile, professional Me section, $10 withdrawal minimum, FAQ, Privacy & Security, Terms

One additive migration: `migrations/profile_management/up.sql` (+ `down.sql`). **Not executed against production.**
(`npx drizzle-kit push` against `src/db/schema.ts` is equivalent; only a local DEV database was used.)

## 1. Minimum withdrawal — $10 USD
* Single source of truth: `src/lib/money.ts` (`MIN_WITHDRAWAL_USD = 10`, message `Minimum withdrawal amount is $10.`).
  The app shows balances as USDT with a 1:1 "≈ $ USD" figure, so $10 USD == 10 USDT. The old value (1 USDT) existed in
  two places (`/api/wallet/withdraw` and the Wallet modal) — both now use the constant.
* Server enforcement: `src/lib/withdrawals.ts` (called by `POST /api/wallet/withdraw`).
  * Amounts are parsed from their decimal **string** to integer micro-units (no floats; max 6 decimals — the
    `numeric(18,6)` scale). `9.99` and `9.999999` are rejected, `10`, `10.00`, `10.01` pass.
  * One DB transaction: conditional `UPDATE … WHERE balance >= amount` (check + debit atomically, row-locked) →
    duplicate guard → withdrawal row → transaction row. Any failure rolls everything back, so an invalid request can
    never deduct a balance. Two concurrent requests cannot overdraw.
  * Identical pending request (same amount + address) within 60 s → `409`.
  * Hardening of previously unchecked inputs: currency must be `USDT`, network one of the four already offered
    (`TRC20/ERC20/TON/BEP20`), address 8–128 chars without whitespace, per-user rate limit (5/min) on top of per-IP.
* UI (`WalletTab.tsx`): minimum shown on the balance card and in the modal; balance < $10 shows an explanation and
  disables submit; amount < $10 shows the message without calling the API. Payment methods, history and balance
  calculations are unchanged. Historical records and balances are never modified by this change.

## 2. Creator profile
* **Display Name** — stored in the existing `users.first_name` (what every screen already shows). New column
  `display_name_custom` stops the Telegram login sync (`/api/auth/telegram`) from overwriting an edited name.
  1–64 characters, control/zero-width/bidi characters rejected, whitespace normalised. Appears everywhere automatically
  (Me, public file page, public playlist page).
* **Username is read-only.** The old `PATCH /api/user/me` accepted `username`; that is removed and a request containing
  `username`/`telegramId` is refused with `400 username_read_only`. Telegram username sync at login is unchanged. The UI
  has no edit control for it.
* **Profile picture** — `POST/DELETE /api/user/avatar`, logic in `src/lib/profileImage.ts`.
  * Re-uses the existing thumbnail storage seam (`getThumbnailStorage()` → DBByte) and its delete/orphan cleanup. No new
    storage system; nothing is stored as base64. Only the object key is saved (`users.profile_image_key`).
  * Server validation: ≤ 2 MB, magic-byte sniff (JPEG/PNG/WebP only; SVG/GIF/HTML/polyglots rejected), animated images
    rejected, 40 MP decompression guard, full decode, EXIF rotate, centre-crop to 512×512, re-encode as WebP (strips
    metadata). Session-only identity, same-origin check, 10 uploads/min.
  * Replacing deletes the old object after the new one is saved; removing returns to the **existing default avatar**
    (Telegram photo / initial letter) which is never altered (`users.avatar_url` untouched).
  * `resolveAvatarUrl()` is used by `/api/user/me`, `/api/link/[slug]` and the public playlist API so the picture is
    consistent everywhere. `dbbyte.com` was added to the client-side avatar host allow-list.
  * `next.config.ts`: sharp tracing include for `/api/user/avatar` (same as the thumbnail route).

## 3. Me section
`ProfileTab.tsx` is reorganised (same tab, same bottom navigation, same native-Back sub-page mechanism):
header (avatar, display name, @username, Edit Profile) → **Account** (Edit Profile, Account Information) →
**Creator** (Channel Management, Earnings & Withdrawals → existing Wallet tab, Referral Program, Advertise with Us,
admin-only Thumbnail Storage) → **Support & Information** (FAQ & Help, Privacy & Security, Terms & Conditions) →
**Other** (dark-mode switch). Removed because they had no working functionality: *Language*, *Contact Support*, the
no-op *Privacy & Security* row, the "Files —" placeholder stat and the old "Account Settings" page (which let the
username be edited). Back navigation follows the existing rule: Telegram's native Back Button is the only back control.

## 4. Content (local, no DB tables)
`src/content/faq.ts`, `privacy.ts`, `terms.ts`, `legalConfig.ts`. Written against the code (see verified facts below).
**Legal business details are not invented**: `LEGAL_CONFIG` ships with every value `null`, and the pages render
highlighted `[To be configured: …]` placeholders. The documents are implementation drafts needing legal review.

### Facts verified in the code while writing the content (and how they were handled)
* Delivery: after unlock the server returns the Telegram post link and the UI shows **"Open in Telegram"**
  (`SuccessPanel`). The code does not forward the file itself from the bot in that path (the bot only uses `copyMessage`
  to verify that a post exists). Content therefore says "delivery uses Telegram / leads to the original post" and never
  claims bot forwarding.
* No code credits earnings, and no ad network integration exists (the "advertisement" is a 10-second countdown step
  before access to non-password files). Content states no rates, no calculation formula, no ad counts.
* Telegram Stars payments are disabled (`STARS_PAID_PUBLISHING_ENABLED = false`) — stated honestly.
* Reports are stored (reason, details, reporter IP) with status `pending`; no automatic removal or timeline is promised.
* There is no self-service account deletion — the privacy page says so and points to the (placeholder) contact.
* Not changed but worth reviewing before launch: the Wallet modal still says *"Withdrawals are processed within 24-72
  hours"* and the "Advertise with Us" page shows hard-coded audience statistics. Neither is repeated in the new content.

## 5. Tests added
`src/lib/money.test.ts`, `src/app/api/wallet/withdraw/withdraw.e2e.test.ts` (real Postgres),
`src/app/api/user/profile.e2e.test.ts` (real Postgres; fake in-memory image storage; locally-signed Telegram initData),
`src/components/tabs/ProfileTab.test.tsx`, `src/components/tabs/WalletTab.minimum.test.tsx` (jsdom, mocked fetch),
`src/content/content.test.ts`. One existing test (`notifications.e2e.test.ts`) requested a 5 USDT withdrawal; it now
requests 12 because 5 is (intentionally) below the new minimum.
