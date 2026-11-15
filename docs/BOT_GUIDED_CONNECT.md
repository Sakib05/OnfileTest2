# Bot-guided channel connection (Connect → bot chat → Return to Onfile)

> **Update:** the separate **Start** button/step was removed. A single **Connect** button now prepares the request,
> starts the backend window, shows the countdown and hands off to the bot (open chat **then** `Telegram.WebApp.close()`).
> See [`CONNECT_SINGLE_BUTTON.md`](./CONNECT_SINGLE_BUTTON.md) for the root cause, the new flow and limitations;
> where this older document still says "Start" / "`openTelegramLink` and never `close()`", the new document wins.

This **replaces** the earlier "tap once and the bot opens immediately" fallback and the Mini App
Direct Picker as the way to connect a channel from the **"Connect channel via bot"** section
(onboarding screen `BotConnectInstructions` *and* Channel Management `ChannelConnectFlow`, both driven by
`useChannelConnect`). The existing instruction card is untouched; only the action area below it changed.

```
Mini App                                   Backend                                  Telegram bot chat
────────                                   ───────                                  ─────────────────
[Connect] ──(1)────────────────────────▶ POST /api/channels/connect-bot-request
                                           secure random token (hash stored),
                                           user-bound request, state "prepared"
        ◀─────────────── token, ref, botUsername  (NO bot message, NO countdown)
          ──(2, same tap, same token)────▶ POST /api/channels/connect-bot-start
                                             atomically starts the SERVER window
                                             (connect_started_at, expires_at = now+10m)
                                             returning user: sendMessage(welcome + request_chat) ──▶ message + native
                                             first-time user: signed ?start= link                     "Select channel" button
        ◀──────── expiresAt, serverTime, botUrl, mode
   countdown 10:00 + "Waiting for channel selection…" shown (server clock)
   wait ~3 s (module-level timer, survives unmounts)
   Telegram.WebApp.openTelegramLink(botUrl), then Telegram.WebApp.close() ───────────────────────────────────────────────────▶ bot chat opens
                                                                                  user picks a private channel
                                           POST /api/telegram/webhook  ◀───────── chat_shared {request_id, chat_id}
                                             secret header ✔ · update_id dedupe ✔ · (user, request_id) match ✔
                                             connecting ✔ · not expired ✔ · atomic claim ✔ · live getChat/getChatMember ✔
                                             private ✔ · user admin ✔ · bot admin + can_post_messages ✔ · not owned by another account ✔
                                             channels row written ONLY now; request → verified
                                             sendMessage("✅ <verified channel title> is now connected …",
                                                         web_app button "Return to Onfile") ───────▶ confirmation (sent once)
[Return to Onfile] ◀───────────────────── Mini App opens at  <MINI_APP_URL>/?connect=<public ref>
   resumes automatically ───────────────▶ GET /api/channels/connect-status?token=… | ?ref=…
        ◀── connected + channel name  ⇒  "🎉 Congratulations! Your channel is now connected to your Onfile account."
```

## Request lifecycle

Derived (never stored separately) by `deriveLifecycleState` from `status`, `claimed_at`, `connect_started_at`,
`picker_sent_at`, `failure_reason`, `expires_at` of `pending_channel_requests`:

