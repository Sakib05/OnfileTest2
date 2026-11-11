# Thumbnail upload + Playlist creation — implementation notes

## Playlist root cause (verified by a regression test that fails on the old code)
`PlaylistPicker` renders its "Create New Playlist" dialog (a `<form>`) from inside the Post Details `<form>`.
`Modal` rendered inline, so the dialog form was nested in the details form and React bubbled the dialog's
`submit` to the details form's `onSubmit`, which advanced the wizard (`onContinue`) while the playlist request was
in flight. The dialog's ✕ button had no `type="button"`, so it also submitted the details form.
Secondary defects fixed: file counts always 0 (`total_files` was never maintained), deleting a playlist left
posts pointing at a missing playlist, `PATCH /api/files/:id` accepted any `playlistId` (no ownership check),
invalid ids caused 500s, no input validation, no duplicate protection, password hash returned to the browser.

Fixes: `Modal` → portal + `type="button"` + Esc; picker stops submit propagation, validates, guards double taps,
shows inline errors; `POST /api/playlists` validates, locks per-user and returns the existing playlist for a repeated
same-title request within 30 s; `GET` returns live counts and `hasPassword` (never the hash); `DELETE` detaches posts in
one transaction; publish re-checks playlist ownership inside the transaction; the wizard adds a new playlist to the list
immediately and re-fetches it; a deleted playlist is dropped from the draft; FilesTab can open a playlist and remove posts from it.

## Thumbnail design
* Browser → `POST /api/thumbnails` (multipart) → server validates magic bytes, re-encodes with sharp, uploads via the
  `ThumbnailStorage` interface (`src/lib/thumbnails/provider.ts`) → row in `thumbnail_uploads` (status `staged`, bound to the user).
* Publish sends `thumbnailRef`. Inside the publish transaction the staged row is locked, checked (same user, still staged),
  a `file_thumbnails` row is created for the new post (the same table the library and `/f/[slug]` page already read), and the
  staged row becomes `attached`. Any failure rolls the whole post back.
* Replace/remove in the wizard → `DELETE /api/thumbnails/:ref` (only own, still-staged uploads; never an attached one).
  Never-published uploads are expired and deleted after 24 h (lazy purge). Existing posts use the existing
  `/api/files/:id/thumbnail` endpoints (Library → ⋯ → Thumbnail); editing a post never touches its thumbnail.
* Provider selection lives only in `src/lib/thumbnails/storage.ts` (`THUMBNAIL_STORAGE_PROVIDER`, default `dbbyte`).
* Limits: **2 MiB (2,097,152 bytes) everywhere** — defined once in `src/lib/thumbnails/limits.ts` and used by the
  pickers, the browser compressor (`imageCompress.ts`, which guarantees the payload is ≤ 2 MiB or shows an error),
  both upload routes and the server image pipeline (`imageProcessing.ts`). The server enforces it independently.
* No old data touched: only one NEW table (`thumbnail_uploads`, see `migrations/thumbnails/up.sql`, additive/idempotent).

## DBByte "401 Invalid or revoked API key"
The client matches DBByte's published OpenAPI (`POST /storage/{bucket}/upload`, `Authorization: Bearer dbk_…`, multipart `file`).
So the 401 is a credential/environment problem, not an endpoint/format bug. The code cannot see production env, so:
the key is now normalised (quotes, newline/CR, `Bearer `, `NAME=` prefixes are the usual way a good key becomes "invalid"),
and admins get a `check_credentials` action on `POST /api/admin/storage` that calls DBByte's documented `GET /health`.
Checklist: the key is set for the SAME Vercel environment that serves the app (Production vs Preview), it was not
re-generated/revoked after it was copied, the bucket slug matches, redeploy after changing env vars.
