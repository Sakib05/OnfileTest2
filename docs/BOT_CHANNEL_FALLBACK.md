# Channel connection — Direct Picker + "Connect channel via bot" fallback

Onfile connects a creator's **private** Telegram channel in one of two ways. The
user never sees a forced "update Telegram" message any more.

| Client | What the user sees | Mechanism |
| --- | --- | --- |
| Telegram with Bot API ≥ 9.6 (`Telegram.WebApp.requestChat`) | **Connect Channel** (unchanged Direct Picker) | `savePreparedKeyboardButton` + `WebApp.requestChat(id)` |
| Older Telegram clients | **Connect channel via bot** | Deep link → bot chat → `request_chat` reply keyboard |

Both paths end in the **same** pipeline: Telegram posts a `chat_shared` service
message to the webhook → the pending request is atomically claimed → the channel
is **re-verified live** against the Bot API (`verifyChannelOwnershipAndBotAccess`)
→ only then is a `channels` row written (`finalizeVerifiedChannelConnection`).

## How Direct Picker support is detected

Telegram exposes no dedicated capability flag for `requestChat`, so:

1. **Up front, no network call** (`isRequestChatSupported()` in
   `src/lib/telegramWebApp.ts`): `WebApp.requestChat` must exist **and**
   `WebApp.isVersionAtLeast("9.6")` must be true. (The Telegram script defines
   `requestChat` on *every* client, so the version gate is the documented signal.)
2. **Runtime safety net** (`requestChatSelectionDetailed`): the Telegram script
   throws `Error("WebAppMethodUnsupported")` when the client is too old. Only that
   error (or a missing method) is classified `"unsupported"` → fallback.

The fallback is **not** triggered by: a dismissed/cancelled picker (`not_sent`),
any other client error (`error`, e.g. a picker already open), network errors, or
HTTP/server errors from our API — those keep their normal error messages.
On an unsupported client the bot option is shown immediately (no wasted tap);
there is no repeated prompting because the state machine only moves to
`bot_fallback` on those two signals.

## How the bot fallback works

1. Tap **Connect channel via bot** → `POST /api/channels/connect-bot-request`.
   The identity comes from the session / signed setup cookie
   (`resolveConnectingIdentity`) — the browser never supplies a Telegram id. The
   server creates a normal `pending_channel_requests` row and returns
   `{ token, botUrl }`, where `botUrl = https://t.me/<getMe().username>?start=<payload>`.
   The username is read from the configured bot via `getMe` — nothing is hardcoded.
2. The Mini App opens `botUrl` with `Telegram.WebApp.openTelegramLink` (falls back
   to `window.open`, which Telegram routes natively for t.me URLs). Telegram opens
   the Onfile bot chat. The UI then says it is *waiting for selection in the bot
   chat* — it never claims the picker has opened.
