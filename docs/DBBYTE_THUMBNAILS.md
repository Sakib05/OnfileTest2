# Onfile — DBByte Thumbnail Storage

Branch: `feature/dbbyte-thumbnail-storage` (not merged, not deployed).
DBByte is the **only** provider. Telegram files are never copied to DBByte — only the creator's optimized thumbnail image is.

## 1. Audit summary (repo `Sakib05/OnfileTest2`, `main` @ 0c20300)

| Area | Finding |
|---|---|
| Stack | Next.js 16.2.6 (App Router, Turbopack), React 19, Drizzle 0.45 + `pg`, Tailwind 4, Vitest. Vercel + Supabase Postgres. |
| Lockfile | **None committed** (only `package.json`). Vercel resolves versions at build time. I pinned `sharp` exactly; a generated `package-lock.json` is included (optional but recommended). |
| Auth | Telegram `initData` → opaque cookie session (`onfile_session`, hashed in `sessions`). `getSessionUser(req)` in `src/lib/auth.ts`. CSRF helper `isSameOriginRequest`. |
| Ownership | `files.userId` = `users.id`; every owner route filters `eq(files.userId, user.id)`. |
| Library | `FilesTab.tsx` ← `GET /api/files`. Access page `src/app/f/[slug]/page.tsx` ← `GET /api/link/[slug]`. Both showed only an emoji icon. |
| Existing thumbnails | **None** (no upload code, no table, no image libraries). Nothing reusable → new code. |
| Admin | **No admin auth or dashboard exists** (all "admin" hits are Telegram *channel* admins). Added the smallest safe gate (`ADMIN_TELEGRAM_IDS`) and one small page. |
| Caching | None configured. |
| Env conventions | plain `process.env.X` server-side (`TELEGRAM_BOT_TOKEN`, `DATABASE_URL`). |
| Migrations | Repo uses `drizzle-kit push` (no migration folder). |

## 2. What was added / changed

New: `src/lib/thumbnails/{config,provider,dbbyte,imageProcessing,repo,service,cleanup,usage,notify}.ts`, `src/lib/adminAuth.ts`,
`src/app/api/files/[id]/thumbnail/route.ts`, `src/app/api/admin/storage/route.ts`, `src/app/admin/storage/page.tsx`,
`src/components/ThumbnailManager.tsx`, `src/components/ui/FileThumb.tsx`, tests, `migrations/thumbnails/{up,down}.sql`, `scripts/e2e-thumbnails.mjs`, `.env.example`, this doc.

Small additive edits to existing files: `src/db/schema.ts` (+4 tables), `api/files/route.ts` (adds `thumbnailUrl`), `api/files/[id]/route.ts` (cleans the thumbnail object when a file is deleted), `api/link/[slug]/route.ts` (adds `thumbnailUrl`), `api/user/me/route.ts` + `AppContext.tsx` (`isAdmin` flag), `FilesTab.tsx` (thumbnail in list + "Thumbnail" menu item), `f/[slug]/page.tsx`, `ProfileTab.tsx` (admin-only link), `next.config.ts`, `package.json` (`sharp`, `test` script).

No existing column or table is altered. If the new tables are missing, library/link APIs degrade to "no thumbnail" instead of failing.

## 3. DBByte facts used (from DBByte's official API reference, docs and official SDK source)

