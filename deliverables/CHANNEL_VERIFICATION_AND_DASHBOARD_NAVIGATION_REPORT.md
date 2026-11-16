# Channel Verification message + "Verify" button → Dashboard

Base: `Sakib05/OnfileTest2` @ `main` `9ce66b6` (cloned read-only). **Nothing was pushed, merged, deployed or migrated. No Production
environment variable, Telegram Bot setting / webhook, or Production data was touched.** All tests ran against the sandbox's local
throw-away Postgres. No secrets were requested or used.

## 1. Root cause of "opens Channel Management"

`src/app/page.tsx` handled every launch from the bot button (`/?connect=<ref>`) by calling `setProfileEntry("channel"); setActiveTab("profile")`
(and `CreatorSetup` / `ProfileTab` each had their own `getLaunchConnectRef()` shortcut). So the Mini App went to Profile → Channel Management
and only *there* resumed the connection check. That routing is gone.

## 2. What changed

**Bot message (server)** — `src/lib/botConnectFlow.ts`, `src/app/api/telegram/webhook/route.ts`
- `connectionSuccessMessage(title)` → static `CHANNEL_VERIFICATION_MESSAGE` / `channelVerificationMessage()` (exact approved copy, no argument).
  The channel title is **not** in the message (it would conflict with the approved copy; nothing client- or user-controlled can reach it).
- `buildReturnToOnfileKeyboard/Url` → `buildVerifyKeyboard/Url`; button text `"Verify"` (`VERIFY_BUTTON_TEXT`). URL unchanged: `<MINI_APP_URL>/?connect=<public ref>`.
- `notifyBotConnectionSuccess(telegramUserId, observedChatId, pending)` — the title parameter was removed. Everything else is untouched:
  atomic once-only `claimConfirmationDelivery`, chat location, https-only URL resolution, 400-on-keyboard text-only retry, never-silent error logs.
  Log names `bot_connect_return_button_*` → `bot_connect_verify_button_*` (only operational logs; search them if you alert on them).
- Welcome message, Channel Connection message, picker, ownership/admin checks, webhook secret / `update_id` dedupe, schema: **not touched**.

**Mini App (client)**
- `src/components/setup/ConnectionVerifyGate.tsx` (new) + `src/lib/verifyLaunch.ts` (new): the only screen for a `/?connect=<ref>` launch.
  Sign-in (silent initData, as before) → read-only `GET /api/channels/connect-status?ref=` → on `verified` only: `refreshDashboard()` → Dashboard.
  Otherwise: error + **Try Again** (re-checks the same ref) + secondary **Connect a channel**. Single-flight + once-only completion guards.
  While the webhook is mid-verification (`stage: verifying`) the same request is re-checked (2 s × 8).
- `src/contexts/AppContext.tsx`: new `refreshDashboard()` (re-reads `/api/user/me` + `/api/channels`, resolves `true` only for an authenticated user with a
  verified channel, bumps `dashboardVersion`) — existing `refreshUser/refreshChannels` behaviour unchanged.
- `src/app/page.tsx`: renders the gate for a launch ref; Dashboard `HomeTab` is keyed on `dashboardVersion` (remount ⇒ refetch). Removed the
  Profile/Channel-Management redirect.
- `src/components/CreatorSetup.tsx`, `src/components/tabs/ProfileTab.tsx`: removed their launch-ref shortcuts (now unreachable / wrong destination).
- `src/lib/useChannelConnect.ts`: +`clearPersistedConnectRequest()` (so a concluded request is not resumed later). The in-app Connect flow is unchanged.
- **Server routes unchanged:** `connect-status` already enforced ownership (`getRequestByRef(telegramUserId, ref)`, `ownerOk`, server-clock expiry) — it is reused as-is.

