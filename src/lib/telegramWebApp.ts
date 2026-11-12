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
  /** Bot API 6.1+. The native header "Back" arrow (also driven by the Android back gesture). */
  BackButton?: {
    isVisible?: boolean;
    show: () => void;
    hide: () => void;
    onClick: (callback: () => void) => void;
    offClick: (callback: () => void) => void;
  };
  /** Bot API 6.0+. Subscribe to a bridge event, e.g. "viewportChanged". */
  onEvent?: (eventType: string, handler: (...args: unknown[]) => void) => void;
  offEvent?: (eventType: string, handler: (...args: unknown[]) => void) => void;
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
 * Feature/version detection for the direct native channel picker. Checked
 * BEFORE ever calling `requestChat` so a client that cannot open it is
 * offered the "Connect channel via bot" fallback up front. Telegram exposes
 * no dedicated capability flag for `requestChat`; `isVersionAtLeast("9.6")`
 * is the documented gate, and `requestChatSelectionDetailed` additionally
 * catches the runtime `WebAppMethodUnsupported` error as a safety net.
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

export type RequestChatOutcome =
  /** Telegram opened the picker and the selection was delivered to the bot. */
  | "sent"
  /** The picker opened but the user dismissed it / Telegram could not deliver the selection. */
  | "not_sent"
  /** The client does not implement `requestChat` (Telegram's script throws `WebAppMethodUnsupported`). */
  | "unsupported"
  /** Any other client-side error (e.g. a picker is already open). Never treated as "unsupported". */
  | "error";

/**
 * Opens Telegram's native chat-selection dialog for a prepared `request_id`
 * (see createPreparedChatRequestButton in src/lib/telegramBot.ts) and
 * resolves with a precise outcome. Never throws.
 *
 * Why the distinction matters: `telegram-web-app.js` defines `requestChat`
 * on every client, but when the *client* is older than Bot API 9.6 it logs
 * and throws `Error("WebAppMethodUnsupported")` instead of calling back.
 * Only that error means "use the bot-chat fallback"; a cancelled picker or
 * any other error must NOT trigger the fallback.
 */
export function requestChatSelectionDetailed(preparedButtonId: string): Promise<RequestChatOutcome> {
  return new Promise((resolve) => {
    const webApp = getTelegramWebApp();
    if (!webApp || typeof webApp.requestChat !== "function") {
      resolve("unsupported");
      return;
    }
    try {
      webApp.requestChat(preparedButtonId, (sent) => resolve(sent ? "sent" : "not_sent"));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      resolve(message.includes("WebAppMethodUnsupported") ? "unsupported" : "error");
    }
  });
}

/**
 * Backwards-compatible boolean wrapper: resolves once Telegram reports
 * whether the selection was sent to the bot. Any failure resolves `false`.
 */
export async function requestChatSelection(preparedButtonId: string): Promise<boolean> {
  return (await requestChatSelectionDetailed(preparedButtonId)) === "sent";
}

/**
 * Opens a t.me link (here: the Onfile bot chat) inside Telegram. Prefers
 * `Telegram.WebApp.openTelegramLink` (opens the chat natively); only if that
 * is missing or throws does it fall back to `window.open`, which Telegram's
 * in-app webview also routes to the Telegram client for t.me URLs. Returns
 * whether an attempt to open the link was made. NOTE: on clients older than
 * Bot API 7.0 the Mini App is closed when a t.me link opens — Onfile
 * persists the pending request so reopening the Mini App resumes it.
 */
export function openTelegramBotLink(url: string): boolean {
  const webApp = getTelegramWebApp();
  if (webApp && typeof webApp.openTelegramLink === "function") {
    try {
      webApp.openTelegramLink(url);
      return true;
    } catch {
      // fall through to window.open
    }
  }
  if (typeof window !== "undefined") {
    window.open(url, "_blank");
    return true;
  }
  return false;
}
