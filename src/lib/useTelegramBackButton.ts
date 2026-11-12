"use client";
import { useEffect, useRef } from "react";
import { getTelegramWebApp } from "@/lib/telegramWebApp";

/**
 * Shows Telegram's native BackButton (header arrow, also what the Android system back gesture
 * triggers inside a Mini App) while a full-page screen is open, and routes it to `onBack`.
 * Outside Telegram (plain browser) this is a no-op — the in-page Back button and the browser's
 * own back navigation cover that case. The latest `onBack` is always used without re-binding.
 */
export function useTelegramBackButton(onBack: () => void, enabled: boolean = true) {
  const ref = useRef(onBack);
  useEffect(() => {
    ref.current = onBack;
  });

  useEffect(() => {
    if (!enabled) return;
    const button = getTelegramWebApp()?.BackButton;
    if (!button) return;
    const handler = () => ref.current();
    try {
      button.onClick(handler);
      button.show();
    } catch {
      return; // older client without BackButton support
    }
    return () => {
      try {
        button.offClick(handler);
        button.hide();
      } catch {
        /* ignore */
      }
    };
  }, [enabled]);
}
