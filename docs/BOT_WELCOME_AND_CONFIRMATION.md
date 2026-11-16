> **Update:** the channel is no longer verified/connected by the `chat_shared` webhook. The webhook only stores the selection and immediately sends the Channel Verification message; verification and connection happen when the user taps **Verify** (Mini App → `POST /api/channels/connect-verify`). The Channel Selection / Verification message copy and the removed 3 s navigation delay are described in [CHANNEL_VERIFY_FLOW.md](CHANNEL_VERIFY_FLOW.md); where this document says otherwise, that one wins.

# Bot welcome message, channel-picker placement, and success confirmation

Scope: three bot-chat copy/UX changes. The connection architecture (single Connect button, 10-minute
backend window, signed `/start`, native picker, webhook verification, replay/duplicate protection) is
**unchanged**. No database migration is needed (`connect_started_at`, `picker_sent_at`,
`confirmation_sent_at` already exist and are reused as-is).

## 1. Creator-focused welcome (`BOT_MESSAGES.welcome`, `src/lib/botConnectFlow.ts`)

* The old technical "how to connect" welcome was the `BOT_MESSAGES.welcome` text sent for a plain `/start`.
  It is replaced by the approved creator-focused introduction. It contains no setup, permission, button or
  picker instructions. It is sent as plain text (no `parse_mode`), so there is no markup to break.
* **Ordinary `/start` fast path** (no payload, or any payload that is not our signed `c1_…` one — see
  `isOrdinaryStartCommand` in `src/lib/botConnectFlow.ts`): **every** user, new or returning, gets the same
  creator welcome. The webhook does **no** account lookup and **no** `bot_private_chats` read or upsert for it
  (so there is no `isFirstContact` and no `welcomeBack` reply any more); the only database statement before the
  reply is the `telegram_update_log` idempotency insert, and the only Telegram call is the single `sendMessage`,
  which is awaited before the webhook responds. The private chat is still recorded by every other private
  message (`/connect`, signed `/start c1_…`, …), by `my_chat_member` updates, and is backfilled by the existing
  `getChat` probe when a user connects a channel from the Mini App.
* The remaining flows keep reading `isFirstContact` (read BEFORE the chat is recorded):
  * signed `/start c1_…` from a first-contact user → creator welcome, **then** the unchanged picker message;
  * signed `/start c1_…` from a returning user → picker only (unchanged);
  * users reached through the backend's existing-chat delivery never receive a welcome.
  Telegram `update_id` de-duplication means a redelivered `/start` cannot send a second welcome.
  A failed welcome send never blocks the picker.

### Product-claims audit of the approved copy (not silently asserted)

The copy is the exact text approved by the product owner. Checked against the current code:

