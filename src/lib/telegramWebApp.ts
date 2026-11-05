"use client";

/**
 * Narrow typing for the subset of the Telegram Web App JS bridge
 * (https://core.telegram.org/bots/webapps) that Onfile actually uses. The
 * real object is injected by the `telegram-web-app.js` script tag loaded in
 * the root layout when the Mini App runs inside Telegram.
 */
export interface TelegramWebApp {
  initData: string;
  initDataUnsafe?: Record<string, unknown>;
  /** e.g. "9.6" — the Bot API version the current Telegram client supports. */
  version?: string;
  ready: () => void;
  expand: () => void;
  colorScheme?: "light" | "dark";
  /** Opens a t.me link. Does not close the Mini App (Bot API 7.0+). */
  openTelegramLink?: (url: string) => void;
  openLink?: (url: string) => void;
  /** Bot API 6.1+. Returns true if the client's version is >= the given one. */
  isVersionAtLeast?: (version: string) => boolean;
  /**
   * Bot API 9.6+. Opens Telegram's native chat-selection dialog directly
   * from the Mini App. `reqId` must be the `id` of a `PreparedKeyboardButton`
   * previously obtained via the Bot API method `savePreparedKeyboardButton`
   * (see src/lib/telegramBot.ts). The optional callback receives `true` if
   * the resulting `chat_shared` service message was sent to the bot, or
   * `false` if the user cancelled / Telegram could not deliver it.
   */
  requestChat?: (reqId: string, callback?: (sent: boolean) => void) => void;
}

declare global {
  interface Window {
    Telegram?: {
      WebApp?: TelegramWebApp;
    };
  }
}

/** Minimum Bot API version required for the direct native channel picker. */
export const REQUEST_CHAT_MIN_VERSION = "9.6";

export function getTelegramWebApp(): TelegramWebApp | null {
  if (typeof window === "undefined") return null;
  return window.Telegram?.WebApp ?? null;
}

/** Returns the raw, Telegram-signed `initData` string, or null outside Telegram. */
export function getTelegramInitData(): string | null {
  const webApp = getTelegramWebApp();
  if (!webApp || !webApp.initData) return null;
  return webApp.initData;
}

export function isRunningInsideTelegram(): boolean {
  return !!getTelegramInitData();
}

/**
 * Feature/version detection for the direct native channel picker (Part A.6
 * of the channel connection system). Checked BEFORE ever calling
 * `requestChat` so an older Telegram client is shown an explicit "please
 * update Telegram" message instead of a silent failure or a fallback to the
 * old bot-chat flow (which this product no longer implements).
 */
export function isRequestChatSupported(): boolean {
  const webApp = getTelegramWebApp();
  if (!webApp || typeof webApp.requestChat !== "function") return false;
  if (typeof webApp.isVersionAtLeast === "function") {
    try {
      return webApp.isVersionAtLeast(REQUEST_CHAT_MIN_VERSION);
    } catch {
      // If the client throws on an unrecognized method, treat it as
      // unsupported rather than guessing.
      return false;
    }
  }
  // No isVersionAtLeast but requestChat itself exists: trust its presence,
  // since Telegram does not ship optional/partial WebApp methods.
  return true;
}

/**
 * Opens Telegram's native chat-selection dialog for a prepared `request_id`
 * (see createPreparedChatRequestButton in src/lib/telegramBot.ts) and
 * resolves once Telegram reports whether the selection was sent to the bot.
 * Never throws — any unexpected client error resolves to `false` so callers
 * can treat it the same as a user-cancelled selection.
 */
export function requestChatSelection(preparedButtonId: string): Promise<boolean> {
  return new Promise((resolve) => {
    const webApp = getTelegramWebApp();
    if (!webApp || typeof webApp.requestChat !== "function") {
      resolve(false);
      return;
    }
    try {
      webApp.requestChat(preparedButtonId, (sent) => resolve(!!sent));
    } catch {
      resolve(false);
    }
  });
}
