# Implementation report — playlist menu, auto-continue and exact Telegram post verification

Base: `https://github.com/Sakib05/OnfileTest2` (HEAD `6302563`), cloned in full into the workspace; all changes applied to that working copy. Nothing was pushed to GitHub, nothing was deployed, no production database/environment was touched (only the sandbox's local dev DB was used for tests). No DB migration, no new endpoint, no new dependency (`package.json` unchanged). Analytics was not reintroduced.

## Summary
1. **Playlist ⋮ menu** — removed "Copy public link". Share settings, Share dialog (Copy playlist link + Show QR code) and My Library single-file Share are untouched.
2. **Link step** — after submit the client calls the existing `/api/publish/verify-link`; on server-confirmed success it advances automatically (no "Connected Channel Verified" screen, no extra Continue). Errors are shown, the typed link is kept, retry is possible; loading indicator + duplicate-submit guard; network failure / timeout / non-JSON / unexpected 200 are never success.
3. **Critical bug** — `https://t.me/c/4447210820/152` was accepted because only the channel id was compared (`messageExistenceVerified` was hard-coded `false`). The server now confirms the **exact message id** with Telegram via `copyMessage` (to the creator's private bot chat, silent, then `deleteMessage`) — see `docs/TELEGRAM_POST_VERIFICATION.md` for the mechanism, fail-closed table and limitations. Nothing is posted in the channel.

## Modified / added files (vs. the original repository)
Modified:
- `README.md` (docs index)
- `src/components/playlists/PlaylistPage.tsx`, `PlaylistPage.test.tsx`
- `src/components/publish/LinkStep.tsx`, `PublishWizard.tsx`
- `src/lib/telegramBot.ts` (+ `checkChannelPostExists`, `classifyPostProbeError`), `telegramBot.test.ts`
- `src/lib/channelPostVerification.ts`, `channelPostVerification.test.ts`
- `src/lib/publishing/publishPost.ts`, `publishPost.test.ts`, `publishDeps.ts`, `publishDeps.test.ts`
- `src/app/api/publish/verify-link/route.ts`, `route.test.ts`
- `src/app/api/files/route.ts` (passes the session user's Telegram id into `publishPost`)
- `src/app/api/thumbnails/thumbnailsAndPlaylists.e2e.test.ts` (new `publishPost` signature; Telegram stubbed)

Added:
- `src/components/publish/LinkStep.test.tsx`
- `src/lib/telegramBot.live.test.ts` (REAL-Telegram test, opt-in)
- `docs/TELEGRAM_POST_VERIFICATION.md`, `deliverables/TELEGRAM_POST_VERIFICATION_REPORT.md`
- `package-lock.json` (the original repository did not contain a lockfile; generated with `npm install` from the unchanged `package.json`)

## Test results (sandbox, Node + Vitest, local dev Postgres)
* `npx next typegen` ✔, `tsc --noEmit` ✔ (0 errors), `npm run build` ✔, platform `build_and_start` ✔ (health check passed).
* Full Vitest suite: **1119 passed, 3 skipped (the opt-in live tests), 0 failed** in the final run.
* Two pre-existing tests unrelated to this work are timing/DB-state flaky and failed in some full-suite runs, passing on re-run and passing on the untouched original repository in another run: `sharedPlaylist.e2e` ("nothing private" asserts that the user's numeric DB id, e.g. `71`, does not occur anywhere in a response containing random tokens/timestamps) and a `pendingChannelRequests` expiry-timing assertion. They were not modified.

### Required regression matrix
| Case | Result | Kind of test |
|---|---|---|
| Playlist ⋮ menu has no Copy Link | pass | UI (jsdom) |
| Playlist Share still has Copy playlist link + Show QR code (+ QR modal) | pass | UI (jsdom) |
| Single-file Share / file menus unchanged | pass (existing `FilesTab.fileMenu` 30 tests untouched) | UI (jsdom) |
| Existing post #15 in 4447210820 → accept | pass | **simulated** Telegram (decision logic + Bot API handling) |
| Non-existent #152 same channel → reject, "Post not found…" | pass | **simulated** |
| Post from another channel → reject (Telegram not even asked) | pass | simulated |
| Invalid URL → reject | pass | pure + UI |
| Valid channel, inaccessible post → reject | pass | simulated (`bot_no_access`, `post_not_copyable`) |
| Telegram API timeout → error, never proceeds | pass | simulated (AbortError, 5xx, non-JSON, 429, thrown) |
| Bot permission failure → error, never proceeds | pass | simulated |
| Corrected link (#152 → #15) → accepted, proceeds automatically | pass | simulated |
| Valid link → auto-proceeds, no intermediate success screen | pass | UI with simulated server |
| Network failure / client timeout / 200 without existence flag → error, no proceed | pass | UI |
| Repeated submissions during verification prevented (button, Enter, repeated submit) | pass | UI |

### Simulated vs. real Telegram — honest statement
**No real Telegram request could be made in the delivery sandbox: there is no `TELEGRAM_BOT_TOKEN`, no real channel `4447210820` and no real post #15 / #152 available.** (`api.telegram.org` is reachable; a call with an invalid token returns `404 Not Found`.) Therefore the claims "post #15 exists / post #152 does not" are **not** proven against the real channel by this delivery. All tests above marked *simulated* use a fake Telegram that answers like Telegram's documented `copyMessage` responses; they prove request shape, decision logic and fail-closed behaviour, not real post existence.

To run the real check yourself (dev bot + dev channel, you must have pressed Start in the bot chat):
```
TELEGRAM_LIVE_TEST=1 TELEGRAM_BOT_TOKEN=… LIVE_TG_CHANNEL_ID=-1004447210820 LIVE_TG_USER_ID=<your telegram id> \
LIVE_TG_EXISTING_MSG_ID=15 LIVE_TG_MISSING_MSG_ID=152 npx vitest run src/lib/telegramBot.live.test.ts
```
Please also run the two links through the Publish screen on a real device before releasing.

## Limitations / behaviour to be aware of
* Verification needs the creator to have started the Onfile bot (otherwise a clear "open the Onfile bot chat and press Start" error is shown — never a silent accept).
* A silent copy briefly appears in the creator's private bot chat while verifying and is deleted immediately (never in the channel).
* Channels with "Restrict saving content" can't be copied by bots; such posts are rejected with an explanatory message.
* The existence check runs again at publish time (so `verify-link` can't be bypassed); a transient Telegram outage at that moment returns an error and the creator can retry.
* Delivery architecture was not changed. In this repository snapshot the public file page reveals the stored Telegram post link after the server-side unlock (`/api/link/[slug]`); the README describes bot forwarding as the target design. The copy-based probe matches the bot-forwarding design (which is why protected-content posts are refused), but note that a protected-content channel would still be viewable through a revealed link — if you want those accepted, `post_not_copyable` for `CHAT_FORWARDS_RESTRICTED` can be relaxed in `classifyPostProbeError`.
