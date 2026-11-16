// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import * as botConnectClient from "@/lib/botConnectClient";
import {
  clearLaunchConnectRef,
  formatCountdown,
  getLaunchConnectRef,
  readConnectRefFromLocation,
  remainingSeconds,
  resetLaunchConnectRefCache,
} from "@/lib/botConnectClient";

afterEach(() => {
  resetLaunchConnectRefCache();
  window.history.replaceState(null, "", "/");
});

describe("bot-guided connect client helpers", () => {
  it("no artificial navigation delay is exported any more", () => {
    expect("BOT_NAVIGATION_DELAY_MS" in botConnectClient).toBe(false);
  });

  it("formats the countdown as mm:ss", () => {
    expect(formatCountdown(600)).toBe("10:00");
    expect(formatCountdown(65)).toBe("01:05");
    expect(formatCountdown(0)).toBe("00:00");
    expect(formatCountdown(-5)).toBe("00:00");
  });

  it("remaining time follows the SERVER clock (offset), never below zero", () => {
    const now = 1_000_000;
    // Device clock is 5 minutes behind the server: expiry is 10 min after server time.
    const clock = { expiresAt: now + 5 * 60_000 + 10 * 60_000, offset: 5 * 60_000 };
    expect(remainingSeconds(clock, now)).toBe(600);
    expect(remainingSeconds({ expiresAt: now - 1, offset: 0 }, now)).toBe(0);
  });

  it("reads only a plain positive integer ref from the launch URL", () => {
    expect(readConnectRefFromLocation("?connect=1073741900")).toBe(1073741900);
    expect(readConnectRefFromLocation("?connect=abc")).toBeNull();
    expect(readConnectRefFromLocation("?connect=-5")).toBeNull();
    expect(readConnectRefFromLocation("?connect=1;drop")).toBeNull();
    expect(readConnectRefFromLocation("?connect=12345678901")).toBeNull();
    expect(readConnectRefFromLocation("")).toBeNull();
  });

  it("the launch ref is cached, and cleared (including from the address bar) once the request is concluded", () => {
    window.history.replaceState(null, "", "/?connect=1073741900&x=1#tgWebAppData=abc");
    expect(getLaunchConnectRef()).toBe(1073741900);
    window.history.replaceState(null, "", "/"); // cached: independent of the URL afterwards
    expect(getLaunchConnectRef()).toBe(1073741900);

    window.history.replaceState(null, "", "/?connect=1073741900&x=1#tgWebAppData=abc");
    clearLaunchConnectRef();
    expect(getLaunchConnectRef()).toBeNull();
    expect(window.location.search).toBe("?x=1");
    expect(window.location.hash).toBe("#tgWebAppData=abc"); // Telegram's launch data is untouched
  });
});
