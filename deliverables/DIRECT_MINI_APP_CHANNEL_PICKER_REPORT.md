# Direct Mini App Channel Picker — implementation report

Scope: ONLY the channel-connection flow. Nothing was deployed, pushed or changed in Production.
Base: https://github.com/Sakib05/OnfileTest2 (HEAD `2f01f63`). Full design: `docs/DIRECT_MINI_APP_CONNECT.md`.

## 1. How new and old Telegram clients are distinguished
`isRequestChatSupported()` (`src/lib/telegramWebApp.ts`): `Telegram.WebApp.requestChat` must be a function AND
`Telegram.WebApp.isVersionAtLeast` must exist and return `true` for `"9.6"`. OS / app version is never consulted
(the Telegram script defines `requestChat` on every client, so presence alone proves nothing). Runtime safety net: a
`WebAppMethodUnsupported` throw (picker never opened) drops the unused request and runs the legacy flow instead.

## 2. New-client flow
Connect → `POST /api/channels/connect-request` (initData-authenticated, supersedes earlier unselected direct requests,
10-min pending request, `savePreparedKeyboardButton` with the existing `buildRequestChatCriteria` — private channels
only, user + bot admin rights) → `Telegram.WebApp.requestChat(preparedButtonId)` → Telegram sends `chat_shared` → webhook
stores the selection and the BACKEND verifies (shared `verifyPendingChannelRequest`: atomic claim, live Bot API checks,
existing finalize transaction) → Mini App reads the verdict from `GET /api/channels/connect-status` → in-app
"🎉 Congratulations!" → automatic Dashboard + data refresh. The bot chat is never opened or messaged.

## 3. Old-client flow
Preserved: the legacy code path is the original `connect` body (renamed `connectViaBot`, otherwise byte-identical), the
legacy `onConnected(channel)` call shape is unchanged, and no legacy route, bot message, reply keyboard, Verify button,
`navigateToBotOnce`/`scheduleBotNavigation` or `/start` code was modified. All pre-existing legacy tests pass untouched.

## 4. Changed files
| File | Why |
| --- | --- |
| `src/lib/telegramWebApp.ts` | Stricter detection: `isVersionAtLeast("9.6")` mandatory |
| `src/lib/useChannelConnect.ts` | Direct flow (`connectDirect`), capability switch in `connect`, legacy body kept as `connectViaBot` |
| `src/lib/pendingChannelRequests.ts` | `cancelOpenDirectRequestsForUser`, `failPendingRequestIfStillPending`, `cancelPendingByToken({onlyIfUnselected})` |
| `src/app/api/channels/connect-request/route.ts` | Supersede stale direct requests; cancel request if prepared button fails |
| `src/app/api/channels/connect-cancel/route.ts` | Optional conservative `onlyIfUnselected` |
| `src/app/api/telegram/webhook/route.ts` | Direct `chat_shared` → backend auto-verification (retry, safety net); legacy branch untouched |
| `src/components/setup/BotFallbackPanel.tsx` | Loading/waiting states for the direct phase (existing button + existing copy) |
| `src/components/setup/DirectConnectSuccess.tsx` (new) | In-app Congratulations + auto-navigation |
| `src/components/CreatorSetup.tsx`, `src/components/ChannelConnectFlow.tsx` | Show Congratulations, then Dashboard (`home`) + `refreshDashboard()` |
| `src/components/setup/BotConnectInstructions.tsx` | Type only: `onSuccess(channel, meta?)` |
| tests (3 updated, 2 new), `docs/DIRECT_MINI_APP_CONNECT.md`, `README.md`, this report, `package-lock.json` | Coverage, docs, lockfile (the repo had none) |

`package.json`, schema, env, webhook configuration, `/start`, auth/registration, dashboard design: unchanged.

## 5. Tests (real Postgres, Telegram HTTP mocked)
`npx vitest run`: **60 files / 846 tests pass** (baseline 58 / 800; +46 new). Mapping to the requested scenarios:
1 picker opens directly, 2 never opens bot chat, 12/13 Congratulations + Dashboard → `DirectConnect.test.tsx`;
3/4/5/6/7 (private ok, `chat_shared` validated, bot rights, user rights, public channel), 9 repeated taps, 10 expiry,
11 forged/foreign request, replay + concurrency → `directConnect.e2e.test.ts`; 8 cancel → both files;
14/15 legacy untouched → `DirectConnect.test.tsx` (9.5 / no-isVersionAtLeast / no-requestChat clients) + all pre-existing
legacy suites; 16 `/start` fast path → `startFastPath.e2e.test.ts` unchanged and green.
Three pre-existing assertions that "direct requests only store the selection" were deliberately updated: that behaviour
is exactly what this task changes. Not testable here: a real Telegram 9.6+ client (jsdom uses a bridge double) — needs a
manual device check before Production.

## 6. TypeScript / build
`npx next typegen` ✓ · `tsc --noEmit` ✓ (0 errors) · `npm run build` ✓ · `build_and_start` ✓ (health OK).
`eslint src` reports the same 17 pre-existing problems as the untouched repo (none in changed files).

## 7. SQL migration
**None required** — reuses existing columns and the existing request-id range encoding. Nothing to review or apply.

## 8. Operational notes for Production (not done)
Webhook must already deliver `message` updates (it does for the legacy flow). The direct flow makes the webhook do the
Bot API verification inline (≈3 calls, ≤ ~2 s; up to 3 attempts on a Telegram outage).
