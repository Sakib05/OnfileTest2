/**
 * Clipboard reading for the "Paste" button.
 *
 * Pure and dependency-injected so it can be unit-tested without a browser.
 * It NEVER focuses anything: reading the clipboard must not open the mobile
 * keyboard.
 *
 * Strategy: prefer the standard async Clipboard API; if it is missing or
 * rejects (common in Android WebViews / when permission is denied), fall back
 * to the Telegram Mini App bridge (`WebApp.readTextFromClipboard`, Bot API
 * 6.4+) when available.
 */

export type ClipboardReadResult =
  | { status: "ok"; text: string }
  /** Clipboard was readable but contained no text (or Telegram returned null). */
  | { status: "empty" }
  /** Every available mechanism failed / was blocked. */
  | { status: "denied" }
  /** No clipboard-read mechanism exists at all in this environment. */
  | { status: "unavailable" };

export interface ClipboardSources {
  /** e.g. `() => navigator.clipboard.readText()` — undefined when unsupported. */
  navigatorRead?: (() => Promise<string>) | null;
  /** e.g. `(cb) => WebApp.readTextFromClipboard(cb)` — undefined when unsupported. */
  telegramRead?: ((callback: (text: string | null) => void) => void) | null;
}

export async function readClipboardText(sources: ClipboardSources): Promise<ClipboardReadResult> {
  let attempted = false;
  let failed = false;

  if (sources.navigatorRead) {
    attempted = true;
    try {
      const text = await sources.navigatorRead();
      if (typeof text === "string" && text.trim()) return { status: "ok", text: text.trim() };
      // A successful read of an empty clipboard is a definitive answer.
      return { status: "empty" };
    } catch {
      failed = true; // permission denied / not focused / unsupported — try the bridge
    }
  }

  if (sources.telegramRead) {
    attempted = true;
    const read = sources.telegramRead;
    const text = await new Promise<string | null>((resolve) => {
      try {
        read((t) => resolve(typeof t === "string" ? t : null));
      } catch {
        failed = true;
        resolve(null);
      }
    });
    if (text && text.trim()) return { status: "ok", text: text.trim() };
    return failed ? { status: "denied" } : { status: "empty" };
  }

  if (!attempted) return { status: "unavailable" };
  return { status: "denied" };
}

export const PASTE_MESSAGES = {
  empty: "Nothing to paste. Copy a post link in Telegram first, or type it in the field.",
  denied: "Couldn't read your clipboard. Tap the field and paste the link manually.",
  unavailable: "Paste isn't available here. Tap the field and paste the link manually.",
} as const;
