"use client";
import { useEffect, useRef } from "react";
import { registerNativeBack } from "@/lib/telegramBackButton";

/**
 * Shows Telegram's native BackButton (header arrow, also what the Android system back gesture
 * triggers inside a Mini App) while a nested, full-page screen is open, and routes it to `onBack`.
 * Outside Telegram (plain browser) this is a no-op — the in-page Back button and the browser's
 * own back navigation cover that case. The latest `onBack` is always used without re-binding.
 *
 * Binding is delegated to the shared manager in src/lib/telegramBackButton.ts, so only one
 * click listener is ever attached to Telegram's button and nested screens stack correctly.
 * Pass `enabled = false` on root screens (or whenever no nested page is open) to hide it.
 */
export function useTelegramBackButton(onBack: () => void, enabled: boolean = true) {
  const ref = useRef(onBack);
  useEffect(() => {
    ref.current = onBack;
  });

  useEffect(() => {
    if (!enabled) return;
    return registerNativeBack(ref);
  }, [enabled]);
}
