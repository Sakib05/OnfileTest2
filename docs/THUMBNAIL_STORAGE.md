# Onfile — Multi-Provider Thumbnail Storage

Only optional **thumbnail images** are stored externally. The real digital files stay in creators' private
Telegram channels and are never sent to ImageKit, Cloudinary, Supabase or DBByte.

Providers: **ImageKit · Cloudinary · Supabase Storage · DBByte** (Cloudflare R2 intentionally excluded).
Every thumbnail lives in exactly **one** primary provider, chosen by a quota-aware weighted allocator.

> Nothing here was deployed, pushed, or migrated in production. Apply the SQL to staging first.

---------------------------------------------------------------------------------------------------

## 1. What was found in the repository (Phase 1)

* Stack: Next.js 16 (App Router) · React 19 · TypeScript · Drizzle ORM (`pg`) · PostgreSQL/Supabase · Tailwind 4 · Vitest.
* Auth: Telegram `initData` HMAC validation (`src/lib/auth.ts`) → opaque, hashed, HTTP-only **session cookie**. All APIs derive identity from the session; `isSameOriginRequest` guards state-changing routes.
* **There was no admin infrastructure** and **no `vercel.json`** (none was overwritten; one was created).
* Rate limiting was an **in-memory** limiter (`src/lib/rateLimit.ts`) – not shared between Vercel instances.
* **Pre-existing leak fixed:** `GET/POST/PATCH /api/files*` and `/api/playlists*` returned the stored password **hash**. They now return `hasPassword` only (`src/lib/fileDto.ts`). The public `/api/link/[slug]` already returned only `hasPassword`.
* Unchanged: Telegram webhook, file delivery/unlock/password verification, monetisation, ads, wallet.

## 2. Architecture (Phase 2)

```
Creator UI (FilesTab ▸ ⋯ ▸ Thumbnail)           Public file page /f/[slug]
        │ multipart (≤2 MB)                              │ <img src=/api/link/{slug}/thumbnail>
        ▼                                                ▼
POST /api/files/[id]/thumbnail                  GET /api/link/[slug]/thumbnail  (published only)
  session ▸ same-origin ▸ DB rate limit ▸ owner check   GET /api/files/[id]/thumbnail (owner / published)
        ▼
 imageProcessing (sharp, in-memory) ─► allocation ─► adapter.upload (retry/failover) ─► verifyObject
        ▼                                                          (download + SHA-256)
 commitAsset (tx, FOR UPDATE on file row, one ACTIVE per file)  ── asset row created ONLY after verification
```

| Concern | Location |
|---|---|
| Schema | `src/db/schema.ts` (bottom block) · SQL: `migrations/0001_thumbnail_storage.{up,down}.sql` |
| Adapters | `src/lib/storage/adapters/{imagekit,cloudinary,supabase,dbbyte}.ts` · registry `adapters/index.ts` |
| Allocation (pure, replayable) | `src/lib/storage/allocation.ts` · status rules `status.ts` |
| Upload/replace/remove/deliver | `src/lib/storage/thumbnails.ts` |
| Migration engine | `src/lib/storage/migration.ts` |
| Maintenance / usage / health | `src/lib/storage/maintenance.ts` |
| Admin API + actions + audit | `src/lib/storage/admin.ts`, `src/app/api/admin/storage/route.ts` |
| Alerts (Telegram, dedupe) | `src/lib/storage/alerts.ts` |
| Shared rate limit | `src/lib/storage/sharedRateLimit.ts` |
| Admin page | `/admin/storage` (`src/app/admin/storage/page.tsx`) |
| Cron | `GET /api/cron/storage` + `vercel.json` |

### Database (all additive)
`storage_providers`, `thumbnail_assets`, `storage_migration_jobs`, `provider_usage_history`,
`storage_provider_events`, `storage_audit_logs`, `storage_settings` (+ `storage_rate_limits`, `storage_locks`).

* One **active** thumbnail per file → partial unique index `(file_id) WHERE status='active'`.
* One **open** migration job per asset → partial unique index on `asset_id WHERE status IN (pending,running,paused)`.
* `thumbnail_assets.file_id/owner_id` are `ON DELETE SET NULL` (never silently forget a remote object); the maintenance sweep turns such rows into `pending_delete` and deletes the remote object.
* Concurrency: `SELECT … FOR UPDATE` on the file row for upload/remove, compare-and-swap (`version`) for migrations, lease lock for maintenance (works behind a pooler: no session advisory locks).
* **No secrets in the database.** Credentials live only in environment variables; the admin snapshot returns `configured: true/false` only.
* Timestamps in the new tables are `timestamptz`.

