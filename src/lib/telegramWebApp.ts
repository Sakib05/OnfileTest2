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
