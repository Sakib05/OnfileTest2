import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

/**
 * Static audit: Telegram's native Back Button is the ONLY application-level back control, so no
 * screen may render a back arrow/chevron. The entries below are the deliberate exceptions —
 * each is NOT application-level back navigation.
 */
const ROOT = path.resolve(__dirname, "..");
const ALLOWED: Record<string, string> = {
  // Publish wizard step controls (Previous/Next between wizard steps) — must keep working.
  "components/publish/DetailsStep.tsx": "wizard step control",
  "components/publish/MonetizationStep.tsx": "wizard step control",
  "components/publish/PreviewStep.tsx": "wizard step control",
  // Decorative recreations of Telegram's own UI inside the guide screenshots.
  "components/setup/guide/GuideIllustrations.tsx": "illustration of Telegram's UI",
  // Swipe row: ArrowLeft is a keyboard key name, not an icon.
  "components/playlists/SwipeableRow.tsx": "keyboard key name",
  // Creator playlist page: the header Back button is rendered ONLY outside Telegram (plain browser), where there is no
  // native BackButton. Inside the Mini App the native button is the single back control (see `insideTelegram`).
  "components/playlists/PlaylistPage.tsx": "browser-only fallback back button; hidden inside Telegram",
  // Creator playlist analytics page: same pattern (browser-only Back; native BackButton inside Telegram).
  "components/playlists/analytics/PlaylistAnalyticsPage.tsx": "browser-only fallback back button; hidden inside Telegram",
};

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return walk(p);
    return /\.(tsx|ts)$/.test(e.name) && !/\.test\./.test(e.name) ? [p] : [];
  });
}

describe("no in-page application-level back arrows", () => {
  const offenders = walk(ROOT)
    .map((f) => path.relative(ROOT, f).split(path.sep).join("/"))
    .filter((rel) => !(rel in ALLOWED))
    .filter((rel) => /\b(ArrowLeft|ChevronLeft)\b/.test(fs.readFileSync(path.join(ROOT, rel), "utf8")));

  it("only the documented exceptions reference ArrowLeft / ChevronLeft", () => {
    expect(offenders).toEqual([]);
  });

  it("the wizard's own step controls still exist (they are not application-level back)", () => {
    for (const rel of ["components/publish/DetailsStep.tsx", "components/publish/MonetizationStep.tsx", "components/publish/PreviewStep.tsx"]) {
      expect(fs.readFileSync(path.join(ROOT, rel), "utf8")).toMatch(/ArrowLeft/);
    }
  });

  it("every screen with a nested page registers the shared native Back manager", () => {
    for (const rel of [
      "components/tabs/ProfileTab.tsx",
      "components/tabs/FilesTab.tsx",
      "components/tabs/HomeTab.tsx",
      "components/playlists/PlaylistPage.tsx",
      "components/playlists/analytics/PlaylistAnalyticsPage.tsx",
      "components/setup/ManualConnectGuide.tsx",
      "components/setup/BotConnectInstructions.tsx",
      "components/publish/PublishWizard.tsx",
      "app/admin/storage/page.tsx",
    ]) {
      expect(fs.readFileSync(path.join(ROOT, rel), "utf8"), rel).toMatch(/useTelegramBackButton\(/);
    }
    // And nothing binds BackButton listeners behind the manager's back.
    const direct = walk(ROOT)
      .map((f) => path.relative(ROOT, f).split(path.sep).join("/"))
      .filter((rel) => rel !== "lib/telegramBackButton.ts" && rel !== "lib/telegramWebApp.ts")
      .filter((rel) => /BackButton\??\.(onClick|offClick)|BackButton\.show\(/.test(fs.readFileSync(path.join(ROOT, rel), "utf8")));
    expect(direct).toEqual([]);
  });
});
