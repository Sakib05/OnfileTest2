# Onfile — Telegram Mini App

Next.js 16 (App Router) · React 19 · Tailwind 4 · Drizzle ORM / PostgreSQL · DBByte thumbnail storage.

## Setup
```bash
npm install
cp .env.example .env          # fill in DATABASE_URL etc. (never commit .env)
npx drizzle-kit push          # applies src/db/schema.ts to the database in DATABASE_URL (use a DEV database)
npm run dev                   # http://localhost:3000
```
Scripts: `npm run build`, `npx vitest run` (Vitest), `npm run typecheck`, `npm run lint`.
Some tests (`*.e2e.test.ts`, `pendingChannelRequests`, `botChannelEvents`, thumbnails integration, `publishDeps`) need a
Postgres database that has the schema applied; point `DATABASE_URL` at a disposable DEV database, never Production.

## Docs
See `docs/` — notably `LIBRARY_AND_PLAYLIST_UX.md` (latest iteration), `LIBRARY_AND_DOWNLOAD_REDESIGN.md`,
`PLAYLISTS_AND_FILE_VISUALS.md`, `THUMBNAILS_AND_PLAYLISTS.md`, `DBBYTE_THUMBNAILS.md`.

## Architecture note
Creators upload originals to their own private Telegram channel (the Onfile bot is an admin there); the bot forwards the
original to the end user. Onfile never downloads or stores original files on its own servers.
