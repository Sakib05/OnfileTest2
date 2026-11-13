// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isRequestChatSupported,
  openTelegramBotLink,
  triggerHaptic,
  requestChatSelection,
  requestChatSelectionDetailed,
} from "@/lib/telegramWebApp";

type Tg = Record<string, unknown>;
function install(webApp: Tg | null) {
  (window as unknown as { Telegram?: unknown }).Telegram = webApp ? { WebApp: webApp } : undefined;
}
afterEach(() => {
  install(null);
  vi.restoreAllMocks();
});

describe("isRequestChatSupported — feature detection", () => {
  it("false outside Telegram", () => {
    expect(isRequestChatSupported()).toBe(false);
  });
  it("false when requestChat is missing", () => {
    install({ isVersionAtLeast: () => true });
    expect(isRequestChatSupported()).toBe(false);
  });
  it("false on a client older than 9.6, even though the script defines requestChat", () => {
    const isVersionAtLeast = vi.fn(() => false);
    install({ requestChat: vi.fn(), isVersionAtLeast });
    expect(isRequestChatSupported()).toBe(false);
    expect(isVersionAtLeast).toHaveBeenCalledWith("9.6");
  });
  it("true on a 9.6+ client", () => {
    install({ requestChat: vi.fn(), isVersionAtLeast: () => true });
    expect(isRequestChatSupported()).toBe(true);
  });
  it("false (not a crash) when isVersionAtLeast throws", () => {
    install({ requestChat: vi.fn(), isVersionAtLeast: () => { throw new Error("boom"); } });
    expect(isRequestChatSupported()).toBe(false);
  });
});

describe("requestChatSelectionDetailed — runtime outcomes", () => {
  it("'sent' when Telegram reports the selection was delivered", async () => {
    install({ requestChat: (_id: string, cb: (s: boolean) => void) => cb(true) });
    expect(await requestChatSelectionDetailed("btn")).toBe("sent");
  });
  it("'not_sent' when the user dismissed the picker (must NOT trigger the fallback)", async () => {
    install({ requestChat: (_id: string, cb: (s: boolean) => void) => cb(false) });
    expect(await requestChatSelectionDetailed("btn")).toBe("not_sent");
  });
  it("'unsupported' when Telegram's script throws WebAppMethodUnsupported", async () => {
    install({ requestChat: () => { throw new Error("WebAppMethodUnsupported"); } });
    expect(await requestChatSelectionDetailed("btn")).toBe("unsupported");
  });
  it("'unsupported' when requestChat does not exist", async () => {
    install({});
    expect(await requestChatSelectionDetailed("btn")).toBe("unsupported");
  });
  it("'error' (never 'unsupported') for any other client error, e.g. a picker already open", async () => {
    install({ requestChat: () => { throw new Error("WebAppRequestChatOpened"); } });
    expect(await requestChatSelectionDetailed("btn")).toBe("error");
  });
  it("legacy boolean wrapper: true only for 'sent'", async () => {
    install({ requestChat: (_id: string, cb: (s: boolean) => void) => cb(true) });
    expect(await requestChatSelection("btn")).toBe(true);
    install({ requestChat: () => { throw new Error("x"); } });
    expect(await requestChatSelection("btn")).toBe(false);
  });
});

describe("openTelegramBotLink", () => {
  it("uses Telegram.WebApp.openTelegramLink when available", () => {
    const openTelegramLink = vi.fn();
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    install({ openTelegramLink });
    expect(openTelegramBotLink("https://t.me/Bot")).toBe(true);
    expect(openTelegramLink).toHaveBeenCalledWith("https://t.me/Bot");
    expect(open).not.toHaveBeenCalled();
  });
  it("returns false (and never uses window.open) when openTelegramLink is missing or throws", () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    install({});
    expect(openTelegramBotLink("https://t.me/Bot?start=x")).toBe(false);
    install({ openTelegramLink: () => { throw new Error("nope"); } });
    expect(openTelegramBotLink("https://t.me/Bot?start=y")).toBe(false);
    expect(open).not.toHaveBeenCalled();
  });
});

describe("triggerHaptic", () => {
  it("maps kinds onto the official HapticFeedback API", () => {
    const impactOccurred = vi.fn();
    const notificationOccurred = vi.fn();
    install({ HapticFeedback: { impactOccurred, notificationOccurred } });
    expect(triggerHaptic("impact")).toBe(true);
    expect(impactOccurred).toHaveBeenCalledWith("light");
    expect(triggerHaptic("success")).toBe(true);
    expect(triggerHaptic("error")).toBe(true);
    expect(triggerHaptic("warning")).toBe(true);
    expect(notificationOccurred.mock.calls.map((c) => c[0])).toEqual(["success", "error", "warning"]);
  });
  it("is a harmless no-op when HapticFeedback is unavailable or throws", () => {
    install({});
    expect(triggerHaptic("success")).toBe(false);
    install({ HapticFeedback: { impactOccurred: () => { throw new Error("boom"); }, notificationOccurred: () => { throw new Error("boom"); } } });
    expect(() => triggerHaptic("impact")).not.toThrow();
    expect(triggerHaptic("error")).toBe(false);
  });
});
