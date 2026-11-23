# Profile picture: upload bug fix + interactive cropper

No schema change, no migration, no new dependency, no new storage provider. Upload still goes through
`POST /api/user/avatar` → `uploadProfileImage` → `processThumbnail` (sharp) → DBByte (`ThumbnailStorage`).

## 1. Root cause of "This image is corrupt or can't be read. Please choose a different one."

**Where it came from (proven).** That exact sentence (note *can't*) existed in one place only: the `catch` around
`decode()` in the old `cropToSquareAvatar()` (`src/lib/profile/avatarClient.ts`). The server's own message reads
"…cannot be read" and is only produced after a request. So the failure happened **in the browser, while decoding the
picked photo, before any request was sent** — the upload route, sharp and DBByte were never reached.
The server side was re-verified with real fixtures (`avatarUploadPipeline.test.ts`): JPEG, PNG, WebP, EXIF-rotated
JPEG and the cropper's 512 px WebP/JPEG exports are all accepted and stored.

**Why the message was wrong / how the flow failed.** The old `decode()`:

1. swallowed the real error of `createImageBitmap(file, { imageOrientation: "from-image" })` (the option value is not
   understood by older Android WebViews → throws → silently ignored),
2. fell back to a single `<img>.decode()` attempt (known to reject with `EncodingError` on some Android WebViews, and
   it gave no information),
3. mapped *every* possible failure (unreadable file handle, huge bitmap, unsupported codec, HEIC with a `image/jpeg`
   MIME type, broken data) to the one "corrupt image" sentence,
4. cleared `<input>.value` **before** the file had been read, decoded the full-resolution photo (a 50–200 MP phone
   photo is far below the 20 MB file limit but needs hundreds of MB as a bitmap), and trusted the picker's MIME type.

**What could not be verified.** Real Android / Telegram WebView hardware was not available, so the exact
device-specific trigger (1–4 above) could not be reproduced; headless Chromium could not even be launched in the
build sandbox (missing system libraries). The fix removes every one of those fragilities and, if a device still
cannot open a photo, records *which* decoders failed (`console.warn("avatar_open_failed", kind, detail)`) instead of
hiding it.

## 2. What changed

| Stage | Before | Now |
| --- | --- | --- |
| Pick | `value=""` first, MIME from picker | bytes read first (`file.arrayBuffer()`), `<input>` reset afterwards |
| Format | `file.type` only | magic bytes (`imageFormat.ts`): JPEG/PNG/WebP ok; HEIC/HEIF, AVIF, GIF, text recognised and explained |
| Size | file bytes only | header-based pixel check (≤ 120 MP) before decoding |
| Decode | bitmap → `<img>.decode()` | `<img>` (EXIF-aware) → `createImageBitmap` ×2 → FileReader data-URL, 20 s timeout each, fresh `Blob` with the sniffed type |
| Memory | full-size bitmap kept | drawn once into a ≤ 2560 px working canvas, full-size decode closed immediately, canvas released on cancel/unmount |
| Crop | automatic centre crop | interactive cropper (below) |
| Export | `toBlob(webp)` unchecked | WebP q0.9 → JPEG fallback, Blob validated (non-empty, magic bytes, MIME = bytes, square, ≤ 512 px, ≤ 2 MB) |
| Upload | one generic error | `AvatarError` kinds (below); in-flight guard; no manual `Content-Type` |

### Error categories (`src/lib/profile/avatarErrors.ts`)
`unsupported_format`, `heic_unsupported`, `empty`, `corrupt` (bytes are not a valid image), `unreadable` (OS wouldn't hand
over the file), `decode_failed` (valid signature, device couldn't open it), `too_large`, `processing_failed` (crop/export),
`network`, `upload_failed`, `server_validation`, `storage_failed` (DBByte), `rate_limited`. Server `code`/status are mapped
to these; raw server text is never shown.

### Storage safety (unchanged server behaviour, now covered by tests)
Order: validate → store NEW object → commit key → delete OLD object. Any earlier failure leaves the saved picture, its
key and its stored object untouched. Nothing is uploaded when a photo is picked or cropped — only **Save Changes** uploads.

## 3. The cropper (`src/components/profile/AvatarCropper.tsx`, maths in `cropMath.ts`)
* Full-screen portal (works over the Edit Profile page, Telegram theme variables, light/dark). Telegram's native Back /
  Android back closes only the cropper; Esc too.
* The square stage **is** the exported square. A circular mask (inscribed circle) dims the corners a round avatar hides;
  a 56 px round preview shows the same crop. Stage, preview and export all call `drawCrop(cropRect(state))` → identical.
* Drag (pointer events, one pointer), pinch (two pointers, zooms around the fingers), mouse wheel, ± buttons, slider,
  keyboard (arrows, +/−). Zoom 1×–4×. Reset, Cancel, Apply Crop; touch targets ≥ 44 px.
* The state is the image centre offset (fraction of the box) + zoom, clamped so the photo always covers the square —
  no empty area can enter the crop.
* Output: square, `min(512, crop resolution)` px (never enlarged), WebP (JPEG fallback). The original file is never modified.
* Library: none added. The geometry is ~80 lines of pure, unit-tested code; pointer events cover touch + mouse.

## 4. Formats
Supported: JPEG, PNG, WebP (static). Rejected with a specific explanation: HEIC/HEIF (no reliable in-browser
conversion without a heavy dependency), AVIF, GIF, animated images (server), non-images, empty/corrupt files.

## 5. Tests
`imageFormat`, `cropMath`, `avatarImage` (decode strategies, rejections, export/validation), `avatarClient` (precheck,
upload error mapping, no manual Content-Type, duplicate submit, network), `avatarUploadPipeline` (real sharp + real
fixtures through the service: JPEG/PNG/WebP/corrupt/empty/malformed/oversized/storage failure/replace), `AvatarCropper`
(drag, pinch, wheel, zoom, reset, cancel, apply, square ≤ 512, preview alignment, failure/retry), `EditProfile`
(pick → crop → apply → Save, cancel, replace, remove, failures keep previous picture, double-tap), plus the existing
`TelegramAvatar` (custom → Telegram → initials, broken-image fallback) and `profile.e2e` (Telegram re-login does not
overwrite custom picture / display name) suites. Fixtures: `src/test/fixtures/avatar` (`node scripts/generate-avatar-fixtures.mjs`).

Run: `npx vitest run --no-file-parallelism` (the DB e2e files share one database; run them serially against a DEV DB).

## 6. Limitations
* Not tested on a physical Android device / real Telegram WebView — only jsdom, real sharp, and static checks.
* Canvas/decoder behaviour is faked in unit tests; the pixel output of `toBlob` was not asserted in a real browser.
* HEIC is rejected, not converted.
