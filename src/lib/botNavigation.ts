/**
 * Shared "go to the Onfile Bot" navigation for the bot-guided channel connection.
 *
 * ONE function (`navigateToBot`) performs the hand-off, and it is used by BOTH the
 * automatic redirect (`navigateToBotOnce`, fired IMMEDIATELY once the backend has started the
 * connection window and delivered the channel-selection message) and the manual fallback link
 * ("Didn't switch to Telegram? Tap here…").
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
 * There is deliberately NO delay between "the bot message is ready" and the hand-off: the former
 * fixed 3 s pause added nothing (the server only answers after the picker message has been handed
 * to Telegram) and made the user wait.
 */
import { closeTelegramMiniApp, openTelegramBotLink } from "@/lib/telegramWebApp";

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

const done = new Set<string>();

/**
 * Performs the automatic redirect for the request identified by `key` (its opaque token) right away.
 * Idempotent: a second call for the same key — retries, re-renders, a double tap — does nothing, so the
 * hand-off can never run twice for one request. Returns true when this call performed the navigation attempt.
 *
 * Runs at MODULE level, independent of any React component's lifecycle.
 */
export function navigateToBotOnce(
  key: string,
  botUrl: string,
  hooks: { onBefore?: () => void; onResult?: (result: BotNavigationResult) => void } = {}
): boolean {
  if (done.has(key)) return false;
  done.add(key);
  try {
    hooks.onBefore?.();
  } catch {}
  const result = navigateToBot(botUrl);
  try {
    hooks.onResult?.(result);
  } catch {}
  return true;
}

/** Test helper. */
export function resetBotNavigationForTests(): void {
  done.clear();
  lastNavigationAt = 0;
}
