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

## How the bot fallback works (one tap, no repeated "/start")

There is exactly ONE primary action: **Connect channel via bot**. (There is no
"Open bot chat again" button and no explanatory card; failures/expiry show a clear
message and are retried with that same button.)

1. Tap → `POST /api/channels/connect-bot-request`. Identity comes from the session /
   signed setup cookie (`resolveConnectingIdentity`) — never from the browser. The
   server **supersedes** any earlier still-open bot request of that user (so there is
   never more than one live request), creates the new pending request, reads the bot's
   `@username` from `getMe` (nothing hardcoded) and decides the mode:
   * **`existing_chat` — returning user.** The server looks up the user's *verified
     private chat id* (`bot_private_chats`, see below) and calls Bot API `sendMessage`
     to **that chat id** with the `request_chat` keyboard ("Select channel to connect").
     The response's `botUrl` is the **plain** `https://t.me/<bot>` link — **no
     `?start=`**, so Telegram posts **no new "/start"** from the user.
   * **`start_link` — first-time (or blocked / invalid-chat) user.** Telegram does not
     let a bot start a private conversation, so the existing signed Start flow is used:
     `https://t.me/<bot>?start=<HMAC payload>`; Telegram's required Start delivers the
     payload, the webhook verifies it and sends the keyboard. `fallbackReason` tells why:
     `no_chat` | `bot_blocked` | `chat_invalid` | `lookup_failed`.
   * A **transient Telegram error** (429/5xx/timeout) answers `502` and cancels the
     request. It does *not* fall back to the start link (that would cause a "/start").
2. The Mini App persists the request, starts polling, fires a subtle haptic
   (`HapticFeedback.impactOccurred("light")`), then **immediately** opens the chat with
   `Telegram.WebApp.openTelegramLink(botUrl)`. If Telegram refuses (missing method /
   throws) the waiting screen says so in plain text and names the bot — it never fails
   silently, never uses `window.open`, and opens at most one chat (double taps are ignored).
3. The user taps **Select channel to connect** → Telegram's native channel picker.
4. Telegram posts `chat_shared` → shared pipeline (claim → live verification →
   finalize). The bot confirms ✅/❌ in the verified private chat.
5. The Mini App polls `/api/channels/connect-status` and refreshes on `visibilitychange`,
   `focus` and Telegram's `activated`. Success haptic only after the server says `verified`.

### Where the private chat id comes from (and why it is trusted)

New table **`bot_private_chats`** (`telegram_user_id` unique, `chat_id`, `status`
`active|blocked`, `source` `webhook|get_chat`). A chat id is written **only** from:

* a webhook update (authenticated by `TELEGRAM_WEBHOOK_SECRET`) — a human user's
  `message` in a `private` chat (key = `from.id`, value = `chat.id`), or a
  `my_chat_member` update about our bot in a `private` chat (`kicked` ⇒ `blocked`,
  `member` ⇒ `active`);
* for users who started the bot **before** this table existed: Telegram's own answer to
  a `getChat` probe for the *authenticated* user, accepted only if Telegram returns
  `type: "private"` and a numeric id (`source = get_chat`). "chat not found" ⇒ the user
  never started the bot ⇒ signed start link.

