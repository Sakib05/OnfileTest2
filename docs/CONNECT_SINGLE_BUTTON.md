# Single "Connect" button + reliable hand-off to the bot (Start step removed)

Scope: client-side flow only. No schema change, no migration, no webhook/bot/env change. The three columns
`connect_started_at`, `picker_sent_at`, `confirmation_sent_at` are untouched and still required by the lifecycle.

Baseline inspected: `Sakib05/OnfileTest2`, branch `main` @ `3ae9618` ("update").

## 1. Why the automatic redirect "did nothing"

What the old code did (`useChannelConnect.connect`): after the backend answered, wait until 3 s after the tap, switch the UI to
*"Waiting for channel selection…"*, then call `Telegram.WebApp.openTelegramLink(botUrl)` and **never** `close()`.

* Since **Bot API 7.0** (Dec 2023) `openTelegramLink` explicitly *does not close the Mini App*. The old doc/comment even said
  `close()` was deliberately never called. On a client where the bot chat is opened *behind / beneath* the still-open Mini App
  sheet, the user sees the Mini App unchanged → "it never navigated". The fallback link behaved the same way: the chat opened but the
  Mini App stayed, because that handler also only called `openTelegramLink`.
* The call itself is also issued from a timer (no user gesture). `openTelegramLink` is not documented as gesture-restricted
  (unlike `openLink`), so this is not proven to be a cause — but see "limitations": it cannot be excluded on every client.
* Fragility that was fixed regardless: the 3 s `await sleep()` lived inside the component's async handler and was silently
  abandoned if the component unmounted (`if (!mounted.current) return`), and the automatic path and the link had **two separate**
  implementations.

> Root cause confirmed from code + Telegram's documented behaviour. It was **not** reproduced on a real Telegram client (none available here).

## 2. How the single Connect button works

`useChannelConnect().connect()` (used by onboarding `BotConnectInstructions` and Channel Management `ChannelConnectFlow`):

1. Guard: a synchronous `connecting` ref + phase check → double taps do nothing.
2. UI → `connecting` ("Connecting…", disabled; no countdown yet).
3. `POST /api/channels/connect-bot-request` — identity from the session/signed cookie, same-origin + rate limit, supersedes older open
   requests, returns `{token, ref}`. **Skipped** when a prepared request from a failed earlier attempt exists (its token is reused).
4. `POST /api/channels/connect-bot-start` `{token}` — ownership check, atomically starts the backend 10-minute window
   (`expires_at`, never extended by retries), delivers the picker to returning users (once) or returns the signed `?start=` link
   to first-time users.
5. Success → UI shows the countdown (server clock) and *"Waiting for channel selection…"*; the request is persisted for resume.
6. `scheduleBotNavigation(token, botUrl, 3000)` — one module-level timer per request (idempotent).
7. After ~3 s: haptic → `navigateToBot(botUrl)`:
   `Telegram.WebApp.openTelegramLink(botUrl)` **then** `Telegram.WebApp.close()`.

Failure handling: preparation fails → message + "Connect" (nothing started). Start fails transiently (502/network) → the server rolled
back to `prepared`; the UI keeps the token and shows the error + "Connect" (retry reuses the request: still exactly one pending
request). 401/404/409/410 → terminal message + "Connect" (new request).

The fallback link *"Didn't switch to Telegram? Tap here to open @bot"* calls the same `navigateToBot`. Repeats inside 1.5 s are ignored
(`duplicate`), so neither double taps nor "automatic + immediate tap" navigate twice; the link never touches the backend.

If `openTelegramLink` is unavailable/throws, `navigateToBot` returns `unavailable`, the Mini App is **not** closed (nothing was
opened — closing would strand the user) and the manual link + message are shown. A missing `close()` is tolerated: the chat still
opens and the link appears after 4 s if the Mini App is still visible. `window.close()` is never used.

Unmount behaviour: the timer is module-level, so unmounting the screen does not cancel a hand-off the backend already prepared.
Only the **Cancel** button (which also calls `connect-cancel`) or a terminal status (verified/failed/expired) cancels it.

Resume ("Return to Onfile" → `/?connect=<ref>`, or a reopened Mini App): unchanged — the screen is rebuilt from the server state and
verifies automatically; no new request. A resumed waiting screen shows the fallback link at once (it is visible and not navigating).
A stored `prepared` request resumes at the **Connect** button and Connect reuses it.

## 3. Removed / kept

Removed: the Start button, the `start()` handler, the `preparing` phase, the client "countdown before the backend answered",
`sleep()`, `onStart` props. Kept: server lifecycle state `prepared` (internal hand-over between the two backend calls and the
rollback target), all three DB columns, both endpoints, webhook, picker, confirmation + Return to Onfile.

## 4. Limitations (honest)

* `close()` closes the Mini App; there is **no documented minimise** API. State is restored through the persisted request and the
  "Return to Onfile" button.
* Whether a given Android/iOS/Desktop client opens the chat when `openTelegramLink` is called from a timer (no gesture) cannot be
  guaranteed from the web side. Fallback: the link (a real tap) uses the same routine.
* Closing right after opening relies on Telegram processing bridge events in order. Not verified on a real device.
* For first-time users the Mini App closes before Telegram's own **Start** button is pressed; the signed `/start` payload then
  delivers the picker and the user later returns via "Return to Onfile" (or by reopening the Mini App, which resumes).

## 5. Verification performed here

jsdom + fake-timer tests with a Telegram bridge test double (`BotGuidedConnect.test.tsx`, `botNavigation.test.ts`), the existing
backend/webhook e2e tests against a local Postgres, `tsc`, ESLint and `next build`. **Not** tested on real Telegram clients.