* Auth: `Authorization: Bearer <API key>`; API base `https://api.dbbyte.com`.
* Upload: `POST /storage/{bucket}/upload` multipart field `file` (filename = object name); `?overwrite=true`; same name without overwrite → 409.
* Delete: `DELETE /storage/{bucket}/delete/{name}`. DBByte purges the CDN cache on delete (docs) — so no extra `/purge` request is spent.
* Public bucket files are served at `https://cdn.dbbyte.com/{public-token}/{bucket}/{file-name}`; edge-cache hits are **not** counted as requests (docs).
* 429 **with** `Retry-After` = burst limit (retry); **without** = plan quota (don't retry). Implemented exactly so.
* **There is no usage/analytics API** (SDK README states this) → admin usage is manual, labelled as such.
* Not S3-based; no S3 code used.

**Not documented / not verified by me:** the exact `Cache-Control` the CDN sends, whether object names with `/` work in CDN URLs (so object names are **flat**: `thumb-{userId}-{fileId}-{version}.webp`), and whether response `name` may differ from the uploaded filename (code uses the returned `name`).

## 4. Design

* **Upload** `POST /api/files/:id/thumbnail` (multipart `file`), **Remove** `DELETE` same URL. Identity only from the session cookie; client-supplied ids/headers are ignored. Same-origin check, 10 uploads/min/user, 2 MB limit (checked before and after buffering).
* **Server validation**: magic-byte sniffing (JPEG/PNG/WebP only), decoder must agree with the magic bytes, full decode (catches corrupt/truncated), animated WebP/APNG/GIF rejected, SVG/HTML/EXE rejected, 40 MP decompression-bomb guard.
* **Optimization** (sharp 0.34.5, loaded only inside the thumbnail route): auto-orient, strip EXIF/GPS/ICC, resize to ≤1280 px (never enlarge, never distort), transparency preserved (lossless WebP / optimized PNG; lossy-alpha only if >50 % smaller), photos → WebP q82; flat graphics/small images also try lossless; JPEG sources also try mozjpeg q85; the smallest wins, WebP preferred unless another format is >5 % smaller.
* **Versioning/cache**: every upload gets a new random 64-bit version in the object name → a brand-new URL. A URL never changes content, so it is safe for `immutable` caching. Replace order: upload new → verify → DB commit → delete old (failures go to an orphan queue; the old thumbnail is never removed before the new one is committed).
* **Delivery**: browsers load the DBByte CDN URL directly (`<img loading="lazy">`, fixed-size box → no layout shift, emoji fallback on error/missing). **Nothing is proxied through Vercel.**
* **Public bucket trade-off**: the bucket must be public for CDN delivery. Anyone holding a thumbnail URL can view it; URLs contain an unguessable version and are only exposed through the creator's library and published file links. Private bucket + signed URLs would give a different URL per view (breaks browser/CDN caching, costs an API request per image view), so it was rejected. Don't use this bucket for anything sensitive.
* **Failures**: invalid image → 400/413/415; 429 → message + `Retry-After`; quota/auth/5xx/timeouts → friendly 503/502 (no provider details), bounded retries (2× backoff 0.5 s/1.5 s; retries use `overwrite=true` so no duplicate objects); DB failure after upload → new object deleted (or queued), old thumbnail untouched.
* **Usage/limits (admin only)**: `/admin/storage` — manual figures for storage / monthly bandwidth / monthly requests (labelled *manual*), Onfile-side estimate (labelled *estimated*), failures, orphan retry button. Thresholds 70/80/90 % (env-configurable). At ≥90 % new uploads are refused (503 `uploads_paused`); viewing and deleting keep working; nothing is auto-deleted. A provider quota rejection pauses uploads for 15 min. Admins get a Telegram DM when the level worsens (when `TELEGRAM_BOT_TOKEN` is set). The 20 GB / 100 GB / 10 K figures are **not hardcoded** — you enter your plan limits.

## 5. Environment variables (names only — see `.env.example`)

`DBBYTE_API_KEY` (secret), `DBBYTE_BUCKET`, `DBBYTE_CDN_BASE_URL`, `ADMIN_TELEGRAM_IDS`; optional `DBBYTE_API_BASE_URL`, `THUMB_WARN_PCT`, `THUMB_HIGH_PCT`, `THUMB_BLOCK_PCT`. None are `NEXT_PUBLIC_*`.

## 6. DBByte setup

1. DBByte dashboard → your thumbnail bucket → make it **Public** with CDN delivery enabled.
2. API Keys → create a key **scoped to that bucket** with read + write + delete.
3. Copy the public CDN prefix from any file's CDN URL: everything before `/{bucket}/…`, i.e. `https://cdn.dbbyte.com/<public-token>`.
4. In Vercel → Project → Settings → Environment Variables, add the variables **for Preview only** first.

## 7. Database

Additive only (4 new tables). Either `npx drizzle-kit push` against the **preview/staging** DB, or run `migrations/thumbnails/up.sql` in the Supabase SQL editor. Rollback: `migrations/thumbnails/down.sql` (drops only these 4 tables). Nothing runs automatically; production is untouched until you approve.

## 8. Testing — what was actually run

Run in the sandbox against a local Postgres:

* `npx vitest run` → **13 files / 140 tests passed** (includes the repo's pre-existing tests).
  Image processing (JPEG/PNG/WebP, transparent PNG, oversize, corrupt, truncated, SVG/GIF/HTML/EXE, animated WebP & APNG, EXIF+GPS stripping, orientation, resize, compression), DBByte client (upload, delete, retries, 429 with/without Retry-After, 401/403/413/409, no key leakage), service (ownership, replace order, orphan handling, DB failure, quota, rate limit, usage gate), route (401, spoofed ids, CSRF, 413, Retry-After), usage thresholds, admin gate, URL versioning, and service + **real Postgres** + a local fake DBByte HTTP server.
* `node scripts/e2e-thumbnails.mjs` → **34/34** against the **production build** (`next start`): auth, spoofing, other creator, upload/replace/delete, library + access-page APIs, file-delete cleanup, admin gate, 90 % upload pause, `/api/user/me`, pages render.
* `eslint .`, `tsc --noEmit`, `next build` pass. Build output check: only `/api/files/[id]/thumbnail` traces `sharp`; `/api/user/me`, `/api/files`, `/api/link`, webhook, auth, admin and file delete do not.

**NOT verified (needs your real DBByte credentials + a Vercel Preview):** a real upload/delete against DBByte; that the CDN URL actually serves the image; the real `Cache-Control`/CDN hit-miss behaviour; second-visit browser-cache hit; cross-device load; Vercel runtime packaging of sharp; Telegram DM notification. Everything labelled "caching works" is therefore **unverified**: app-side guarantees (unique immutable URLs, no proxying, no-store API responses) are tested; edge/browser behaviour is not.

### Preview checklist (5 minutes)
1. Upload a JPEG ≤2 MB to a library file → thumbnail appears; DBByte bucket shows one `thumb-…webp`.
2. In a browser/desktop devtools Network tab open the thumbnail URL twice: note `cache-control` and any `cf-cache-status`/`x-cache` header. **If DBByte's CDN does not send a long-lived `Cache-Control`, tell me** — a fallback (e.g. Vercel Image Optimization, which has its own cost) can then be discussed.
3. Reload My Library: image should come from disk cache (`(disk cache)` in devtools) and DBByte request count must not rise.
4. Replace → new image appears at once. Remove → icon returns; object gone from the bucket.
5. Open `/f/<slug>` → same thumbnail. Open the app on another device → still loads.
6. Profile tab (as an admin id) → "Thumbnail Storage" → enter manual figures.

## 9. Applying on Android (GitHub app / mobile browser)

1. Open the repo on GitHub → tap the branch selector → type `feature/dbbyte-thumbnail-storage` → *Create branch from main*.
2. Extract the ZIP on the phone. For each file listed in `FILE_LIST.txt`: in the branch, open the folder → *Add file → Upload files* (keeps folder structure if you upload folders) or open an existing file → ✎ → paste content. Don't touch `main`.
3. Commit to the **feature branch** ("Add DBByte thumbnails").
4. Vercel opens a **Preview Deployment** automatically for the branch (Production only deploys from `main`). Add the env vars to **Preview** only.
5. Apply `migrations/thumbnails/up.sql` to a **preview/staging** database (if your preview uses the production Supabase DB, create a Supabase branch/second project first).
6. Test with the checklist above. Only after you're happy, open a PR and merge — that is the production release; nothing here does it for you.

## 10. Rollback

* Before merge: just delete the branch.
* After merge: *Revert* the PR on GitHub (Vercel redeploys the old code; the app tolerates the extra tables). Optionally run `migrations/thumbnails/down.sql` and delete `thumb-*` objects in the DBByte bucket. Remove the env vars if desired.

## 11. Known limitations

* DBByte usage figures are manual (no usage API); estimates are Onfile-side only.
* The usage gate and 429-pause are checked at upload time; there is no scheduled job. Orphan cleanup is admin-triggered.
* Rate limiting reuses the repo's per-instance in-memory limiter (not global on serverless).
* Vercel request bodies are capped at 4.5 MB; the 2 MiB (2,097,152 byte) thumbnail limit (`src/lib/thumbnails/limits.ts`) is well inside it.
* Account deletion cascades DB rows but does not delete DBByte objects (no account-deletion flow exists yet).
* Thumbnails are public-by-URL (see trade-off above). Playlist covers are not covered by this change.
* `package-lock.json` is new to the repo (it had none).
