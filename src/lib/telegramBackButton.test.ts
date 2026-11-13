// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nativeBackDepth, registerNativeBack } from "@/lib/telegramBackButton";

/** Shared manager for Telegram's native BackButton. */

function installBackButton() {
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
  (window as unknown as { Telegram: unknown }).Telegram = { WebApp: { initData: "x", BackButton: btn, CloseButton: undefined } };
  return { btn, listeners, press: () => [...listeners].forEach((l) => l()) };
}
const ref = (fn: () => void) => ({ current: fn });

let tg: ReturnType<typeof installBackButton>;
beforeEach(() => {
  tg = installBackButton();
});
afterEach(() => {
  delete (window as unknown as { Telegram?: unknown }).Telegram;
  expect(nativeBackDepth()).toBe(0); // every test must leave nothing registered
});

describe("native BackButton manager", () => {
  it("root screens (nothing registered): button is never shown and no listener is bound", () => {
    expect(tg.btn.show).not.toHaveBeenCalled();
    expect(tg.btn.onClick).not.toHaveBeenCalled();
    expect(tg.listeners.size).toBe(0);
  });

  it("registering a nested screen shows the button and binds exactly ONE listener", () => {
    const back = vi.fn();
    const off = registerNativeBack(ref(back));
    expect(tg.btn.isVisible).toBe(true);
    expect(tg.listeners.size).toBe(1);
    tg.press();
    expect(back).toHaveBeenCalledTimes(1);
    off();
  });

  it("cleanup removes the listener and hides the button", () => {
    const off = registerNativeBack(ref(() => {}));
    off();
    expect(tg.listeners.size).toBe(0);
    expect(tg.btn.offClick).toHaveBeenCalledTimes(1);
    expect(tg.btn.isVisible).toBe(false);
  });

  it("no duplicate handlers: with several screens mounted only the TOPMOST handles a tap, through a single listener", () => {
    const lower = vi.fn();
    const upper = vi.fn();
    const offLower = registerNativeBack(ref(lower));
    const offUpper = registerNativeBack(ref(upper));
    expect(tg.listeners.size).toBe(1);
    expect(tg.btn.onClick).toHaveBeenCalledTimes(1);
    tg.press();
    expect(upper).toHaveBeenCalledTimes(1);
    expect(lower).not.toHaveBeenCalled();

    // The upper screen goes away: the button stays visible and the lower screen takes over.
    offUpper();
    expect(tg.btn.isVisible).toBe(true);
    tg.press();
    expect(lower).toHaveBeenCalledTimes(1);
    expect(upper).toHaveBeenCalledTimes(1);

    offLower();
    expect(tg.btn.isVisible).toBe(false);
    expect(tg.listeners.size).toBe(0);
  });

  it("the latest handler is used without re-registering (ref semantics)", () => {
    const first = vi.fn();
    const second = vi.fn();
    const r = ref(first);
    const off = registerNativeBack(r);
    r.current = second;
    tg.press();
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    expect(tg.btn.onClick).toHaveBeenCalledTimes(1);
    off();
  });

  it("calling the unregister function twice is harmless", () => {
    const off = registerNativeBack(ref(() => {}));
    off();
    expect(() => off()).not.toThrow();
  });

  it("never touches the Close Button and tolerates clients without BackButton", () => {
    (window as unknown as { Telegram: unknown }).Telegram = { WebApp: { initData: "x" } };
    const off = registerNativeBack(ref(() => {}));
    expect(() => off()).not.toThrow();
  });
});