It is never taken from the browser, it is looked up by the server-side authenticated
Telegram user id, and a user id and a chat id are stored side by side — never treated as
interchangeable (the confirmation messages now use the stored chat id too). `sendMessage`
itself is the authoritative "can the bot still message this chat" check: 403 *blocked /
deactivated* ⇒ mark `blocked`, 403 *can't initiate conversation* or 400 *chat not found*
⇒ drop the association, both ⇒ signed start link (Telegram shows **Restart**/**Start**).

Plain `/start` (no payload) explains how to begin; `/connect` re-sends the keyboard for
the user's latest active bot request.

### "I've finished in the bot — check status"

Shows loading at once, calls `/api/channels/connect-status` (which now also verifies
that the request belongs to the authenticated Telegram user), and shows: success (only
after the server says `verified`), a short *pending* message, *expired* (+ retry with the
primary button), or a useful network/server error with retry. It shares one in-flight
request with the poll timer, ignores responses for superseded requests and applies a
terminal outcome exactly once (no duplicate success / haptic / `onConnected`).

### Haptics (Telegram `WebApp.HapticFeedback`, Bot API 6.1+)

| Moment | Call |
| --- | --- |
| request prepared, right before opening the bot chat | `impactOccurred("light")` |
| server-confirmed connection (Direct Picker **and** bot fallback) | `notificationOccurred("success")` |
| important failure (request failed, verification failed, expired) | `notificationOccurred("error")` |
| Telegram refused to open the chat | `notificationOccurred("warning")` |

All calls are best-effort (`triggerHaptic`), never throw and never block the flow. A bot
cannot make a user's device vibrate by sending a message, and the Mini App cannot observe
the moment the bot's message becomes visible — the haptic is the Mini App's own, fired
immediately before the redirect.

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
* The connection *method* is still encoded in the Telegram `request_id` range (direct
  `[1, 2^30)`, bot `[2^30, 2^31−1)`) and is used only to decide whether to send in-chat
  messages — never as authorization. Direct Picker requests never produce bot-chat messages.
* **One additive migration** for the returning-user flow: `migrations/bot_private_chats/`
  (`up.sql` / `down.sql`; equivalent to `drizzle-kit push` for the new table). It is **not**
  applied to production by this change. If it has not been applied, everything degrades to
  the pre-existing signed start flow (association lookups/writes fail safely and are logged).

## UI states

Direct picker available (primary button) · unavailable → **one** orange "Connect channel via
bot" button · opening bot (disabled button) · waiting (small loader + "Waiting for channel
selection...", "I've finished in the bot — check status", Cancel) · channel selected /
verifying · bot not administrator · missing permissions · private-channel criteria not met ·
request expired · connected · failed (specific message + the same primary button). A pending
request is persisted (localStorage, sessionStorage fallback) for its lifetime so reopening
the Mini App resumes it (without re-opening the chat).

Direct Picker success (Channel Management): "🎉 Congratulations! Your channel is now
connected to your Onfile account." + the channel name; onboarding's success screen carries
the same sentence. The bot-chat confirmation ("✅ “Name” is now connected…") is unchanged.

## Telegram native Back Button

`src/lib/telegramBackButton.ts` is the single owner of `WebApp.BackButton`: one click
listener, a stack of registered screens (only the topmost handles a tap), shown while ≥1
nested screen is registered, hidden on root screens, removed on cleanup. Screens use
`useTelegramBackButton(onBack, enabled)`. Registered: Playlist page (unchanged semantics),
Manual Connect guide, Bot connect page, Profile sub-pages. The Close Button is never touched.

Manual Connect guide ("View step-by-step guide") — three separate controls:

| Control | Behaviour |
| --- | --- |
| bottom **Back** | previous guide step (disabled on step 1; never leaves the guide) |
| bottom **Next** | next guide step (step 8 submits for verification) |
| Telegram **native Back** (and the in-page header arrow outside Telegram) | exits the whole guide, from any step |

## Known limitations (not verified on real devices)

* Only mocks and a real Postgres were used — **no real Telegram client or live bot
  was tested** (see the delivery report for what is verified vs. unverified).
* First-time (never started / blocked) users cannot be reached without Telegram's own Start
  interaction — that cannot be bypassed; the signed start link is used for them.
* Users who started the bot before `bot_private_chats` existed are recognised through the
  `getChat` probe; if Telegram cannot confirm a private chat they get the start link once,
  after which the chat is recorded from the webhook.
* The haptic can't be tied to the moment the bot's message appears (not observable).
* `openTelegramLink` after the async request is supported by the docs (only `openLink` is
  documented as user-interaction-only), but this was **not** verified on real devices; if a
  client refuses, the waiting screen tells the user which bot to open.
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
applied (`npx drizzle-kit push`). Suites: `botConnectFlow.test.ts`, `botPrivateChats.test.ts`,
`telegramWebApp.test.ts`, `telegramBackButton.test.ts`, `useTelegramBackButton.test.tsx`,
`components/setup/BotConnectInstructions.test.tsx`, `components/setup/ManualConnectGuide.test.tsx`,
`api/channels/connect-bot-request/{route,existingChat}.test.ts`,
`api/channels/connect-status/route.test.ts`,
`api/telegram/webhook/{botFallback,privateChat}.e2e.test.ts`.
