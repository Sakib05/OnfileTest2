# Success message + "Return to Onfile" button — corrected investigation

Base: `Sakib05/OnfileTest2` @ `main` `e7bda3c`. Nothing was pushed, merged, deployed, or migrated. No Production env var,
Telegram Bot setting, or Production data was touched. All tests ran against a throw-away local Postgres.

## 1. What the code actually did (traced, then reproduced)

```
Telegram picker result
 ├─ message.chat_shared ─────────┐
 └─ my_chat_member (bot promoted)┤      POST /api/telegram/webhook   (secret header → update_id dedupe)
                                 ▼
   handleChatShared / handleMyChatMember → resolvePendingAgainstChat
     → bot-request window + expiry check → claimPendingRequestForProcessing (atomic, single winner)
     → verifyChannelOwnershipAndBotAccess (live getChat / getChatMember: channel, private, user admin, bot admin+post)
     → finalizeVerifiedChannelConnection (channels row)  → pending.status = "verified"
     → notifyIfBotMethod → notifyBotConnectionSuccess → sendMessage { text, reply_markup.inline_keyboard[web_app] }
   Mini App launched by the button: /?connect=<ref> → useChannelConnect → GET /api/channels/connect-status?ref=
```

**The previous report was only half right.** With `MINI_APP_URL` set and the user's private chat on file, the unmodified code
*does* send the exact message and the web_app button (new e2e test, passes on the old code). I could not reproduce
"always missing" from code alone, and I have **no access to Production logs or a real Telegram client**, so I cannot say which of
the following actually hit Production. These are the defects I *reproduced* (7 new tests failed on the old code) where the
message and/or the button are lost, in the exact order of the path above:

| # | Where | Defect (reproduced) | Effect |
|---|-------|---------------------|--------|
| 1 | `notifyBotConnectionSuccess` ← `handleMyChatMember` | The picker promotes the bot to admin, so Telegram sends `my_chat_member` (no chat id in it) and it can win the race against `chat_shared`. The only chat source was the `bot_private_chats` table; if no row existed (or the table is not migrated) the function did `console.log("…notify_skipped")` and returned — **after** the confirmation had been atomically consumed and the request marked `verified`. `chat_shared` then finds the request already resolved. | **Message AND button silently never sent** |
| 2 | `getMiniAppBaseUrl` | No `MINI_APP_URL` → fell through `NEXT_PUBLIC_APP_URL` → `VERCEL_PROJECT_PRODUCTION_URL` → **`VERCEL_URL`** (per-deployment hostname, usually behind Deployment Protection). If none resolves the button is dropped. | Button missing (message sent with `remove_keyboard`), or a button pointing at a wrong/protected host |
| 3 | `notifyBotConnectionSuccess` | If Telegram answered 400 to the keyboard (e.g. `BUTTON_URL_INVALID`) the **entire** message was lost; only a generic `telegram_api_error` was logged. | Message lost |
| 4 | log line | Missing-URL log said `no_https_mini_app_url` without naming the variable. | Misconfig hard to diagnose |

Not a cause, but relevant: legacy Direct Picker requests (`request_id < 2^30`, `/api/channels/connect-request`) never get an
in-chat message by design. No UI code calls that route any more (the Connect button uses `connect-bot-request`), so it is
unchanged and now logs `telegram_webhook_in_chat_notification_skipped`.

**Most likely Production cause given what you told me:** `MINI_APP_URL` is unset → (2) applies, and (1)/(3) apply whenever the
race or Telegram rejection happens. I cannot confirm which, without Production logs. Search them for:
`bot_connect_return_button_unavailable`, `bot_connect_notify_skipped`, `telegram_webhook_verifying_channel`, `telegram_api_error`.

## 2. Files changed

- `src/lib/botConnectFlow.ts` — `resolveMiniAppBaseUrl` (+ `getMiniAppBaseUrl` wrapper), `locateNotifyChatId` (stored → update chat →
  Telegram `getChat(user)`), rewritten `notifyBotConnectionSuccess` (returns a result; chat located before the confirmation is claimed;
  never-silent error logs; 400-on-keyboard → text-only retry).
- `src/app/api/telegram/webhook/route.ts` — wrappers accept any result; `telegram_webhook_success_notification` log; direct-request skip log.
- `src/app/api/telegram/webhook/successMessage.e2e.test.ts` — **new** (12 tests, real route + real Postgres, only Telegram's HTTP mocked).
- `src/lib/botConnectFlow.test.ts` — env-resolution tests (VERCEL_URL no longer accepted; production-only system var).
- `src/app/api/telegram/webhook/botFallback.e2e.test.ts` — clears `VERCEL_ENV` in the no-URL test.
- `.env.example`, `docs/BOT_WELCOME_AND_CONFIRMATION.md`, `docs/BOT_GUIDED_CONNECT.md` — configuration docs.
- `deliverables/SUCCESS_MESSAGE_AND_RETURN_BUTTON_REPORT.md` — this file.

## 3. Telegram API payload (`POST https://api.telegram.org/bot<token>/sendMessage`)

```json
{
  "chat_id": "<verified private chat id>",
  "text": "✅ <title from live getChat> is now connected to your Onfile account.\n\nYour channel is ready!\n\nReturn to Onfile to automatically refresh and view your connection status.",
  "reply_markup": {
    "inline_keyboard": [[{ "text": "Return to Onfile", "web_app": { "url": "https://onfile-app.vercel.app/?connect=<public request ref>" } }]]
  }
}
```
No `parse_mode` (the title is user-controlled). The URL carries only the public ref (no token, secret, user/chat/channel id).
Without a usable https URL: `reply_markup` is `{"remove_keyboard": true}` (no button) and `bot_connect_return_button_unavailable`
is logged with `requiredEnv: "MINI_APP_URL"`. No plain URL button is ever substituted.

## 4. Tests that prove it (`successMessage.e2e.test.ts`)

Exact `toEqual` on the whole `sendMessage` body (text, verified title ≠ title in the update, `inline_keyboard`, `web_app.url`, button
text, chat id ≠ user id); sent only after `getChat` + two `getChatMember` calls; once only on redelivery; `my_chat_member`-first with and
without a stored chat; chat-not-locatable logs and doesn't consume the confirmation; missing/http/alternative/`VERCEL_URL` URL handling;
Telegram rejecting the keyboard; Telegram failing the message; Return path `web_app.url` → `connect-status?ref=` → `verified` + channel
name, no new `pending_channel_requests` row, other users get 404; direct-picker requests stay silent.

## 5. MINI_APP_URL

The code does **not strictly require** it, but only safely supports: `NEXT_PUBLIC_APP_URL`, and `VERCEL_PROJECT_PRODUCTION_URL` on
`VERCEL_ENV=production` deployments (depends on Vercel exposing system variables; may be a different alias than the one registered
with Telegram). `VERCEL_URL` was removed. **Set `MINI_APP_URL=https://onfile-app.vercel.app` in Production** (then redeploy).

## 6. Not verified

Not tested on a real Telegram client; the Mini App launch from the inline button (`initData` delivery) is covered only by the existing
jsdom/route tests. Pre-existing: a first full-suite run once failed `botFallback.e2e` (shared-DB timing); 3 further full runs passed.