### Allocation (weighted, dynamic, explainable)
Eligible = enabled ∧ credentials present ∧ status ACTIVE/NEAR_LIMIT ∧ terms ≠ PROHIBITED ∧ **known** storage & bandwidth quota ∧ below critical % ∧ headroom for the object after the safety margin ∧ asset cap not reached.

`weight = adminWeight × min(storage, bandwidth, requests headroom) × capacityFactor × nearLimitFactor × 1/(1+recent failures)`

The primary is drawn with a **seeded** PRNG, then remaining providers are drawn without replacement to form the failover order. The seed, probabilities, exclusions and a text summary are stored in `thumbnail_assets.allocation_reason` and an event, so every decision can be replayed/explained.

### Status rules (defaults, configurable in the dashboard)
`≥80 %` → **NEAR_LIMIT** (weight ×0.25, migration prepared) · `≥90 %` → **EXHAUSTED** (no uploads, migration prioritised) · `DRAINING`/`DISABLED` are manual · `ERROR` on 401/403 or repeated failed health checks (cleared by a passing check or "Clear error"). A provider **quota error** → EXHAUSTED until the billing period renews (or 24 h if the cycle is unknown). Storage, bandwidth and requests are tracked **separately**.

### Failover
429 → honour `Retry-After` (only if ≤ 5 s; longer fails over), bounded retries · 5xx / timeout / network → exponential backoff with jitter, bounded · 401/403 → provider `ERROR` (never "quota") · quota → `EXHAUSTED` · then the next provider in the weighted order (max 4). Verification failure deletes the stray object and fails over. DB-commit failure deletes the remote object (or records an `orphan_possible` event).

### Migration
claim job (CAS) → download from source → compare with stored SHA-256 → upload to an **eligible** destination (never disabled/exhausted/unhealthy; capacity-checked at enqueue) → `verifyObject` → **compare-and-swap** the DB pointer → verify delivery (roll back pointer on failure) → delete the old object **last** (failure ⇒ `pending_delete` tombstone swept later). Failures keep the old reference, back off exponentially, stop after `migrationMaxRetries` (default 5) and show in the dashboard; admins can pause/resume/retry. Stale `running` jobs are re-queued.

## 3. Provider facts — verified vs. not verified

| | Verified from official docs/SDK (during this build) | NOT live-tested / assumption |
|---|---|---|
| **ImageKit** | Upload `POST upload.imagekit.io/api/v1/files/upload` (Basic auth = private key, `isPrivateFile`); private files need **signed URLs**; signature = lowercase hex HMAC-SHA1(privateKey, *path-after-endpoint + expiry*), `ik-t` = expiry (seconds), `ik-s` = signature. | Usage endpoint `GET api.imagekit.io/v1/accounts/usage` + its field names (`bandwidthBytes`, `mediaLibraryStorageBytes`) are from memory — response is parsed defensively and falls back to ESTIMATED if absent. `tr:orig-true` (serve stored bytes for checksums) is assumed; if rejected, migrations fail safely. ImageKit's default image optimisation may alter bytes sent to *browsers* (never stored bytes). |
| **Cloudinary** | Authenticated delivery URLs **do not expire**; expiring **token-based auth requires an Advanced plan + CNAME** (not on Free). ⇒ Onfile **proxies** Cloudinary thumbnails server-side (`clientSafe:false`); the permanent URL never reaches a client. Upload/destroy signing, `ping`, `usage` endpoints. | Usage JSON shape parsed defensively. Free plans are *credit*-based → set byte quotas manually if you want enforcement. Proxying consumes Vercel bandwidth/CPU. |
| **Supabase** | Private bucket + `POST /storage/v1/object/sign/{bucket}/{path}` (JWT `exp` enforced by Storage); upload/delete/info/authenticated download; health check **fails if the bucket is public**. | **No usage API** for service-role keys ⇒ usage = MANUAL or ESTIMATED (own counters). Supabase egress/storage is shared with your app database project. |
| **DBByte** | Not S3: REST API `https://api.dbbyte.com` (Bearer key) — `POST /storage/{bucket}/upload`, `GET …/download/{key}`, `DELETE …/delete/{key}`, `POST …/sign/{key}` (`expiresIn` ≤ 604 800 s), `GET /health` (from the official `@dbbyte/sdk`). 429 **without** `Retry-After` = plan quota (not retryable). **No metadata endpoint, no usage/analytics API** ⇒ `getMetadata`/`getUsage` return *unsupported*; quotas/usage are MANUAL/ESTIMATED. | Provider-side enforcement of signed-URL expiry is documented but not live-tested. The 20 GB / 100 GB / 10 K requests figures are **user-observed dashboard values**, seeded as MANUAL on first run, not guaranteed. DBByte request metering is unverified, so Onfile counts its own calls (estimate). |

