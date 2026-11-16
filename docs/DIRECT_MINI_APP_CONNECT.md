# Direct Mini App channel picker (Telegram `requestChat`, Bot API 9.6+)

Two channel-connection flows exist side by side; the **client's real capability** decides which one runs.

| Client | Flow |
| --- | --- |
| `Telegram.WebApp.requestChat` exists **and** `Telegram.WebApp.isVersionAtLeast("9.6")` is `true` | **Direct** — native picker inside the Mini App (this document) |
| everything else | **Legacy** — Connect → bot chat → "Select channel to connect" reply keyboard → Verify (unchanged, `BOT_GUIDED_CONNECT.md`, `CHANNEL_VERIFY_FLOW.md`) |

Official references: Mini Apps `requestChat(req_id[, callback])` (Bot API 9.6+; the id must belong to a
`PreparedKeyboardButton` obtained with the Bot API method `savePreparedKeyboardButton`), and Bot API
`savePreparedKeyboardButton(user_id, button)` where `button` is a `request_chat` keyboard button.

## Choosing the flow (`useChannelConnect.connect`)

`isRequestChatSupported()` (`src/lib/telegramWebApp.ts`) is true only if `requestChat` is a function **and**
`isVersionAtLeast` exists and returns `true` for `"9.6"`. The OS / Telegram app version is never used. (The Telegram
script defines `requestChat` on every client, so presence alone proves nothing.) Safety net: if a client still throws
`WebAppMethodUnsupported` when the picker is opened, the picker never appeared, the unused request is dropped and the
**legacy** flow runs (remembered for the rest of the session). A cancelled picker or any other error never triggers the
legacy flow, so a user is never sent through both.

## Direct flow, step by step

1. **Connect** (existing button, existing design). While the request is prepared the button shows the existing disabled
   "Connecting…" state — a second tap is impossible (no button, plus a ref guard in the hook).
2. `POST /api/channels/connect-request` — same-origin + rate-limited; authenticates the Mini App user from the validated
   `initData` session/setup cookie (`resolveConnectingIdentity`); supersedes this user's earlier *unselected* direct
   requests (newest wins; legacy requests untouched); creates the pending request (**10-minute expiry**, direct
   `request_id` range `[1, 2^30)`); calls `savePreparedKeyboardButton` with `user_id` = the authenticated user and
   `buildRequestChatCriteria(request_id)` — channel only, `chat_has_username: false` (private), `bot_administrator_rights`
   and `user_administrator_rights` = `REQUIRED_BOT_ADMIN_RIGHTS` / `REQUIRED_USER_ADMIN_RIGHTS` (unchanged, not weakened).
   If Telegram refuses the button the request is cancelled again. Response: `{ token, preparedButtonId }` only. Nothing is
   sent to the bot chat.
3. `Telegram.WebApp.requestChat(preparedButtonId)` is called straight after the id was obtained. Status polling (read-only
   `GET /api/channels/connect-status?token=…`, every 1 s) starts at the same moment, so a fast verdict is never missed.
4. Telegram posts `chat_shared` to the webhook. `recordChannelSelection` atomically matches
   `(Telegram user id from the update, request_id)`, requires `pending` + unclaimed + unexpired, and stores the chat id.
   For a **direct** request the webhook then immediately runs `verifyPendingChannelRequest` (the one verification routine
   shared with the legacy Verify action): atomic claim → live Bot API checks (`getChat` is a channel, **private**; the
   user is creator/administrator; the Onfile bot is administrator with the required rights) →
   `finalizeVerifiedChannelConnection` (existing transaction) → request marked `verified`. A transient Telegram outage is
   retried up to 3 times (0.4 s / 0.8 s), then the request is failed with `telegram_api_error` ("try again"). Any failure
   notifies in-app only (never the bot chat).
5. The Mini App learns the verdict **only** from the status endpoint. Not success: picker closed, `requestChat` callback
   `true`, a selected channel, any client-side id. Callback `false` → `connect-cancel` with `onlyIfUnselected` (the server
   refuses to cancel a request that already carries a selection) → "Channel selection was cancelled…" + Connect again.
   If the picker finished but no selection reaches the server within 45 s the unselected request is abandoned with a clear
   message.
6. On `verified` the in-app **Congratulations** state (`DirectConnectSuccess`) is shown; after 2.5 s (or "Open Dashboard")
   the app opens the **Dashboard** (`setActiveTab("home")`, never Channel Management) and calls `refreshDashboard()`
   (re-reads user + channels and bumps `dashboardVersion`, which re-keys the Dashboard so it refetches).

## Security / reliability properties

* Telegram `initData` validation, ownership, private-only, administrator rights and the 10-minute expiry are unchanged.
* The client never supplies a channel id or a verdict. The channel id is the one in Telegram's `chat_shared`, bound to the
  request by `(user id, request_id)`; the prepared button itself is scoped to the user by `user_id`.
* Replay: redelivered updates are dropped by `telegram_update_log`; a new update for a resolved request matches nothing
  (`status = 'pending'` is part of the UPDATE); a failed request cannot be revived.
* Concurrency: `claimSelectedChannelForVerification` is a single atomic UPDATE — of N simultaneous deliveries exactly one
  verifies/connects. A last-resort guard (`failPendingRequestIfStillPending`) means a request can never stay "verifying".
* The legacy flow, `/start` fast path, Welcome Message, `scheduleBotNavigation`/`navigateToBotOnce`, the reply keyboard and
  the Verify button are untouched. Legacy `onConnected` keeps its exact one-argument call shape.

## Database

**No migration.** Everything reuses existing columns (`selected_chat_id`, `claimed_at`, `status`, `failure_reason`,
`expires_at`, …) and the existing request-id range encoding for the "direct" method. See `migrations/` for the earlier
additive migrations (unchanged).

## Tests

* `src/app/api/channels/connect-request/directConnect.e2e.test.ts` — real routes + Postgres, Telegram HTTP mocked.
* `src/components/setup/DirectConnect.test.tsx` — capability switch, picker states, Congratulations → Dashboard.
* Updated: `botFallback.e2e.test.ts`, `successMessage.e2e.test.ts` (direct requests used to stay "stored only"),
  `telegramWebApp.test.ts` (stricter detection).