**Tests / docs**
- Updated: `botConnectFlow.test.ts`, `successMessage.e2e.test.ts`, `privateChat.e2e.test.ts`, `botFallback.e2e.test.ts`.
- New: `src/components/setup/ConnectionVerifyGate.test.tsx` (21), `src/lib/verifyLaunch.test.ts` (4), +16 tests in `successMessage.e2e.test.ts`.
- Docs: `docs/BOT_WELCOME_AND_CONFIRMATION.md`, `docs/BOT_GUIDED_CONNECT.md`, `docs/BOT_CHANNEL_FALLBACK.md`, `README.md`, `.env.example`, this report.

Changed files (vs `9ce66b6`): `.env.example`, `README.md`, `docs/BOT_CHANNEL_FALLBACK.md`, `docs/BOT_GUIDED_CONNECT.md`, `docs/BOT_WELCOME_AND_CONFIRMATION.md`,
`src/app/page.tsx`, `src/app/api/telegram/webhook/route.ts`, `src/app/api/telegram/webhook/{botFallback,privateChat,successMessage}.e2e.test.ts`,
`src/components/CreatorSetup.tsx`, `src/components/tabs/ProfileTab.tsx`, `src/contexts/AppContext.tsx`, `src/lib/botConnectFlow.ts`, `src/lib/botConnectFlow.test.ts`,
`src/lib/useChannelConnect.ts`; new: `src/components/setup/ConnectionVerifyGate.tsx`, `src/components/setup/ConnectionVerifyGate.test.tsx`,
`src/lib/verifyLaunch.ts`, `src/lib/verifyLaunch.test.ts`, `deliverables/CHANNEL_VERIFICATION_AND_DASHBOARD_NAVIGATION_REPORT.md`.
`package.json` is byte-identical to the repo's (no dependency change).

## 3. Exact Telegram `sendMessage` payload (as asserted by the e2e tests with `toEqual`)

`POST https://api.telegram.org/bot<token>/sendMessage`
```json
{
  "chat_id": "<verified private chat id>",
  "text": "🔐 Channel Verification\n\nYour channel connection is ready.\n\nTap the button below to verify your connection and continue to your Onfile dashboard.",
  "reply_markup": {
    "inline_keyboard": [[{ "text": "Verify", "web_app": { "url": "https://onfile-app.vercel.app/?connect=<public request ref>" } }]]
  }
}
```
No `parse_mode`. The origin comes from `MINI_APP_URL` (the example above is the value the existing docs recommend; the tests use it).

## 4. Mini App URL and navigation flow

URL: `<MINI_APP_URL>/?connect=<public request ref>` — https only, ref is the request's public Telegram request id; no token, secret, user/chat/channel id or title.

```
Bot "🔐 Channel Verification" + [Verify]  ──web_app──▶  Mini App  /?connect=<ref>
  page.tsx  → ConnectionVerifyGate (no onboarding, no Channel Management)
  1 identity: session / signed setup cookie / silent initData sign-in
  2 GET /api/channels/connect-status?ref=<ref>       read-only; ref must belong to THIS Telegram user,
                                                      not expired (server clock), channel verified + owned by same account
  3 verified ──▶ AppContext.refreshDashboard(): GET /api/user/me, GET /api/channels, dashboardVersion++
  4 ──▶ clear ?connect= + stored pending key ──▶ Home tab = DASHBOARD (HomeTab remounts, refetches analytics/notifications)
  any other answer (pending / expired / invalid / other user's / failed / 401 / network / no verified channel after refresh)
        ──▶ error screen: [Try Again] (same ref) · [Connect a channel]   — the Dashboard is never shown
```
It is never a new pending request: the gate performs only GETs (+ the existing silent `/api/auth/telegram` sign-in for a brand-new identity); asserted in tests.

## 5. Test results (sandbox Postgres; Telegram HTTP and `fetch` mocked)

| Check | Result |
|---|---|
| `next typegen` | pass |
| `tsc --noEmit` | pass (0 errors) |
| `npm run build` | pass |
| Full suite `npx vitest run` (run twice) | **56 files / 741 tests passed** both times (baseline before changes: 54 files / 700 tests, 1 failure — see below) |
| `build_and_start` (health check) | pass |

