# Bot welcome message, channel-picker placement, and success confirmation

Scope: three bot-chat copy/UX changes. The connection architecture (single Connect button, 10-minute
backend window, signed `/start`, native picker, webhook verification, replay/duplicate protection) is
**unchanged**. No database migration is needed (`connect_started_at`, `picker_sent_at`,
`confirmation_sent_at` already exist and are reused as-is).

## 1. Creator-focused welcome (`BOT_MESSAGES.welcome`, `src/lib/botConnectFlow.ts`)

* The old technical "how to connect" welcome was the `BOT_MESSAGES.welcome` text sent for a plain `/start`.
  It is replaced by the approved creator-focused introduction. It contains no setup, permission, button or
  picker instructions. It is sent as plain text (no `parse_mode`), so there is no markup to break.
* **New vs returning**: the webhook reads whether a verified private chat was already on file *before* it
  records the chat, and passes `isFirstContact` to `handleBotTextMessage`:
  * plain `/start`, first contact (or unknown) → creator welcome;
  * plain `/start`, returning user → short `BOT_MESSAGES.welcomeBack` (never the full onboarding again);
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

## 3. Success confirmation

After the existing secure pipeline (claim → live Bot API re-verification of the channel, bot admin and
user admin → finalize → mark verified) the bot sends, once (atomic `confirmation_sent_at`):

```
✅ {Channel Name} is now connected to your Onfile account.

Your channel is ready!

Return to Onfile to automatically refresh and view your connection status.
```

* `{Channel Name}` is the title Telegram returned in the live verification (`verification.chat.title`),
  falling back to the stored channel name. The `chat_shared.title` in the update is never used.
* The message carries an inline `web_app` button **Return to Onfile** → `<MINI_APP_URL>/?connect=<ref>`
  (public request ref only; no token/secret/ids). The Mini App resumes from that ref
  (`useChannelConnect` → `startTracking`), polls the server-authoritative status and shows the success state
  without pressing Connect and **without creating another pending request**.
* If no https Mini App URL is configured, the message is still sent (without a broken button) and an
  error is logged (`bot_connect_return_button_unavailable`). Set `MINI_APP_URL` in the deployment.
* Sent only when verification succeeds; failures use the existing failure messages.

## Tests

`src/lib/botConnectFlow.test.ts`, `src/app/api/telegram/webhook/privateChat.e2e.test.ts`,
`src/app/api/telegram/webhook/botFallback.e2e.test.ts` (Postgres + mocked Telegram Bot API; use a DEV DB).
Real-device Telegram (Android/iOS) testing has **not** been performed — see the checklist in
`BOT_GUIDED_CONNECT.md`.
