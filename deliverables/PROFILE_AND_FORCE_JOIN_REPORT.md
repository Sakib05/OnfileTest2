# Profile simplification + Force Join — delivery report

See docs/PROFILE_SIMPLIFICATION_AND_FORCE_JOIN.md and docs/ADVERTISING_SYSTEM.md for behaviour, security notes, migration (none required) and known limitations.

## Test results (local sandbox DB, nothing run against production)
* `npx vitest run` — 97 files passed (+1 skipped live-bot file), 1472 tests passed, 3 skipped (after `node scripts/generate-avatar-fixtures.mjs`).
* `npx next typegen`, `tsc --noEmit`, `npm run build` — pass. `build_and_start` (+ /api/health) — pass.
* `npm run lint` — 11 pre-existing errors in files not touched by this change (listed in the docs); none in changed files.

## Files changed vs. the original repository (git HEAD 68c46a4)
MODIFIED  README.md
MODIFIED  docs/ADVERTISING_SYSTEM.md
MODIFIED  scripts/configure-telegram-webhook.mjs
MODIFIED  src/app/api/link/[slug]/route.ts
MODIFIED  src/app/api/telegram/webhook/route.ts
MODIFIED  src/app/f/[slug]/page.test.tsx
MODIFIED  src/components/advertise/Advertise.ui.test.tsx
MODIFIED  src/components/advertise/wizard/CampaignWizard.tsx
MODIFIED  src/components/advertise/wizard/state.ts
MODIFIED  src/components/advertise/wizard/steps.tsx
MODIFIED  src/components/download/CreatorRow.tsx
MODIFIED  src/components/playlists/PublicPlaylistView.test.tsx
MODIFIED  src/components/profile/EditProfile.test.tsx
MODIFIED  src/components/profile/EditProfile.tsx
MODIFIED  src/components/profile/ProfileCard.tsx
MODIFIED  src/components/ui/TelegramAvatar.test.tsx
MODIFIED  src/components/ui/TelegramAvatar.tsx
MODIFIED  src/components/viewer/ActionRow.tsx
MODIFIED  src/lib/ads/adminService.ts
MODIFIED  src/lib/ads/ads.unit.test.ts
MODIFIED  src/lib/ads/constants.ts
MODIFIED  src/lib/ads/join.ts
MODIFIED  src/lib/ads/service.ts
MODIFIED  src/lib/ads/validation.ts
MODIFIED  src/lib/download.ts
ADDED     docs/PROFILE_SIMPLIFICATION_AND_FORCE_JOIN.md
ADDED     src/app/api/link/[slug]/gate
ADDED     src/app/api/link/forceJoin.e2e.test.ts
ADDED     src/components/viewer/ForceJoinGate.test.tsx
ADDED     src/components/viewer/ForceJoinGate.tsx
ADDED     src/lib/ads/gate.ts
ADDED     src/lib/forceJoinClient.ts
DELETED   src/components/profile/AvatarCropper.test.tsx
DELETED   src/components/profile/AvatarCropper.tsx
ADDED     package-lock.json (the repository did not commit a lockfile)
