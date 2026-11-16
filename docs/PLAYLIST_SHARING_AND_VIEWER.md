# Playlist page, ⋮ menu, sharing & sequential viewing

## Owner page (`/playlists/[id]`, `PlaylistPage.tsx`)
* No "Playlist" label anywhere; the title is the `<h1>`. Header = derived cover (first ordered file's thumbnail — no new storage),
  title, description, file count, total size (only when real sizes exist), Public/Private chip, Password / Stars chips.
* Actions: **Play first** (only when at least one file is published) · **Share** (always visible) · **⋮ menu**
  (Edit playlist, Share playlist, Copy playlist link, Delete playlist — red, separated). `ActionMenu` follows the WAI-ARIA menu-button
  pattern (arrows/Home/End/Escape/Tab, outside-tap closes, flips up / right-anchored / width-capped on small screens).
* The old visible *Edit* button and the bottom full-width *Delete playlist* button are gone. Delete still goes through the
  existing `DeleteConfirmModal` and the same `DELETE /api/playlists/:id` (files are never deleted).
* Rows: drag handle · position · 16:9 thumbnail · title · type · size · status chips (Cover, Not published, password, Stars) · transfer button.
  Tap = open the file. Swipe-to-remove, drag reorder (persisted, optimistic with rollback), add/move to another playlist are unchanged.
* No duration is ever shown: the schema has no duration metadata.

## Sharing model
| Case | Behaviour |
|---|---|
| Never shared | no public page exists; first Share creates `playlists.share_slug` (96-bit random, URL-safe) |
| Published (`is_published = true`, the default) | `/p/<token>` works for anyone |
| Private (`is_published = false`) | `POST …/share` → 409 `private`; the dialog offers **Make public & share** (existing `PATCH isPublished`). A public playlist can be made private again from the dialog → link answers 404 immediately and resumes (same token) if re-published |
| Password-protected | link works; recipients see title/description only until they enter the password. `POST /api/p/<token>` verifies it (scrypt, rate limited, same-origin) and sets an HttpOnly cookie = HMAC keyed by the stored hash (changing the password revokes it). The owner previews without typing it |
| Stars price > 0 | cannot be shared (409 `paid_unavailable`) and stays locked even if priced after sharing — the codebase has no Stars payment backend (`src/lib/publishing/payments.ts`) |

The numeric id is never a public handle: unknown token, numeric id, malformed value and private playlist all return the same 404.

### What the public API returns (`GET /api/p/<token>`)
Title, description, derived cover, item count, creator display name/@username/photo, and per item: position, **file smart-link slug**, title,
type, mime, size, thumbnail, hasPassword, starsPrice. **Only published files with a smart link are listed** (also for count and cover).
Never: user/file/playlist ids, password hashes, Telegram message links / file ids / channels.

## Sequential viewing
Files are delivered through Telegram, so there is no in-app media player (and none is faked). Each item opens the **existing** file page
`/f/<slug>?list=<token>&i=<n>`, which keeps enforcing that file's own password/price. With `?list=`, `PlaylistNavBar` shows
**"3 of 12", Previous, Next, Back to playlist**. It reads the public playlist API, finds the file by slug (the `i` value is never trusted), and
renders nothing if the playlist is private/locked/doesn't contain the file. Prev/Next use `replace`, so the system Back returns to the playlist.
Nothing auto-plays. The public page also offers **Continue** (last opened position, stored in `localStorage` on that device only).
Shuffle was deliberately not added (it would conflict with "N of M" in saved order).

## Migration (additive)
`migrations/playlist_share/up.sql` / `down.sql`; `src/db/schema.ts` has the matching column + unique index.
**Apply `up.sql` to a database before deploying code that reads `playlists`** (Drizzle selects every column).
