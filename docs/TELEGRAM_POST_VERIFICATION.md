# Telegram post-link verification (exact message check) + playlist menu clean-up

No database migration. No new API endpoint. No change to bot permissions or to the file-delivery architecture.

## 1. Playlist ⋮ menu — duplicate "Copy Link" removed
`src/components/playlists/PlaylistPage.tsx`: the **Copy public link** item (and its now-unused `copyPlaylistLink` handler / imports) was removed from the Creator Playlist ⋮ menu.
The menu is now: Edit details · Make private/public · Monetization settings · **Share settings** · Duplicate playlist · Delete playlist.
Unchanged: the Share dialog (`ShareSheet`) still has **Share playlist · Copy playlist link · Show QR code**; My Library single-file Share (Copy Link / QR) and the other file menus are untouched.

## 2. Publish flow — no intermediate success screen
`src/components/publish/LinkStep.tsx`: after the creator submits a post link the client calls the existing `POST /api/publish/verify-link`.
* Success ⇒ **only** when the server answers 200 with `verified: true` **and** `messageExistenceVerified: true` — the wizard then moves to the next step automatically. The "Connected Channel Verified … Post #12" panel was removed.
* Failure (HTTP error, bad format, wrong channel, post not found, bot/permission problem, non-JSON body, network failure, 30 s client timeout) ⇒ visible red error; the typed link stays in the box; the creator can edit and retry.
* While verifying: spinner + "Verifying your post…", input and button disabled, and a synchronous `useRef` guard blocks double taps / repeated Enter.

## 3. CRITICAL FIX — the exact post must exist

### Root cause
`verifyPostLinkAgainstChannels` only compared the **channel id** in the link with the connected channel and hard-coded `messageExistenceVerified: false`
("Bot API has no read-only get-message call"). `/c/4447210820/152` therefore passed because channel `4447210820` matched.

### How existence is now verified
The Telegram Bot API has **no** "getMessage" method. The supported, documented way for a bot to learn whether a specific message exists is to try to **copy** it — the very primitive Onfile delivery relies on (the bot copies/forwards the original from the creator's channel):

`checkChannelPostExists` (`src/lib/telegramBot.ts`):
1. `copyMessage { chat_id: <creator's private chat with the bot>, from_chat_id: -100<connected channel>, message_id: <exact id from the URL>, disable_notification: true, protect_content: true }`
2. Telegram answers with a new `MessageId` ⇒ the exact message exists, is readable by the bot and is copyable ⇒ accepted. The transient copy is removed immediately with `deleteMessage` (best effort; failure only logs and never changes the verdict).
3. `message to copy not found` / `MESSAGE_ID_INVALID` ⇒ **post_not_found** ("Post not found. Please check the Telegram post link and try again.", HTTP 404).

**Nothing is ever posted in the channel.** The probe goes to the creator's own private chat with the bot, silently, and is deleted. Identical concurrent probes are de-duplicated into one request.

`chat_id` of the source is always the **connected channel row from the database** (`-100…`), never a value from the client; the destination is the **session user's** `telegram_id`. Channel-ownership/admin checks are unchanged and still run first (a link from another channel never reaches Telegram).

### Fail-closed result table
| Telegram / situation | reason | HTTP | proceeds? |
|---|---|---|---|
| copy returns a MessageId | ok | 200 | **yes** (auto) |
| message to copy not found / MESSAGE_ID_INVALID | `post_not_found` | 404 | no |
| message can't be copied / protected content / forwards restricted | `post_not_copyable` | 422 | no |
| bot not member / not enough rights / kicked / forbidden | `bot_no_access` | 403 | no |
| creator never pressed Start / blocked the bot / no Telegram id | `probe_chat_unavailable` | 409 | no |
| "chat not found" (ambiguous) | disambiguated with `getChat` on the private chat → `bot_no_access` or `probe_chat_unavailable` | 403/409 | no |
| timeout, network error, non-JSON, 5xx, 429, missing token, ok-without-MessageId, thrown error, any unrecognised answer | `post_verification_unavailable` | 503 | no |
| link from another channel | `channel_mismatch` (Telegram not asked) | 403 | no |
| malformed URL | existing parse errors (Telegram not asked) | 400 | no |

`confirmExistence` accepts **only** an explicit `{ ok: true }`; every other value (undefined, `{}`, `{ok:"true"}`, exceptions) is a rejection.

The same function runs again inside `POST /api/files` (publish), so skipping `verify-link` grants nothing, and a post deleted between steps is caught at publish time (the wizard then returns to the Link step).

### Known limitations (honest)
* The probe needs the creator to have an open private chat with the Onfile bot (pressed **Start**). Otherwise verification is refused with a clear "open the Onfile bot chat and press Start" error rather than guessing.
* The creator may see a message flash (silent) in their bot chat for a moment while the probe copy exists.
* Channels with **Restrict saving content** enabled cannot be copied by bots; such posts are refused (`post_not_copyable`) — they could not be delivered through copy/forward either (this repo snapshot currently reveals the stored link instead; relax `classifyPostProbeError` if you want those accepted).
* A post deleted *after* publishing is only detected at the next delivery / re-verification.
* Exact Telegram error strings come from Telegram's server and are not versioned; anything unrecognised is treated as "unavailable", never as success.

## Tests
* `src/lib/channelPostVerification.test.ts` — decision logic (**simulated** Telegram checker): #15 accepted, #152 rejected, other channel rejected without asking Telegram, invalid URL, inaccessible/permission/timeouts/odd answers rejected, public-style links, correct-then-accept.
* `src/lib/telegramBot.test.ts` — Bot API request/response handling with a **simulated** `fetch` (fake Telegram holding messages 1..15): exact request shape, never targets the channel, cleanup, every error mapping, single request for concurrent probes.
* `src/app/api/publish/verify-link/route.test.ts`, `src/lib/publishing/publishPost.test.ts` — route/service level (session-derived inputs only; never `verified` on failure).
* `src/components/publish/LinkStep.test.tsx` — UI: auto-advance without success screen, errors, kept link, retry, network/timeout, fail-closed 200, loading + duplicate-submit guard.
* `src/components/playlists/PlaylistPage.test.tsx` — ⋮ menu has no Copy Link; Share dialog still has Copy playlist link + Show QR code.
* `src/lib/telegramBot.live.test.ts` — **REAL Telegram** integration test, skipped unless `TELEGRAM_LIVE_TEST=1` plus a real bot token/channel/user id (see the file header). Not run in the delivery sandbox (no bot token available).
