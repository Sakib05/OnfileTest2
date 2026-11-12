// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isRequestChatSupported,
  openTelegramBotLink,
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
    expect(openTelegramBotLink("https://t.me/Bot?start=c1_a_b")).toBe(true);
    expect(openTelegramLink).toHaveBeenCalledWith("https://t.me/Bot?start=c1_a_b");
    expect(open).not.toHaveBeenCalled();
  });
  it("falls back to window.open when openTelegramLink is missing or throws", () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    install({});
    openTelegramBotLink("https://t.me/Bot?start=x");
    install({ openTelegramLink: () => { throw new Error("nope"); } });
    openTelegramBotLink("https://t.me/Bot?start=y");
    expect(open).toHaveBeenCalledTimes(2);
  });
});