**Commercial terms:** the build did **not** read or interpret each provider's ToS. All four start as `UNREVIEWED`
with an explanatory note. Set `PERMITTED` / `AMBIGUOUS` / `PROHIBITED` in the dashboard after your own review;
only `PROHIBITED` blocks uploads. No written approval is claimed. Each provider can be disabled independently
and "Migrate away" / "Drain" moves its thumbnails elsewhere.

## 4. Image processing
JPEG/PNG/WebP only · ≤ 2 MB · magic-byte + declared-MIME match · animated WebP/APNG rejected · SVG/GIF/HTML/EXE rejected by signature · full decode (corrupt rejected) · ≤ 12 000 px side / 40 MP · EXIF auto-orient then **all metadata (EXIF/GPS/XMP/ICC) removed** · resize to ≤ 1280 px (never enlarged) · lossy WebP q85 for photos · **lossless WebP or optimised PNG** (smallest wins) for flat graphics/logos · alpha preserved · clean small images kept byte-for-byte when conversion doesn't help · output never larger than a *clean* input. In-memory only; originals are never stored. Quality is **not** claimed to be lossless for photographs.

## 5. Secure delivery
* `GET /api/files/[id]/thumbnail` — session required; allowed if file is published **or** requester owns it (otherwise 404, indistinguishable from "missing").
* `GET /api/link/[slug]/thumbnail` — published files only (owner may see their own unpublished file).
* ImageKit / Supabase / DBByte → `302` to a provider-signed URL valid ≤ 300 s (setting `signedUrlTtlSeconds`); redirect cache ≤ 60 s.
* Cloudinary (Free) → bytes streamed by Onfile with `nosniff`, restrictive CSP, MIME from our DB.
* Provider keys are never returned; no permanent URL for a private object is ever sent to a browser.

## 6. Admin dashboard
Open **/admin/storage** (Profile ▸ *Storage Admin* appears only for admins). Access = session cookie of a user whose
Telegram id is in `ADMIN_TELEGRAM_IDS` (**server-side check on every request; client-supplied ids are ignored**; POSTs also require same-origin).

Shows per provider: health, enabled/status, terms status, storage / bandwidth / request usage **with source labels** (`OFFICIAL_API`, `MANUAL`, `ESTIMATED`, `UNKNOWN`), quotas, last health check, last usage sync, recent errors, thumbnail count; plus allocation distribution & next-upload probabilities, migration queue/failures, events, warnings, audit history, overall health.
Actions: enable/disable, drain, inspect health, sync usage, set quotas / manual usage / billing-cycle day / weight / max assets, set terms status, start migration, pause/resume/retry job, pause/resume all migrations, thresholds, run maintenance. **Every action is audited** (`storage_audit_logs`).

**Billing periods:** counters for MANUAL/ESTIMATED metrics reset only on the **billing-cycle day you configure**; if unknown they are never auto-reset (dashboard warns).

## 7. Maintenance & cron
`GET /api/cron/storage` requires `Authorization: Bearer $CRON_SECRET` (timing-safe; fails closed with 503 if unset). Tasks: health checks → usage sync → quota evaluation → status updates → migration scheduling → retries → orphan sweep (`pending_delete` + file-less assets) → expired temp data cleanup (rate-limit rows, old history/events) → alerts. A lease lock prevents concurrent runs.

`vercel.json` (new file — none existed) schedules it **daily at 03:00 UTC**:
```json
{ "crons": [{ "path": "/api/cron/storage", "schedule": "0 3 * * *" }] }
```
**Plan limits (verify against your plan):** Vercel Hobby limits cron to once per day (and function duration is capped; the route uses a 45 s work budget, `maxDuration = 60`). Pro allows far more frequent schedules (e.g. `*/15 * * * *`). Because Hobby runs daily, recovery from `ERROR`, usage refresh and migration throughput (≤ 10 jobs/run) are slow there; admins can press **Run maintenance now**, or an external scheduler can call the endpoint with the bearer secret.

## 8. Notifications
Telegram bot messages to `ADMIN_TELEGRAM_IDS` for: near-limit, exhausted, auth failure, provider down, repeated upload failures, migration failure/blocked, migration success (batched), no eligible provider. Deduplicated by `dedupe_key` with a cooldown (default 360 min, configurable); suppressed duplicates are still logged.

## 9. Rate limiting
The old limiter is per-instance. New thumbnail/admin routes use a **Postgres-backed fixed window** (`storage_rate_limits`) that works across Vercel instances without paid infrastructure (falls back to in-memory if the DB is unreachable). Costs one small write per request; options if volume grows: Upstash Redis / Vercel KV (free tiers) behind the same `sharedRateLimit()` signature. The pre-existing `link-unlock` limiter was left untouched (out of scope) and is still per-instance.

