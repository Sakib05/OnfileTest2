# Bot connect flow — root-cause analysis (written BEFORE the changes)

Repository: `Sakib05/OnfileTest2`, branch `main` @ `49eacfb`; work done on `feature/bot-connect-navigation-fixes` (local branch only, never pushed).

## 1. Why a returning user got another "/start"

`POST /api/channels/connect-bot-request` always returned
`https://t.me/<bot>?start=<signed payload>` and the Mini App always opened it.
Telegram's behaviour for a `?start=` deep link on a bot the user has **already started** is to
post `/start <payload>` into the chat *from the user's side* — so a returning user sees a brand-new
"/start" message every time. The backend never sent anything itself; it relied entirely on that
user-originated message to trigger the keyboard (`handleBotTextMessage` in `src/lib/botConnectFlow.ts`).
A plain `/start` (no/invalid payload, e.g. pressing Start again) additionally produced the
instructional `BOT_MESSAGES.welcome` text.

## 2. Why the existing private chat id was never used

* No table stored the verified private chat id. The webhook read `message.chat.id` only to answer
  that single message and then discarded it.
* The outcome notifications (`notifyBotConnectionSuccess/Failure/Expired`) passed the **Telegram
  user id** as `chat_id`, i.e. they silently assumed user id == chat id.
* `connect-bot-request` never called `sendMessage` at all.

## 3. Why automatic chat opening was unreliable / needed a second button

* `useChannelConnect.startViaBot` called `openTelegramBotLink()` and ignored its result.
* `openTelegramBotLink` fell back to `window.open(url, "_blank")` — not a supported way to open a
  `t.me` link from a Mini App — and still returned `true`, so a refused open failed silently.
* Because opening could fail silently, the UI carried an "Open bot chat again" button (which also
  re-sent the `?start=` link, i.e. another "/start").
* No haptic feedback existed anywhere in the connect flow.

Per the official Mini Apps docs, `openLink` "can be called only in response to user interaction";
`openTelegramLink` carries no such documented restriction, so calling it after the async request
(rather than synchronously in the click handler) is supported. Failures are still surfaced.

## 4. Why "I've finished in the bot — check status" appeared dead

`refresh()` in `useChannelConnect.ts`:
* re-read the token from `localStorage/sessionStorage` (silent no-op if storage is unavailable or
  the persisted deadline had passed) instead of using the in-memory active token;
* called `pollOnce` and discarded the outcome: **no loading state, no "still pending" message, no
  error message** — a pending answer changed nothing on screen, network/HTTP errors were swallowed
  (a non-JSON 500 became `{}` and was ignored);
* was not de-duplicated against the 2.5 s interval poll, and a late response from an old request
  could overwrite state;
* `GET /api/channels/connect-status` authorised by the bearer token alone — it never checked that
  the caller is the Telegram user the request was created for.

## 5. Native Back Button / guide navigation (audit)

* `useTelegramBackButton` exists but was used **only** by `PlaylistPage`. Each hook instance
  registered its own `onClick` and called `hide()` on cleanup, so two simultaneously mounted users
  of the hook would both fire (duplicate handlers) and the first to unmount would hide the button
  for the other.
* `ManualConnectGuide` ("View step-by-step guide") had **no** native Back Button wiring. Its
  header arrow *and* bottom Back both stepped back one step (and left the guide only from step 1),
  so there was no control that exits the whole guide in one action inside Telegram.
* `BotConnectInstructions` and the `ProfileTab` sub-pages (referrals, advertise, channel,
  settings, FAQ) only had in-page arrows.
* Local controls that are **not** application-level back navigation and are left untouched:
  Publish wizard step Back buttons (step controls), `FilesTab` "Back to Home" chevron (collapses an
  expanded list), `GuideIllustrations` arrows (decorative screenshots), `SwipeableRow` keys.
