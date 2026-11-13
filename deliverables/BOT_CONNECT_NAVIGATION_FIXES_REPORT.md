# Onfile — Bot connect flow, automatic chat opening, haptics & Back Button fixes

Repo `Sakib05/OnfileTest2`, base `main` @ `49eacfb`, work on local branch `feature/bot-connect-navigation-fixes`.
**Nothing was pushed, nothing was deployed, no production env var / bot token / webhook / Supabase / production DB was touched.**
All tests ran against a disposable local sandbox Postgres with a mocked Telegram Bot API (no real message was sent to any real user).

Root causes (written before the changes): `docs/BOT_CONNECT_ROOT_CAUSES.md`.
Design / behaviour reference: `docs/BOT_CHANNEL_FALLBACK.md`.

## Modified / new files

Modified
`README.md` · `docs/BOT_CHANNEL_FALLBACK.md` · `src/db/schema.ts` · `src/lib/botConnectFlow.ts` ·
`src/lib/pendingChannelRequests.ts` · `src/lib/telegramBot.ts` · `src/lib/telegramWebApp.ts` ·
`src/lib/useChannelConnect.ts` · `src/lib/useTelegramBackButton.ts` ·
`src/app/api/channels/connect-bot-request/route.ts` · `src/app/api/channels/connect-status/route.ts` ·
`src/app/api/telegram/webhook/route.ts` · `src/components/ChannelConnectFlow.tsx` ·
`src/components/setup/BotConnectInstructions.tsx` · `src/components/setup/BotFallbackPanel.tsx` ·
`src/components/setup/ChannelConnectSuccessScreen.tsx` · `src/components/setup/ManualConnectGuide.tsx` ·
`src/components/tabs/ProfileTab.tsx`
Modified tests: `src/lib/botConnectFlow.test.ts` · `src/lib/telegramWebApp.test.ts` ·
`src/components/setup/BotConnectInstructions.test.tsx` · `src/app/api/channels/connect-bot-request/route.test.ts` ·
`src/app/api/telegram/webhook/botFallback.e2e.test.ts`

New
`docs/BOT_CONNECT_ROOT_CAUSES.md` · `deliverables/BOT_CONNECT_NAVIGATION_FIXES_REPORT.md` ·
`migrations/bot_private_chats/{up,down}.sql` · `package-lock.json` (the repo had none) ·
`src/lib/botPrivateChats.ts` · `src/lib/telegramBackButton.ts` · `src/components/setup/ConnectSuccessNotice.tsx`
New tests: `src/lib/botPrivateChats.test.ts` · `src/lib/telegramBackButton.test.ts` ·
`src/lib/useTelegramBackButton.test.tsx` · `src/components/setup/ManualConnectGuide.test.tsx` ·
`src/app/api/channels/connect-bot-request/existingChat.test.ts` · `src/app/api/channels/connect-status/route.test.ts` ·
`src/app/api/telegram/webhook/privateChat.e2e.test.ts`

## 1. Root cause of the repeated "/start"
The backend always answered with `https://t.me/<bot>?start=<payload>`. For a bot the user has already
started, Telegram turns a `?start=` link into a new `/start <payload>` message from the user. The server never
sent anything itself and relied on that message to trigger the keyboard.

## 2. How the existing chat id is used
* New additive table `bot_private_chats` (user id → private chat id, `active|blocked`). Written **only** from
  secret-authenticated webhook updates (a human's `message` in a `private` chat; `my_chat_member` about our bot in a
  `private` chat) or from Telegram's own `getChat` answer for the *authenticated* user (backfill for users who started
  the bot before the table existed; accepted only if `type: "private"` + numeric id).
* `POST /api/channels/connect-bot-request` takes the user from the session/setup cookie (client ids are ignored),
  creates ONE pending request (earlier open bot requests are superseded), looks up *that user's* chat id and calls
  `sendMessage(chat_id = stored chat id)` with the `request_chat` keyboard ("Select channel to connect") bound to the new request.
* User id and chat id are never treated as interchangeable — the confirmation messages also use the stored chat id now.
* `sendMessage` is the authoritative "can the bot still message this chat" check: blocked ⇒ `blocked` + start link;
  "can't initiate conversation"/"chat not found" ⇒ association dropped + start link; transient errors ⇒ `502`, request
  cancelled, **no** silent start-link fallback.
* Migration is genuinely required (no existing table can hold the chat id). It is additive and **not applied to
  production**; without it the app degrades to the old signed-start flow.

## 3. Automatic bot chat opening
One tap on **Connect channel via bot**: prepare request → (server sends keyboard / prepares signed link) → subtle
haptic → `Telegram.WebApp.openTelegramLink(botUrl)` immediately. Returning users get the plain `https://t.me/<bot>`
link (username from `getMe`, never hardcoded). No `window.open`, double taps ignored (one request, one chat), and a
refusal by Telegram is shown in plain text (names the bot) instead of failing silently. Per the official Mini Apps docs
only `openLink` is documented as user-interaction-only; `openTelegramLink` is not, so calling it after the async request is supported.

## 4. Returning users do not receive another "/start"
Server-side: returning users receive `mode: "existing_chat"` with a link that has no `?start=` (asserted in
`existingChat.test.ts`, `BotConnectInstructions.test.tsx`). Whether a real Telegram client then shows a /start message
could only be confirmed on a device — see limitations.

