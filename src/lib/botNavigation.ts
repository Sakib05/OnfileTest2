/**
 * Shared "go to the Onfile Bot" navigation for the bot-guided channel connection.
 *
 * ONE function (`navigateToBot`) performs the hand-off, and it is used by BOTH the
 * automatic redirect (`scheduleBotNavigation`, ~3 s after the connection window
 * started) and the manual fallback link ("Didn't switch to Telegram? Tap here…").
 *
 * Sequence (all official Telegram WebApp API, nothing undocumented):
 *   1. `Telegram.WebApp.openTelegramLink(botUrl)`  — opens the bot chat. Since Bot API 7.0
 *      this does NOT close the Mini App, which is why the Mini App used to stay in front
 *      of the chat after the automatic redirect.
 *   2. `Telegram.WebApp.close()`                    — explicitly closes the Mini App so the
 *      bot chat is what the user sees. (`window.close()` is not used; there is no
 *      documented "minimise" method.)
 *
 * If step 1 is impossible (outside Telegram / method missing / throws) the Mini App is
 * NOT closed — closing without having navigated would strand the user — and the caller
 * shows the manual link instead.
 *
 * The automatic redirect lives at MODULE level on purpose: a React component unmounting
 * (tab switch, re-render with a new key, parent state change) must not silently cancel a
 * hand-off the backend has already prepared. Only an explicit cancel
 * (`cancelBotNavigation`, called when the user presses Cancel / the request ends) does.
 */
import { closeTelegramMiniApp, openTelegramBotLink } from "@/lib/telegramWebApp";

/** Deliberate UX pause between the connection window starting and Telegram opening the bot chat. */
export const BOT_NAVIGATION_DELAY_MS = 3000;

/** Repeated taps / a tap right after the automatic redirect within this window are one navigation. */
export const NAVIGATION_DEBOUNCE_MS = 1500;

export type BotNavigationResult =
  /** The bot chat link was opened (and the Mini App asked to close). */
  | { status: "navigated"; closed: boolean }
  /** Telegram's bridge cannot open the link — show the manual link. Mini App left open. */
  | { status: "unavailable" }
  /** Ignored: another navigation was performed a moment ago. */
  | { status: "duplicate" };

let lastNavigationAt = 0;

/** The single navigation routine: open the bot chat, then explicitly close the Mini App. */
export function navigateToBot(botUrl: string): BotNavigationResult {
  const now = Date.now();
  if (lastNavigationAt && now - lastNavigationAt < NAVIGATION_DEBOUNCE_MS) return { status: "duplicate" };

  const opened = openTelegramBotLink(botUrl);
  if (!opened) return { status: "unavailable" };

  lastNavigationAt = now;
  // Bot API 7.0+ no longer closes the Mini App when a t.me link is opened: do it explicitly.
  const closed = closeTelegramMiniApp();
  return { status: "navigated", closed };
}

interface ScheduledNavigation {
  timer: ReturnType<typeof setTimeout>;
}
const scheduled = new Map<string, ScheduledNavigation>();
const done = new Set<string>();

/**
 * Schedules the automatic redirect for the request identified by `key` (its opaque token).
 * Idempotent: a second call for the same key while scheduled — or after it already ran —
 * does nothing, so retries / re-renders can never navigate twice.
 * Returns true when this call scheduled a new redirect.
 */
export function scheduleBotNavigation(
  key: string,
  botUrl: string,
  delayMs: number,
  hooks: { onBefore?: () => void; onResult?: (result: BotNavigationResult) => void } = {}
): boolean {
  if (scheduled.has(key) || done.has(key)) return false;
  const timer = setTimeout(() => {
    scheduled.delete(key);
    done.add(key);
    try {
      hooks.onBefore?.();
    } catch {}
    const result = navigateToBot(botUrl);
    try {
      hooks.onResult?.(result);
    } catch {}
  }, Math.max(0, delayMs));
  scheduled.set(key, { timer });
  return true;
}

/** Cancels a not-yet-fired automatic redirect (user pressed Cancel, request ended). */
export function cancelBotNavigation(key: string | null | undefined): void {
  if (!key) return;
  const entry = scheduled.get(key);
  if (entry) {
    clearTimeout(entry.timer);
    scheduled.delete(key);
  }
}

export function hasScheduledBotNavigation(key: string): boolean {
  return scheduled.has(key);
}

/** Test helper. */
export function resetBotNavigationForTests(): void {
  for (const { timer } of scheduled.values()) clearTimeout(timer);
  scheduled.clear();
  done.clear();
  lastNavigationAt = 0;
}