3. Telegram delivers `/start <payload>` (users who never started the bot see
   Telegram's **Start** button; already-started users have it sent automatically).
   The webhook (`handleBotTextMessage`) verifies the payload, then replies with a
   `ReplyKeyboardMarkup` whose single button is a `request_chat` button.
4. The user taps **Select channel to connect** → Telegram's native channel picker
   opens (this tap is required by the Bot API; opening the chat alone cannot open
   it). Telegram may then ask to add the bot as admin with *Post Messages*.
5. Telegram posts `chat_shared` → shared pipeline (claim → live verification →
   finalize). The bot then sends ✅ success or ❌ the specific reason in chat.
6. The Mini App polls `/api/channels/connect-status` and also refreshes on
   `visibilitychange`, window `focus` and Telegram's `activated` event, so the new
   status appears as soon as the user returns. Telegram does **not** reopen the
   Mini App by itself.

Plain `/start` (no payload) explains how to begin; `/connect` re-sends the
keyboard for the user's latest active bot request.

## Exact Telegram Bot API mechanism

* `sendMessage` with `reply_markup` = **`ReplyKeyboardMarkup`** containing a
  **`KeyboardButton.request_chat`** (`KeyboardButtonRequestChat`, Bot API 6.5+;
  `resize_keyboard`, `one_time_keyboard`). Not an inline button, not plain text.
* Criteria (shared with the Direct Picker via `buildRequestChatCriteria`, so they
  cannot drift): `chat_is_channel: true`, **`chat_has_username: false`** (private
  only), `bot_administrator_rights` = only `can_post_messages`,
  `user_administrator_rights` = same (required superset, avoids `USER_RIGHTS_MISSING`),
  `request_title: true`, `request_id` = the pending request's id.
* Result: `message.chat_shared { request_id, chat_id }`.

## How the pending request is secured

* Same table and safeguards as the Direct Picker: browser token stored only as a
  SHA-256 hash, 10-minute TTL, bound to one Telegram user id, atomic
  `claimed_at` claim (a duplicate/replayed update can't connect twice), plus
  `telegram_update_log` update-id de-duplication.
* **Signed start payload** `c1_<request_id base36>_<24 hex>`: HMAC-SHA256 over
  `onfile-bot-connect:c1:<request_id>:<telegram_user_id>` using
  `SETUP_TOKEN_SECRET || TELEGRAM_BOT_TOKEN` (the existing secret). It contains no
  secret, fits Telegram's 64-char `[A-Za-z0-9_-]` limit, is user-bound (a forwarded
  link fails for anyone else) and is checked with `timingSafeEqual`. Arbitrary or
  edited start parameters are rejected.
* `lookupPendingForBotStart` only returns a request that belongs to the pressing
  user, is a *bot-method* request, is unexpired, still `pending` and unclaimed.
  Wrong-user, expired, already-used and unknown cases each get a non-leaking reply.
* A `chat_shared` is matched on `(from.id, request_id)` — another user's chat can't
  complete someone else's request. Channel type, public username, bot admin status,
  bot `can_post_messages` and the user's admin/creator status are all re-checked
  server-side with live Bot API calls; client-supplied ids/usernames are never trusted.
* Multiple attempts create independent requests (each with its own id and token).
* **No database migration.** The connection method is encoded in the Telegram
  `request_id` range (direct `[1, 2^30)`, bot `[2^30, 2^31−1)`) and is used only to
  decide whether to send in-chat messages — never as authorization. Direct Picker
  requests never produce bot-chat messages.

## UI states

Direct picker available (primary button) · unavailable (bot option) · opening bot
chat · waiting for selection in bot chat · channel selected / verifying ·
bot not administrator · missing permissions · private-channel criteria not met ·
request expired · connected · failed (specific message, **Try Again**). A pending
request is persisted (localStorage, sessionStorage fallback) for its lifetime so
reopening the Mini App resumes it; **Open bot chat again** reuses the same request.

## Known limitations (not verified on real devices)

* Only mocks and a real Postgres were used — **no real Telegram client or live bot
  was tested** (see the delivery report for what is verified vs. unverified).
* Whether an already-started user sees `/start <payload>` sent automatically or
  must tap Start is Telegram client behavior; the copy covers both.
* On clients older than Bot API 7.0, `openTelegramLink` closes the Mini App; the
  persisted pending request resumes when it is reopened.
* `request_chat` reply keyboards were introduced in Bot API 6.5 (Feb 2023). Telegram
  apps older than that can't use either automatic path; **Manual Connect** remains available.
* If Telegram rejects the `request_chat` keyboard (e.g. rights mismatch) the user
  is not told in chat (nothing is sent); the Mini App keeps waiting until expiry.
* `allowed_updates` must include `message` and `my_chat_member`
  (`scripts/configure-telegram-webhook.mjs` already sets this) — no new setup.

## Tests

`npx vitest run` — DB-backed suites need a disposable DEV Postgres with the schema
applied (`npx drizzle-kit push`). New suites: `botConnectFlow.test.ts`,
`telegramWebApp.test.ts`, `components/setup/BotConnectInstructions.test.tsx`,
`api/channels/connect-bot-request/route.test.ts`,
`api/telegram/webhook/botFallback.e2e.test.ts`.