| Claim | State in the codebase |
| --- | --- |
| 📂 Share Without Limits — file sharing | Implemented (publish → smart link → bot forwards the original). "Without limits" is marketing wording; Telegram's own file-size limits still apply. |
| 🎯 Stay in Control — you remain the owner | Implemented (files stay in the creator's own private channel; Onfile stores no originals). |
| 💰 Monetize Your Content / 📈 Grow Your Earnings | **Only partially supported today.** Paid publishing via Telegram Stars is disabled (`STARS_PAID_PUBLISHING_ENABLED = false`, no payment backend). Downloads can be gated by an ad countdown or password, but no code path credits earnings to a creator's wallet (nothing inserts earning `transactions`; the Wallet tab shows "Coming soon"). The in-app FAQ already words this as "designed to let creators monetize … over time … we can't guarantee any specific earnings". |

The welcome copy deliberately uses "earning opportunity" and "potential income" and promises no amount.
**Product decision needed:** either keep the wording (as approved) until earnings crediting ships, or
soften "Earn revenue … through Onfile's monetization system". Nothing in the copy is a guarantee.

## 2. Channel picker placement — decision: keep the Reply Keyboard

Verified against the official Telegram Bot API reference (v10.4, <https://core.telegram.org/bots/api>):

* `KeyboardButton` (reply keyboard) has `request_users`, `request_chat`, … — the native picker.
* `InlineKeyboardButton` has only `text`, `url`, `callback_data`, `web_app`, `login_url`,
  `switch_inline_query*`, `copy_text`, `callback_game`, `pay` (and styling/disabled fields).
  **There is no `request_chat` on an inline button**, so the native channel picker cannot be attached to a
  message. (`switch_inline_query_chosen_chat` only picks a chat to run an inline query in — not usable here.)

Therefore `buildChannelPickerKeyboard` is unchanged: a `ReplyKeyboardMarkup` `request_chat` button sent
with the instruction message. Telegram shows it above the input field; that is a client constraint.
Tests assert the picker is a reply-keyboard `request_chat` button and never an `inline_keyboard`.

## 3. Channel Verification message (replaces the old "success" message)

After the existing secure pipeline (claim → live Bot API re-verification of the channel, bot admin and
user admin → finalize → mark verified) the bot sends, once (atomic `confirmation_sent_at`), with `chat_id` = the verified
private chat, **no `parse_mode`**:

```
🔐 Channel Verification

Your channel connection is ready.

Tap the button below to verify your connection and continue to your Onfile dashboard.
```

* The copy is static (`CHANNEL_VERIFICATION_MESSAGE`). It deliberately contains **no channel title**: nothing taken from
  `chat_shared.title`, the update, or even the live `getChat` title can reach it.
* The message carries ONE inline `web_app` button **Verify** → `<MINI_APP_URL>/?connect=<ref>`
  (public request ref only; no token/secret/ids/title). It is the same launch URL the former "Return to Onfile" button used.
* **What "Verify" does** (`page.tsx` → `ConnectionVerifyGate`): signs the Telegram user in silently (initData), asks the
  backend about the EXISTING request (`GET /api/channels/connect-status?ref=` — read-only; request must belong to the
  authenticated Telegram user, not be expired, and its channel must still be verified and owned by the same account),
  and only on `verified` refreshes the user + connected channels and invalidates the Dashboard data
  (`AppContext.refreshDashboard`) **before** opening the **Dashboard** (Home tab). It never opens Channel Management
  and never creates a pending request. Any other answer (pending, expired, invalid, other user's, failed, network)
  shows an error with "Try Again" (re-checks the same ref) and an explicit "Connect a channel" choice.
* **Mini App URL.** Required production variable: `MINI_APP_URL=https://onfile-app.vercel.app` (public https origin, no
  secret). Accepted explicit fallbacks, in order: `NEXT_PUBLIC_APP_URL`, then `VERCEL_PROJECT_PRODUCTION_URL` (only when
  `VERCEL_ENV=production`). `VERCEL_URL` is **not** used (per-deployment hostname, usually behind Deployment Protection).
  http/non-URL values are rejected, never sent to Telegram.
* If no https Mini App URL resolves, the message is still sent **without** a button (never an invented URL, never a plain
  URL button) and an **error** is logged: `bot_connect_verify_button_unavailable { requiredEnv: "MINI_APP_URL", invalid: [...] }`.
* Delivery is never silent: `bot_connect_success_not_delivered` (no private chat could be located — not even via Telegram's
  `getChat`; the confirmation is *not* consumed), `bot_connect_verify_button_rejected` (Telegram answered 400 to the
  keyboard → text-only message is sent), `bot_connect_success_send_failed` (Telegram refused the message). The webhook also
  logs `telegram_webhook_success_notification { delivered, buttonAttached }` for every verified bot-guided request.
* The chat is located from the stored private chat, else the private chat of the update, else Telegram's own `getChat(<user id>)`
  answer (this matters when the `my_chat_member` update — sent when the picker promotes the bot — beats `chat_shared`).
* Legacy Direct Picker requests (`request_id < 2^30`, not used by the current UI) never get an in-chat message
  (`telegram_webhook_in_chat_notification_skipped`).
* Sent only when verification succeeds; failures use the existing failure messages.

## Tests

`src/lib/botConnectFlow.test.ts`, `src/app/api/telegram/webhook/privateChat.e2e.test.ts`,
`src/app/api/telegram/webhook/botFallback.e2e.test.ts` (Postgres + mocked Telegram Bot API; use a DEV DB).
Real-device Telegram (Android/iOS) testing has **not** been performed — see the checklist in
`BOT_GUIDED_CONNECT.md`.

## 2a. `/start` response-time optimization (ordinary `/start` only)

Removed from the ordinary `/start` path: the `bot_private_chats` first-contact SELECT (`getPrivateChat`) and the
`bot_private_chats` upsert (`recordPrivateChat`), plus the new/returning branching they fed. Kept: webhook secret
check, `telegram_update_log` idempotency insert, awaited `sendMessage`, error handling, and all signed-payload /
`/connect` / `chat_shared` / `my_chat_member` behaviour. Covered by
`src/app/api/telegram/webhook/startFastPath.e2e.test.ts`.