Requirement → test mapping
1. exact message — `successMessage.e2e` "POSTs exactly { chat_id, text, reply_markup… }", `privateChat.e2e`, `botFallback.e2e`, `botConnectFlow.test`
2. button text "Verify" — same tests (`toEqual` on the real `sendMessage` body; `Object.keys(button) == [text, web_app]`)
3. URL + public ref — "button URL is https, … carries ONLY the public request reference" (+ no token / user id / channel id / bot token in the body)
4. verified → Dashboard — `ConnectionVerifyGate.test` "existing creator…" and "brand-new creator…"
5. Channel Management not the destination — same tests assert `ProfileTab` was **never rendered** (`renders.profile === 0`)
6. data refreshed first — "Dashboard data is refreshed BEFORE the Dashboard is displayed" (call order: connect-status → user/me → channels → dashboard mount → analytics)
7. unverified / expired / invalid / unauthorized cannot reach Dashboard — UI: 6 parametrised cases + network + "no verified channel after refresh" + outside-Telegram; API: pending, expired (server clock, plus late selection sends nothing), invalid refs, 401, forged cookie, failed verification, ownership mismatch
8. another user's request — API: other Telegram user gets 404 `expired`, no channel/title disclosed
9. retry creates no pending request — API: 4 repeated status reads → same pending row, same `confirmationSentAt`, 1 channel, no extra Telegram call; UI: Try Again re-checks the same ref, zero `connect-bot-*`/`connect-request` calls, double-tap runs one check
10. redelivery — same `update_id` ×3, new `update_id`s + `my_chat_member` twin, and concurrent deliveries → exactly one `sendMessage`
The UI tests were mutation-checked (routing to Profile/Channel Management, or skipping `refreshDashboard`, makes them fail).

**Pre-existing vs new**
- Pre-existing, not introduced: in the very first baseline run `botFallback.e2e` "replies to a valid /start with the request_chat keyboard" failed once
  under full parallel load (shared-DB timing; it passed alone, and in both later full runs). The previous report documents the same flake.
  `npm run lint` reports pre-existing `react-hooks/set-state-in-effect` errors in untouched code (e.g. `WalletTab`, `useNotifications`, `ProfileTab`) with this
  sandbox's `eslint-config-next` 16.4.2; the files I added are lint-clean (a few "unused disable directive" warnings only in `page.tsx`).
- Newly introduced failures: none.

## 6. Known limitations — please read

- **Not tested on a real Telegram client / Android device.** Telegram's Web App launch, `initData` delivery and haptics are test doubles; jsdom proves Onfile's wiring only.
- Real Telegram `sendMessage` was never called (mocked). `web_app` buttons in private chats are Telegram-side behaviour I could not exercise.
- If `MINI_APP_URL` (or a safe alternative) is not set in Production the message is still sent **without** the button (existing behaviour); then "Tap the button below" would
  point at nothing. Set `MINI_APP_URL` before release.
- Old messages in users' chats ("Return to Onfile", same URL) will now also land on the Dashboard — intended.
- After a successful verification a user who taps an *old* Verify button within 24 h (retention window) is verified again idempotently and goes to the Dashboard; beyond retention it shows the expired error.
- A *pending* request that expired shows the error screen; "Connect a channel" then opens the normal connect flow (or Channel Management for an already-connected creator) by explicit choice.
- Environment note: this sandbox runs Next 16.4.2 / `eslint-config-next` 16.4.2 (platform template) instead of the repo's pinned 16.2.6; the ZIP ships the repo's original `package.json` (no lock file in the repo).
- Product choice to confirm: the verification message intentionally omits the channel title (copy approved as-is; the task allowed the title only if it did not conflict).

## 7. Production actions

None performed. Awaiting your explicit approval before any push, merge, deploy, env change, bot/webhook change or migration. No schema change is part of this work.
