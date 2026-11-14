import { vi } from "vitest";

/**
 * Test double for Telegram's native `WebApp.BackButton` (jsdom has no Telegram bridge).
 * `press()` simulates the user tapping the native Back Button (or the Android back gesture).
 * NOTE: this exercises Onfile's wiring only — it is NOT a real Telegram client.
 */
export function installTelegramBackButton(extra: Record<string, unknown> = {}) {
  const listeners = new Set<() => void>();
  const btn = {
    isVisible: false,
    show: vi.fn(() => {
      btn.isVisible = true;
    }),
    hide: vi.fn(() => {
      btn.isVisible = false;
    }),
    onClick: vi.fn((cb: () => void) => void listeners.add(cb)),
    offClick: vi.fn((cb: () => void) => void listeners.delete(cb)),
  };
  (window as unknown as { Telegram: unknown }).Telegram = { WebApp: { initData: "x", BackButton: btn, ...extra } };
  return {
    btn,
    listeners,
    press: () => [...listeners].forEach((l) => l()),
    uninstall: () => {
      delete (window as unknown as { Telegram?: unknown }).Telegram;
    },
  };
}
