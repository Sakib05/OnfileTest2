# My Library & File Download page redesign

## My Library (`src/components/tabs/FilesTab.tsx`)
- Header: title · **search icon** · Add (+). Tapping the icon reveals a search field (animated, focus moves into it,
  Escape / ✕ closes it and clears the query). Search matches file **and** playlist titles.
- Categories: `Home · Video · Document · Audio · Image · Archive · Playlist` (horizontal scroll, orange active chip).
- **Home** = organised rows built from the single `/api/files` + `/api/playlists` snapshot (no extra queries):
  Recently Added, Videos, Documents, Audio, Images, Archives, Playlists. Empty sections are hidden, rows show 8 cards,
  "See all" appears only when there is more (category → opens that tab; Recently Added → expands in place).
  Logic: `src/lib/library.ts` (pure, unit-tested).
- Cards (`src/components/library/LibraryCards.tsx`): one component, three layouts (list / grid / Home row).
  Thumbnails are larger (list 112×84, grid/row 16:9), scaled with `object-cover` (never stretched), with the existing
  `FileThumb` → `FileTypeArt` fallback. **File size is never rendered** (the `fileSize` field is untouched in the API/DB).
- The item "⋯" menu is a single fixed-position menu (`LibraryMenu`) so it is not clipped by scrolling rows.

## Download page (`src/app/f/[slug]/page.tsx`, `src/components/download/*`, `src/lib/download.ts`)
- Same API as before: `GET /api/link/[slug]` (info) and `POST /api/link/[slug]` (unlock). No backend change.
- Layout: brand header + Report, large artwork (thumbnail's own aspect ratio, else FileTypeArt), type chip, title,
  views/downloads, **primary action panel**, creator, description. Two columns from `md` up.
- Access options: Ad (10 s countdown → "Get file"), Password, Stars. Every route ends in the server POST; the Telegram
  link is shown only from a successful server response. Requests are de-duplicated while in flight.
- Password-protected files show only the password option (the server rejects ad-only requests for them).

## Known pre-existing limitations (intentionally NOT changed — backend scope)
- The ad is a client-side countdown (no provider verification token is sent to or checked by the server).
- There is no Telegram Stars payment backend; the Stars button is shown disabled with an honest note.
- `POST /api/link/[slug]` does not check payment for priced files (paid publishing is gated by `STARS_PAID_PUBLISHING_ENABLED = false`).