## 10. Setup
1. **Staging DB first:** `psql "$STAGING_DATABASE_URL" -f migrations/0001_thumbnail_storage.up.sql` (or `npx drizzle-kit push` against staging). Rollback: `…down.sql`. *Never run against production from this build.* (If the tables are missing the file list/delete flows still work — thumbnail calls are best-effort there — but the thumbnail endpoints return 5xx.)
2. Copy `.env.example` → set variables (never commit). Set `ADMIN_TELEGRAM_IDS` and `CRON_SECRET` (≥ 16 chars).
3. Create provider resources: ImageKit account (private key + URL endpoint) · Cloudinary cloud (API key/secret) · Supabase **private** bucket `onfile-thumbnails` · DBByte **private** bucket (slug → `DBBYTE_BUCKET`) + API key with write permission.
4. Deploy to a **preview** environment, open `/admin/storage`, press **Inspect health** on each provider, set quotas from *your* dashboards (providers with unknown quota receive no uploads), set billing-cycle days, review terms status, then upload a test thumbnail.
5. Upgrading a provider to a paid plan = just raise its quotas in the dashboard (and billing cycle); no code change. Nothing here purchases plans or enables overages.

## 11. Test report (all executed in this environment)

| Check | Result |
|---|---|
| `npx next typegen` | pass |
| `tsc --noEmit` | pass (0 errors) |
| ESLint on all changed/new files | pass (0 errors, 0 warnings) |
| **Vitest** (13 files, **163 tests**, executed 3× consecutively) | **163 / 163 passed** each run |
| – image processing (JPEG/PNG/WebP, MIME mismatch, SVG/GIF/HTML/EXE, oversize, corrupt, APNG + animated WebP, EXIF/GPS stripping, orientation, transparency, compression, dimensions) | 14 |
| – allocation (weighted distribution, headroom bias, near-limit, unknown quota, disabled/exhausted/error/draining, request quota, determinism, failover order) | 10 |
| – status/thresholds/billing period | 7 |
| – adapters with mocked HTTP (upload, download, delete, metadata, health, usage, secure delivery/expiry, unsupported capabilities, 401/403/429/quota classification, retry policy) | 23 |
| – security (admin authz, wrong owner/unpublished access rules, invalid Telegram session, cron auth, no password hashes) | 10 |
| – **PostgreSQL integration on scratch DBs** (`onfile_test_*`, created and dropped by the test): upload/replace/remove, one-active-per-file, failover, auth/quota handling, verify-before-commit, commit-failure cleanup, delivery redirect vs proxy, migration success / upload failure / checksum mismatch / destination verify failure / CAS conflict / concurrent runners / old-delete failure / retry limits / delivery rollback / ineligible destinations, quota evaluation → migration, maintenance lock, usage-source labels, billing rollover, health, alert dedupe, shared rate limit, admin validation + audit, snapshot without secrets | 34 |
| SQL migration up + down on a scratch DB | pass (9 tables created, then removed) |
| `npm run build` | pass |
| `build_and_start` (bootstrap, build, start, `/api/health`) | pass |
| API smoke tests (running server) | `/api/health` 200 · cron without secret 503 · admin GET/POST without session 401 · non-admin session 403 · thumbnail GET/POST/DELETE without session 401 · cross-origin POST 403 · unknown/invalid slug 404 · SVG disguised as PNG 415 · valid PNG with no provider configured 503 (correct: no quota known) · unpublished/none → 404 |

**Not done / not claimed:** no calls to real provider APIs (so real upload, signed-URL expiry enforcement and usage endpoints are **untested live**); no browser/Telegram-WebView UI testing (UI verified by type-check, lint, build); `npm audit` reports pre-existing advisories in dependencies (not addressed).

## 12. Known limitations
* Live provider behaviour must be smoke-tested once in staging (see §3 table).
* Cloudinary Free thumbnails flow through Vercel (bandwidth + CPU); upgrade to Advanced for expiring token URLs.
* DBByte/Supabase usage is MANUAL/ESTIMATED; estimates drift (only counts requests made by Onfile).
* Daily cron on Hobby ⇒ slow automatic recovery/migration; use "Run maintenance now" or Pro.
* `ERROR` caused by a transient outage persists until the next health check passes (admins can "Clear error").
* Thumbnails are small; migrations move whole objects sequentially (max 10 per run).
* Telegram WebView may cache a redirect for up to 60 s.
* The ZIP contains source only (no `.env`, `node_modules`, `.next`).
