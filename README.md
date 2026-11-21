# Onfile — Telegram Mini App

Next.js 16 (App Router) · React 19 · Tailwind 4 · Drizzle ORM / PostgreSQL · DBByte thumbnail storage.

## Setup
```bash
npm install
cp .env.example .env          # fill in DATABASE_URL etc. (never commit .env)
npx drizzle-kit push          # applies src/db/schema.ts (incl. bot_private_chats and the bot-guided columns; SQL equivalents: migrations/playlist_share/up.sql (playlist share token), migrations/bot_private_chats/up.sql, migrations/bot_guided_connect/up.sql, migrations/chat_shared_verify/up.sql) to the database in DATABASE_URL (use a DEV database)
npm run dev                   # http://localhost:3000
```
Scripts: `npm run build`, `npx vitest run` (Vitest), `npm run typecheck`, `npm run lint`.
Some tests (`*.e2e.test.ts`, `pendingChannelRequests`, `botChannelEvents`, `botFallback.e2e`, `connect-bot-request`, `botConnectFlow`, thumbnails integration, `publishDeps`) need a
Postgres database that has the schema applied; point `DATABASE_URL` at a disposable DEV database, never Production.

## Docs
See `docs/` — notably `TELEGRAM_POST_VERIFICATION.md` (**newest**: the publish flow now confirms the EXACT Telegram message id exists before continuing and auto-advances without a success screen; duplicate Copy Link removed from the Creator Playlist ⋮ menu; no migration), `LIBRARY_MENU_PLAYLIST_QR_AND_LOADING.md` (**newest**: simplified My Library file ⋮ menu — Edit Details now includes the thumbnail, Copy Link / QR only inside Share; QR code in the Creator Playlist Share dialog; compact My Library skeleton + error/Retry state; no migration), `LIBRARY_FILE_MENU_AND_PLAYLIST_UI.md` (**newest**: My Library file ⋮ menu — Edit Details / Change Thumbnail / Manage Playlists / Share / Copy Link / QR / File Details / Delete, icon-only type badges, Creator Playlist page clean-up; no migration), `CREATOR_PLAYLIST_MANAGEMENT.md` (**newest**: the Creator playlist management page — Add Files / Preview / Share / More, per-file menu, honest analytics; no migration),  `UNIFIED_PLAYLIST_FILE_VIEWER.md` (**newest**: one same-page viewer for `/p/<token>` and `/f/<slug>` — selected file on top, playlist list below, Get File / Save / Share / Report row, device-local Saved Items, public report endpoint; migration `migrations/report_targets`), `DIRECT_MINI_APP_CONNECT.md` (**newest**: Telegram 9.6+ clients connect a channel with the native `requestChat` picker inside the Mini App; the backend verifies and the Mini App shows Congratulations → Dashboard; older clients keep the bot-chat flow), `CHANNEL_VERIFY_FLOW.md` (**latest**: channel selected → immediate Verify message → verification + connection performed only by the Mini App's Verify action),  `BOT_WELCOME_AND_CONFIRMATION.md` (creator-focused bot welcome, why the native picker stays a reply keyboard, Channel Verification message + Verify button → Dashboard), `BOT_GUIDED_CONNECT.md` (channel connection (see `CHANNEL_VERIFY_FLOW.md` for the verification step): single Connect button → bot chat with native picker → Return to Onfile, lifecycle, migration, manual setup, real-device checklist), `CONNECT_SINGLE_BUTTON.md` (removal of the Start step + the open-then-close navigation fix),  `BOT_CHANNEL_FALLBACK.md` (Direct Picker + "Connect channel via bot" fallback for older Telegram clients),  `BOT_CONNECT_ROOT_CAUSES.md` (root-cause analysis of the returning-user / navigation fixes), `PLAYLIST_SHARING_AND_VIEWER.md` (**newest**: modern playlist page, ⋮ menu, public share links `/p/<token>`, sequential viewing; migration `migrations/playlist_share`), `LIBRARY_AND_PLAYLIST_UX.md`, `LIBRARY_AND_DOWNLOAD_REDESIGN.md`,
`PLAYLISTS_AND_FILE_VISUALS.md`, `THUMBNAILS_AND_PLAYLISTS.md`, `DBBYTE_THUMBNAILS.md`.

## Architecture note
Creators upload originals to their own private Telegram channel (the Onfile bot is an admin there); the bot forwards the
original to the end user. Onfile never downloads or stores original files on its own servers.