| State | Meaning |
| --- | --- |
| `prepared` | request created by the first half of "Connect"; no countdown, no bot message (also the state a failed start rolls back to, so a retry reuses the request) |
| `connecting` | second half of "Connect" done; 10-min window running; picker not delivered yet (first-time users: waiting for Telegram's Start) |
| `awaiting_channel_selection` | welcome + native picker delivered |
| `verifying` | a genuine `chat_shared` claimed the request; live Telegram checks running (covers "channel_selected" + "verifying": the claim is atomic) |
| `connected` | verified, channel persisted |
| `failed` | verification failed (`failure_reason` says why) |
| `cancelled` | user pressed Cancel / a newer request superseded it |
| `expired` | still pending and past `expires_at` (server clock) |

Timestamps are UTC (`timestamp` columns written from `new Date()`); API answers carry ISO-8601 `expiresAt` and `serverTime`
so the countdown follows the **server** clock (offset), and a stale device clock/timer can neither extend nor end a request.
When the local countdown reaches 00:00 the app only asks the server; the server decides. Expiry is enforced in
`beginBotConnect`, `claimPickerDelivery`, `claimPendingRequestForProcessing`, the `chat_shared`/`my_chat_member` lookups,
`/start` handling and the status route. A request resolved before its window ended stays readable as `connected`
afterwards (user returns late); `pending` rows past expiry are reported `expired`.

## API

| Route | Purpose |
| --- | --- |
| `POST /api/channels/connect-bot-request` | **Connect, step 1 (prepare).** Same-origin + rate-limited; identity from session / signed setup cookie; supersedes the user's earlier open bot request (`cancelled`); returns `{token, ref, state:"prepared", botUsername}` |
| `POST /api/channels/connect-bot-start` | **Connect, step 2 (begin).** Body `{token}`. Starts the window (idempotent, never extends), reserves + delivers the picker message once, returns `{expiresAt, serverTime, botUrl, mode, botUsername, ref, state}`. 502 ⇒ rolled back to `prepared`; 410 expired; 409 cancelled/finished; 404 unknown/other user's |
| `GET /api/channels/connect-status?token=` or `?ref=` | Status + `state`, `expiresAt`, `serverTime`. `ref` (public Telegram request id from the return link) is resolved **only for the authenticated owner**. `verified` is returned only after re-checking the channel row is verified and belongs to the request's account |
| `POST /api/channels/connect-cancel` | unchanged |
| `POST /api/telegram/webhook` | unchanged contract; now also: `/start` requires the window to have been started ("Connect") first, success message carries the Return button and is sent once |

## Telegram Bot API methods used

`sendMessage` (welcome + `ReplyKeyboardMarkup` with `KeyboardButtonRequestChat`; confirmation with an inline `web_app` button),
`getMe`, `getChat`, `getChatMember` (verification, unchanged), `setWebhook` (deployment script, unchanged).

Native picker: `request_chat { request_id = this request's Telegram request id, chat_is_channel: true, chat_has_username: false,
bot_administrator_rights = user_administrator_rights = { can_post_messages }, request_title: true }` inside a reply keyboard
(`resize_keyboard`, `one_time_keyboard`). A normal inline button **cannot** open the picker. The selection is processed from the
genuine `message.chat_shared` update and re-verified independently — the picker's filters are only UX.

## Navigation: `openTelegramLink` **and** `close()`

Superseded by [`CONNECT_SINGLE_BUTTON.md`](./CONNECT_SINGLE_BUTTON.md): since Bot API 7.0 `openTelegramLink(url)` no longer closes the
Mini App, so the shared `navigateToBot()` (`src/lib/botNavigation.ts`) calls `openTelegramLink(botUrl)` and then the official
`Telegram.WebApp.close()`. The same function serves the automatic redirect and the fallback link. `close()` is not "minimise" (no such
documented API exists) and is skipped if the link could not be opened.

## First-time vs returning users

Telegram forbids a bot to message a user who never pressed Start. The server therefore looks up the user's verified private chat
(`bot_private_chats`, filled from authenticated webhook updates, or Telegram's own `getChat` answer) and sends directly when it
exists (`mode: "existing_chat"`). Otherwise (`no_chat`, `bot_blocked`, `chat_invalid`, `lookup_failed`) the existing signed start
link is returned (`mode: "start_link"`); the webhook verifies the HMAC + that the pressing user owns the request, requires that
"Connect" was tapped, then delivers the same welcome + picker. After that first `/start` the user is a returning user.
A transient Telegram failure → 502 and the request is rolled back to `prepared` (never silently falls back to a `/start`).

## Return to Onfile

`web_app` inline button → `<origin>/?connect=<ref>` where `ref` is the request's public Telegram request id (no token, secret,
user id, chat id or channel id; asserted by tests). On launch: `page.tsx` skips onboarding and routes existing creators to
Profile → Channel Management (new/no-channel users go to the bot connection page in `CreatorSetup`); `useChannelConnect`
resumes **from the server state** (token from storage if present, otherwise the `ref`, authenticated by the normal session/
signed-setup cookie or the silent `initData` sign-in) and verifies automatically — no "Check" button. No new request is created.
Success is shown only when the server says `connected`. The `?connect=` parameter is stripped once the request concludes.

## Error handling matrix

| Situation | Behaviour |
| --- | --- |
| never started the bot / blocked it | signed start link (first-time) — see above |
| bot can't send / Telegram 5xx/429/timeout | 502, rolled back to `prepared`, "Connect" retryable (reuses the prepared request) |
| invalid bot username / URL | `getMe` failure → 502 at Start or Connect; URL built from `getMe` only |
| webhook retry / duplicate update | `telegram_update_log` update_id dedupe; atomic claim; confirmation sent once (`confirmation_sent_at`) |
| invalid/expired/foreign request | 404/410, indistinguishable from unknown; bot replies with a non-leaking message |
| unsupported chat (group, public channel) | request `failed` with reason; bot explains what to fix; "Connect" retries |
| user not admin / bot not admin / bot can't post | `user_not_admin` / `bot_not_admin` / `bot_missing_permissions` messages |
| channel already connected elsewhere | `channel_already_connected` (previously mislabelled as a Telegram error) |
| user cancels the picker | Telegram sends nothing; Cancel button or expiry ends it (server `cancelled`/`expired`) |
| user returns before selecting | status `awaiting_channel_selection` → keeps waiting |
| user returns after expiry | `expired` message + "Connect" |
| multiple sessions | newest request wins; older ones become `cancelled` |
| network loss in the Mini App | quiet "retrying automatically", resumes; hard stop at expiry + 30 s |
| `openTelegramLink` fails | manual link, haptic warning, never `window.open`; the Mini App is NOT closed (nothing was opened) |

## Database migration (additive; already applied to Production — not part of this change)

`migrations/bot_guided_connect/up.sql` adds three **nullable** columns to `pending_channel_requests`
(`connect_started_at`, `picker_sent_at`, `confirmation_sent_at`); `down.sql` drops them. Equivalent to `npx drizzle-kit push`
on a dev database. **Apply it to the target database before deploying this code** (the ORM selects the columns explicitly).
Run it on Preview/staging first; production only with explicit approval. No data is rewritten.

## Manual setup required

1. Apply the migration above.
2. Set `MINI_APP_URL` (public https origin of the Mini App; or rely on `VERCEL_PROJECT_PRODUCTION_URL`). No BotFather "Main Mini App"
   is needed: the button is an inline `web_app` button, which Telegram allows in private chats with the bot.
3. `TELEGRAM_WEBHOOK_SECRET` **should** be set and the webhook registered with it (`scripts/configure-telegram-webhook.mjs`,
   `allowed_updates` ⊇ `message`, `my_chat_member`). Without it the webhook cannot prove updates come from Telegram; the
   route logs `telegram_webhook_unauthenticated` in production (behaviour unchanged so a live bot isn't broken).
4. The Mini App's own origin must be the one Telegram opens (the `web_app` URL host) so cookies/session apply.

## Real-device checklist (NOT performed by the automated tests)

On Telegram for Android (and ideally iOS/Desktop), against a Preview deployment + a **test** bot:
1. Connect: countdown starts at 10:00, ~3 s later the bot chat opens by itself AND the Mini App closes. Note: does the Mini App
   really close? Does the fallback link appear after ~4 s if it stays in front?
2. Returning user: message + "Select channel to connect" already in the chat, **no** new `/start`. First-time user (fresh
   account): the Start button appears, then the same message.
3. Pick a private channel → Telegram asks to add the bot as admin → confirmation message with the channel name appears once.
4. Tap "Return to Onfile": the Mini App reopens on the connection page, verifies without a button and shows the congratulations
   with the channel name. Repeat after >10 minutes to see the expired state.
5. Public channel / group / channel where the bot lacks "post messages" → explanatory bot message.
