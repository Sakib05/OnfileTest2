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
  ready: () => void;
  expand: () => void;
  colorScheme?: "light" | "dark";
  /** Opens a t.me link. Does not close the Mini App (Bot API 7.0+). */
  openTelegramLink?: (url: string) => void;
  openLink?: (url: string) => void;
}

declare global {
  interface Window {
    Telegram?: {
      WebApp?: TelegramWebApp;
    };
  }
}

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
 * Opens the user's private chat with a bot, from inside the Mini App. Since
 * Bot API 7.0, calling `openTelegramLink` no longer closes the Mini App, so
 * the app stays resumable while the user interacts with Telegram's native
 * chat-selection / add-bot-as-admin screens. Falls back to a regular
 * `window.open` outside of Telegram (e.g. during local development).
 */
export function openBotChat(botUsername: string): void {
  const url = `https://t.me/${botUsername}`;
  const webApp = getTelegramWebApp();
  if (webApp?.openTelegramLink) {
    webApp.openTelegramLink(url);
    return;
  }
  if (typeof window !== "undefined") {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}
