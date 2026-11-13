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
  /** Bot API 6.1+. Haptic feedback — https://core.telegram.org/bots/webapps#hapticfeedback */
  HapticFeedback?: {
    impactOccurred?: (style: "light" | "medium" | "heavy" | "rigid" | "soft") => unknown;
    notificationOccurred?: (type: "error" | "success" | "warning") => unknown;
    selectionChanged?: () => unknown;
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
 * Opens a t.me link (here: the Onfile bot chat) inside Telegram with the
 * official `Telegram.WebApp.openTelegramLink`. Returns whether Telegram's
 * bridge accepted the call — `false` when not running inside Telegram, when
 * the method is missing, or when it throws, so callers can tell the user
 * instead of failing silently. Deliberately NO `window.open` fallback: a
 * browser redirect is not a supported way to open a t.me link from a Mini App.
 * (`openLink` is documented as user-interaction-only; `openTelegramLink` has
 * no such documented restriction, so calling it after the async request that
 * prepares the bot chat is supported.) NOTE: on clients older than Bot API 7.0
 * the Mini App is closed when a t.me link opens — Onfile persists the pending
 * request so reopening the Mini App resumes it.
 */
export function openTelegramBotLink(url: string): boolean {
  const webApp = getTelegramWebApp();
  if (!webApp || typeof webApp.openTelegramLink !== "function") return false;
  try {
    webApp.openTelegramLink(url);
    return true;
  } catch {
    return false;
  }
}

export type HapticKind =
  /** Subtle tap — used immediately before leaving for the bot chat. */
  | "impact"
  /** Server-confirmed success. */
  | "success"
  /** Important failure. */
  | "error"
  /** Non-fatal problem. */
  | "warning";

/**
 * Official Telegram haptics (`WebApp.HapticFeedback`, Bot API 6.1+). Returns
 * whether a haptic was requested. NEVER throws and never blocks the caller:
 * on clients/browsers without HapticFeedback this is a no-op returning false.
 * (The Mini App can vibrate its own device; a bot message cannot make a device
 * vibrate, and the exact moment the bot's message appears is not observable.)
 */
export function triggerHaptic(kind: HapticKind): boolean {
  try {
    const haptic = getTelegramWebApp()?.HapticFeedback;
    if (!haptic) return false;
    if (kind === "impact") {
      if (typeof haptic.impactOccurred !== "function") return false;
      haptic.impactOccurred("light");
      return true;
    }
    if (typeof haptic.notificationOccurred !== "function") return false;
    haptic.notificationOccurred(kind);
    return true;
  } catch {
    return false;
  }
}
