// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BOT_NAVIGATION_DELAY_MS,
  NAVIGATION_DEBOUNCE_MS,
  cancelBotNavigation,
  hasScheduledBotNavigation,
  navigateToBot,
  resetBotNavigationForTests,
  scheduleBotNavigation,
} from "@/lib/botNavigation";
import { closeTelegramMiniApp } from "@/lib/telegramWebApp";

const URL_ = "https://t.me/ConfiguredOnfileBot";
let calls: string[];

function install(webApp: Record<string, unknown> | null) {
  (window as unknown as { Telegram?: unknown }).Telegram = webApp ? { WebApp: webApp } : undefined;
}
function installFull(over: Record<string, unknown> = {}) {
  install({
    openTelegramLink: (u: string) => void calls.push(`open:${u}`),
    close: () => void calls.push("close"),
    ...over,
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  calls = [];
  resetBotNavigationForTests();
});
afterEach(() => {
  vi.useRealTimers();
  install(null);
  vi.restoreAllMocks();
});

describe("closeTelegramMiniApp", () => {
  it("calls the official Telegram.WebApp.close()", () => {
    installFull();
    expect(closeTelegramMiniApp()).toBe(true);
    expect(calls).toEqual(["close"]);
  });
  it("returns false (no throw) outside Telegram, when close is missing, or when it throws", () => {
    expect(closeTelegramMiniApp()).toBe(false);
    install({});
    expect(closeTelegramMiniApp()).toBe(false);
    install({ close: () => { throw new Error("boom"); } });
    expect(closeTelegramMiniApp()).toBe(false);
  });
  it("never falls back to window.close()", () => {
    const wc = vi.spyOn(window, "close").mockImplementation(() => {});
    install({});
    closeTelegramMiniApp();
    expect(wc).not.toHaveBeenCalled();
  });
});

describe("navigateToBot — the single shared navigation", () => {
  it("opens the bot link FIRST, then closes the Mini App (Bot API 7.0+ no longer closes it by itself)", () => {
    installFull();
    expect(navigateToBot(URL_)).toEqual({ status: "navigated", closed: true });
    expect(calls).toEqual([`open:${URL_}`, "close"]);
  });
  it("reports closed:false (but still navigates) when the client has no close()", () => {
    installFull({ close: undefined });
    expect(navigateToBot(URL_)).toEqual({ status: "navigated", closed: false });
    expect(calls).toEqual([`open:${URL_}`]);
  });
  it("is 'unavailable' and does NOT close when the link cannot be opened (never strands the user)", () => {
    installFull({ openTelegramLink: () => { throw new Error("boom"); } });
    expect(navigateToBot(URL_)).toEqual({ status: "unavailable" });
    install({ close: () => void calls.push("close") });
    expect(navigateToBot(URL_)).toEqual({ status: "unavailable" });
    install(null);
    expect(navigateToBot(URL_)).toEqual({ status: "unavailable" });
    expect(calls).toEqual([]);
  });
  it("ignores a repeat within the debounce window, allows it afterwards", () => {
    installFull();
    expect(navigateToBot(URL_).status).toBe("navigated");
    expect(navigateToBot(URL_).status).toBe("duplicate");
    vi.advanceTimersByTime(NAVIGATION_DEBOUNCE_MS + 1);
    expect(navigateToBot(URL_).status).toBe("navigated");
    expect(calls.filter((c) => c === "close")).toHaveLength(2);
  });
});

describe("scheduleBotNavigation — the automatic redirect", () => {
  it("fires once after the delay (~3 s)", () => {
    installFull();
    const onResult = vi.fn();
    const onBefore = vi.fn(() => void calls.push("before"));
    expect(scheduleBotNavigation("tok", URL_, BOT_NAVIGATION_DELAY_MS, { onBefore, onResult })).toBe(true);
    expect(BOT_NAVIGATION_DELAY_MS).toBe(3000);
    vi.advanceTimersByTime(2999);
    expect(calls).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(calls).toEqual(["before", `open:${URL_}`, "close"]);
    expect(onResult).toHaveBeenCalledWith({ status: "navigated", closed: true });
  });
  it("is idempotent per key: a second schedule neither duplicates nor re-arms, even after it fired", () => {
    installFull();
    expect(scheduleBotNavigation("tok", URL_, 3000)).toBe(true);
    expect(scheduleBotNavigation("tok", URL_, 3000)).toBe(false);
    vi.advanceTimersByTime(3000);
    expect(scheduleBotNavigation("tok", URL_, 3000)).toBe(false);
    vi.advanceTimersByTime(10_000);
    expect(calls.filter((c) => c === "close")).toHaveLength(1);
  });
  it("cancel clears the timer (cleanup) and nothing fires", () => {
    installFull();
    scheduleBotNavigation("tok", URL_, 3000);
    expect(hasScheduledBotNavigation("tok")).toBe(true);
    cancelBotNavigation("tok");
    expect(hasScheduledBotNavigation("tok")).toBe(false);
    vi.advanceTimersByTime(10_000);
    expect(calls).toEqual([]);
    cancelBotNavigation(null); // no throw
  });
  it("does not depend on any component lifecycle and survives a throwing callback", () => {
    installFull();
    scheduleBotNavigation("tok", URL_, 3000, {
      onBefore: () => { throw new Error("ui gone"); },
      onResult: () => { throw new Error("ui gone"); },
    });
    vi.advanceTimersByTime(3000);
    expect(calls).toEqual([`open:${URL_}`, "close"]);
  });
  it("reports 'unavailable' to the UI when Telegram's bridge is missing", () => {
    install(null);
    const onResult = vi.fn();
    scheduleBotNavigation("tok", URL_, 3000, { onResult });
    vi.advanceTimersByTime(3000);
    expect(onResult).toHaveBeenCalledWith({ status: "unavailable" });
  });
});
