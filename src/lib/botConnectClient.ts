/**
 * Small, framework-free helpers for the bot-guided connection UI (kept separate so
 * they are trivially unit-testable).
 */

// The hand-off to the bot chat (open bot chat → Telegram.WebApp.close()) lives in
// "@/lib/botNavigation". It happens immediately — there is no artificial delay.

/**
 * Reads the public request reference from the bot's "Verify" button launch URL
 * (`/?connect=<ref>`). The ref is a plain positive integer; anything else is ignored.
 * It carries no secret and proves nothing — the server resolves it against the
 * authenticated Telegram user.
 */
export function readConnectRefFromLocation(search?: string): number | null {
  const raw = search ?? (typeof window === "undefined" ? "" : window.location.search);
  try {
    const value = new URLSearchParams(raw).get("connect");
    if (!value || !/^\d{1,10}$/.test(value)) return null;
    const n = Number(value);
    return Number.isSafeInteger(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

/** Seconds left until `clock.expiresAt` according to the SERVER clock (never negative). */
export function remainingSeconds(clock: { expiresAt: number; offset: number }, now: number = Date.now()): number {
  return Math.max(0, Math.ceil((clock.expiresAt - (now + clock.offset)) / 1000));
}

/** 600 → "10:00", 65 → "01:05". */
export function formatCountdown(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

// ─── Launch from "Return to Onfile" ─────────────────────────────────────────
//
// The bot's "Return to Onfile" button opens the Mini App at `/?connect=<ref>`. Several
// components (page routing, CreatorSetup, ProfileTab, the connection hook) need to know
// about that launch, and the hook strips the parameter once the request is concluded, so
// the first client-side reading is cached for the lifetime of the page.
let launchRef: number | null | undefined;

/** The request ref this page was launched with (cached; null on the server / normal launches). */
export function getLaunchConnectRef(): number | null {
  if (typeof window === "undefined") return null;
  if (launchRef === undefined) launchRef = readConnectRefFromLocation();
  return launchRef;
}

/** Forget the launch ref and remove `?connect=` from the address, so a reload doesn't resume a finished request. */
export function clearLaunchConnectRef(): void {
  launchRef = null;
  if (typeof window === "undefined") return;
  try {
    const url = new URL(window.location.href);
    if (!url.searchParams.has("connect")) return;
    url.searchParams.delete("connect");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  } catch {}
}

/** Test helper: forget the cached launch ref without touching the URL. */
export function resetLaunchConnectRefCache(): void {
  launchRef = undefined;
}