## 5. First-time users
No verified private chat (Telegram answers "chat not found") ⇒ `mode: "start_link"` with the existing HMAC-signed,
user-bound, expiring `?start=` payload. Telegram's required first Start cannot be bypassed. After that Start the webhook
sends the keyboard **and records the chat**, so the next connect is the returning-user flow (tested end to end).
Missing association, blocked bot, invalid chat and transient Telegram errors are distinguished (`fallbackReason` / 502).

## 6. "Open bot chat again" and the explanatory cards
Removed (button, `reopenBot`, the "Connect through the Onfile Bot" card and the 3-step waiting card). One primary
action remains; failures/expiry show a message plus the same "Connect channel via bot" button. The waiting screen is a
small loader + "Waiting for channel selection...", "I've finished in the bot — check status", Cancel.

## 7. "Check status" fix
Root cause in `docs/BOT_CONNECT_ROOT_CAUSES.md` §4. Now: instant loading, one de-duplicated status request shared with the
poll timer, stale responses ignored, terminal outcomes applied exactly once, explicit pending / expired / failed / network /
server-error messages, and `connect-status` verifies the request belongs to the authenticated Telegram user.

## 8. Haptics
`triggerHaptic` (official `WebApp.HapticFeedback`, never throws): `impact(light)` after the request is prepared and
immediately before opening the chat; `success` only after the server returns `verified` (Direct Picker and bot fallback);
`error` for important failures; `warning` if Telegram refused to open the chat. A bot message cannot vibrate a device and
the moment it appears is not observable — the haptic is the Mini App's own.

## 9. Direct Picker success message
"🎉 Congratulations! Your channel is now connected to your Onfile account." + channel name (Channel Management, and the
onboarding success screen for all methods); shown only after server verification, once.

## 10. Telegram Native Back Button and the guide — audit result
Honest finding: in `main` only `PlaylistPage` used the native Back Button; the guide had none, its header arrow stepped back
one step, and each hook instance bound its own listener (duplicates possible; first unmount hid it for everyone).
Changes: shared manager `src/lib/telegramBackButton.ts` (one listener, stack, show/hide, cleanup); `useTelegramBackButton`
delegates to it (PlaylistPage semantics unchanged); registered on the guide, the Bot connect page and Profile sub-pages.

| Control | Behaviour |
| --- | --- |
| bottom Back | previous guide step (disabled on step 1 — it has no previous step and must not leave the guide) |
| bottom Next | next guide step |
| Telegram native Back (and the in-page header arrow, its non-Telegram equivalent) | exits the whole guide from any step |

Left alone because they are not application-level back navigation: Publish wizard step buttons, the Library "Back to Home"
chevron, guide illustrations, swipe-row keys. Close Button untouched. **Behaviour change to note:** the guide's header arrow
used to step back one step; it now exits the guide (like the native button).

## Test results (sandbox DB, mocked Telegram)
| Check | Baseline (`main`) | After |
| --- | --- | --- |
| `npx vitest run` | 39 files / 503 tests pass | **46 files / 588 tests pass** |
| `next typegen` | – | pass |
| `tsc --noEmit` | pass | pass |
| `npm run build` | – | pass |
| `eslint .` | 12 problems (11 errors, 1 warning) pre-existing | identical 12 — **no new problems** |
| `build_and_start` (`/api/health`) | – | pass |

Pre-existing failures: none in tests/tsc; the 12 ESLint findings (mostly `react-hooks/set-state-in-effect`, 2 in
`useChannelConnect.ts`) exist unchanged on `main`. Failures introduced by this work: none remaining (6 old tests that
asserted the removed behaviour — reopen button, old waiting card, `?start=` link, user-id chat_id — were rewritten).

Requirement → test map: (1–4) `existingChat.test.ts`, `privateChat.e2e.test.ts`; (5–6) `BotConnectInstructions.test.tsx`
+ `existingChat.test.ts`; (7–9) `existingChat.test.ts` (first-time, dynamic username from `getMe`), `privateChat.e2e.test.ts`;
(10) `existingChat.test.ts` (one live request), `BotConnectInstructions.test.tsx` (double tap); (11) same + absence checks;
(12–15) "Haptic feedback" block; (16–20) "check status" block + `connect-status/route.test.ts`; (21–29)
`ManualConnectGuide.test.tsx`, `telegramBackButton.test.ts`, `useTelegramBackButton.test.tsx`, existing `PlaylistPage.test.tsx`;
(30–35) pre-existing suites (Direct Picker, verification, private-only, ownership, playlists/library/files, themes) all still pass.

## Known limitations / not verified
* **No real Telegram client or live bot was used.** Real-device behaviour (that Telegram shows no `/start`, that
  `openTelegramLink` after an async call is accepted, haptics on iOS/Android/Desktop) is NOT verified.
* First-time (never started / blocked) users always need Telegram's own Start/Restart tap.
* Users who started the bot before the table existed rely on the `getChat` probe once; if Telegram can't confirm a chat they use the start link once.
* Apply `migrations/bot_private_chats/up.sql` (or `drizzle-kit push`) to Preview first; production is untouched.
* There are no browser E2E tests (jsdom component tests + DB-backed API/webhook tests only).
* If the guide is opened outside Telegram there is no native button — the in-page header arrow exits the guide.
