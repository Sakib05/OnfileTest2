// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import BotConnectInstructions from "./BotConnectInstructions";
import ChannelConnectFlow from "../ChannelConnectFlow";
import { resetLaunchConnectRefCache } from "@/lib/botConnectClient";
import { resetBotNavigationForTests } from "@/lib/botNavigation";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * UI tests of the bot-guided connection ("Connect channel via bot": single Connect button →
 * bot chat → Return to Onfile → automatic verification). jsdom only: the Telegram bridge is a
 * test double, so these tests prove Onfile's wiring — NOT behaviour of a real Telegram client.
 */

const CHAT_URL = "https://t.me/ConfiguredOnfileBot";
const START_URL = "https://t.me/ConfiguredOnfileBot?start=c1_abc_0123456789abcdef01234567";
const STORAGE_KEY = "onfile_pending_channel_connect";
const REF = 1_073_741_900;

let container: HTMLDivElement;
let root: Root;
let fetchMock: ReturnType<typeof vi.fn>;
let openTelegramLink: ReturnType<typeof vi.fn>;
let close: ReturnType<typeof vi.fn>;
let impactOccurred: ReturnType<typeof vi.fn>;
let notificationOccurred: ReturnType<typeof vi.fn>;
let order: string[];

function installTelegram(opts: { openTelegramLinkImpl?: ((url: string) => void) | null; closeImpl?: null } = {}) {
  order = [];
  openTelegramLink = vi.fn((url: string) => {
    order.push(`open:${url}`);
    opts.openTelegramLinkImpl?.(url);
  });
  close = vi.fn(() => {
    order.push("close");
  });
  impactOccurred = vi.fn();
  notificationOccurred = vi.fn();
  (window as unknown as { Telegram: unknown }).Telegram = {
    WebApp: {
      initData: "query_id=abc&user=%7B%7D&hash=zzz",
      ...(opts.closeImpl === null ? {} : { close }),
      isVersionAtLeast: () => true,
      ...(opts.openTelegramLinkImpl === null ? {} : { openTelegramLink }),
      HapticFeedback: { impactOccurred, notificationOccurred },
      onEvent: vi.fn(),
      offEvent: vi.fn(),
    },
  };
}

type Handler = (init?: RequestInit) => Response | Promise<Response>;
function mockFetch(handlers: Record<string, Handler>) {
  fetchMock = vi.fn((url: string, init?: RequestInit) => {
    const path = String(url).split("?")[0];
    order.push(`fetch:${path}`);
    const h = handlers[path];
    return Promise.resolve(h ? h(init) : new Response(JSON.stringify({ status: "pending" }), { status: 200 }));
  });
  vi.stubGlobal("fetch", fetchMock);
}
const json = (body: unknown, status = 200) => () => new Response(JSON.stringify(body), { status });
const calls = (path: string) => fetchMock.mock.calls.filter((c) => String(c[0]).includes(path));

// The server's expiry is FIXED once the window starts (polls keep returning the same instant).
let windowEnd = 0;
const serverClock = () => ({ expiresAt: new Date(windowEnd).toISOString(), serverTime: new Date().toISOString() });
const startOk = () => json({ token: "tok-1", ref: REF, state: "prepared", botUsername: "ConfiguredOnfileBot" });
const connectOk = (extra: Record<string, unknown> = {}) => () =>
  new Response(
    JSON.stringify({ mode: "existing_chat", botUrl: CHAT_URL, botUsername: "ConfiguredOnfileBot", ref: REF, state: "awaiting_channel_selection", ...serverClock(), ...extra }),
    { status: 200 }
  );
const pendingStatus = (stage = "awaiting_selection", state = "awaiting_channel_selection") => () =>
  new Response(JSON.stringify({ status: "pending", stage, state, ref: REF, ...serverClock() }), { status: 200 });

async function render(node: React.ReactElement) {
  await act(async () => {
    root.render(node);
  });
}
const text = () => container.textContent ?? "";
const button = (label: string) =>
  Array.from(container.querySelectorAll("button")).find((b) => (b.textContent ?? "").trim() === label) as HTMLButtonElement | undefined;
async function click(label: string) {
  const b = button(label);
  expect(b, `button "${label}" should exist`).toBeTruthy();
  await act(async () => {
    b!.click();
  });
}
const advance = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));

let onSuccess: ReturnType<typeof vi.fn<(channel: unknown) => void>>;
const Instructions = () => <BotConnectInstructions onBack={() => {}} onSuccess={onSuccess as never} />;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "setInterval", "clearTimeout", "clearInterval", "Date"] });
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.history.replaceState(null, "", "/");
  resetLaunchConnectRefCache();
  resetBotNavigationForTests();
  windowEnd = Date.now() + 10 * 60_000;
  onSuccess = vi.fn<(channel: unknown) => void>();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  installTelegram();
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
  resetLaunchConnectRefCache();
  delete (window as unknown as { Telegram?: unknown }).Telegram;
});

describe("Single Connect button (no Start step)", () => {
  it("keeps the existing instructions and shows ONE primary button, 'Connect' — the Start button is gone", async () => {
    mockFetch({});
    await render(<Instructions />);
    expect(text()).toContain("Connect Your Telegram Channel");
    for (const title of ["Tap Connect Channel", "Select Your Private Channel", "Review the Requested Permissions", "Add Onfile Bot as an Administrator", "Return to Onfile and Wait for Confirmation"]) {
      expect(text()).toContain(title);
    }
    expect(text()).toContain("Onfile only requests permission for the bot to post messages");
    expect(Array.from(container.querySelectorAll("button")).map((b) => (b.textContent ?? "").trim())).toEqual(["Connect"]);
    expect(button("Start")).toBeUndefined();
    expect(button("Connect Channel")).toBeUndefined();
    expect(button("Connect channel via bot")).toBeUndefined();
    expect(calls("connect-bot-request")).toHaveLength(0); // nothing is created before the tap
  });

  it("one tap on Connect prepares EXACTLY ONE request, then starts the window, shows the countdown and 'Waiting for channel selection'", async () => {
    mockFetch({ "/api/channels/connect-bot-request": startOk(), "/api/channels/connect-bot-start": connectOk(), "/api/channels/connect-status": pendingStatus() });
    await render(<Instructions />);
    await click("Connect");

    expect(calls("connect-bot-request")).toHaveLength(1);
    expect(calls("connect-bot-start")).toHaveLength(1);
    expect(order.indexOf("fetch:/api/channels/connect-bot-request")).toBeLessThan(order.indexOf("fetch:/api/channels/connect-bot-start"));
    expect(JSON.parse(String(calls("connect-bot-start")[0][1]?.body))).toEqual({ token: "tok-1" }); // only the opaque token
    expect(container.querySelector('[data-testid="connect-countdown-value"]')?.textContent).toMatch(/^(10:00|09:5\d)$/);
    expect(text()).toContain("Waiting for channel selection");
    expect(button("Start")).toBeUndefined();
  });

  it("the countdown only starts AFTER the backend prepared + started the request", async () => {
    let release!: () => void;
    mockFetch({
      "/api/channels/connect-bot-request": () => new Promise<Response>((resolve) => (release = () => resolve(new Response(JSON.stringify({ token: "tok-1", ref: REF, botUsername: "ConfiguredOnfileBot" }), { status: 200 })))),
      "/api/channels/connect-bot-start": connectOk(),
      "/api/channels/connect-status": pendingStatus(),
    });
    await render(<Instructions />);
    await click("Connect");
    expect(container.querySelector('[data-testid="connect-countdown"]')).toBeNull();
    expect(button("Connecting…")?.disabled).toBe(true);
    expect(calls("connect-bot-start")).toHaveLength(0);
    release();
    await advance(0);
    expect(container.querySelector('[data-testid="connect-countdown"]')).toBeTruthy();
    expect(calls("connect-bot-start")).toHaveLength(1);
  });

  it("a double tap on Connect creates only ONE request and ONE window", async () => {
    mockFetch({ "/api/channels/connect-bot-request": startOk(), "/api/channels/connect-bot-start": connectOk(), "/api/channels/connect-status": pendingStatus() });
    await render(<Instructions />);
    const b = button("Connect")!;
    await act(async () => {
      b.click();
      b.click();
    });
    await advance(3500);
    expect(calls("connect-bot-request")).toHaveLength(1);
    expect(calls("connect-bot-start")).toHaveLength(1);
    expect(openTelegramLink).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("a failed preparation shows the server's message and offers 'Connect' again (no start call, no navigation)", async () => {
    mockFetch({ "/api/channels/connect-bot-request": json({ error: "Channel connection is temporarily unavailable. Please try again later." }, 502) });
    await render(<Instructions />);
    await click("Connect");
    expect(text()).toContain("temporarily unavailable");
    expect(button("Connect")).toBeTruthy();
    expect(calls("connect-bot-start")).toHaveLength(0);
    await advance(4000);
    expect(openTelegramLink).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
  });

  it("a network error while preparing is explained and recoverable", async () => {
    mockFetch({ "/api/channels/connect-bot-request": () => Promise.reject(new Error("offline")) as unknown as Response });
    await render(<Instructions />);
    await click("Connect");
    expect(text()).toContain("Network error");
    expect(button("Connect")).toBeTruthy();
  });
});

describe("Connect → countdown → ~3 s → bot chat opens AND the Mini App is closed", () => {
  async function renderReady(connect: Handler = connectOk()) {
    mockFetch({ "/api/channels/connect-bot-request": startOk(), "/api/channels/connect-bot-start": connect, "/api/channels/connect-status": pendingStatus() });
    await render(<Instructions />);
  }

  it("waits ~3 s, THEN calls openTelegramLink(botUrl) and, right after, the official Telegram.WebApp.close()", async () => {
    await renderReady();
    await click("Connect");
    expect(openTelegramLink).not.toHaveBeenCalled();

    await advance(2900);
    expect(openTelegramLink).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    await advance(200);
    expect(openTelegramLink).toHaveBeenCalledTimes(1);
    expect(openTelegramLink).toHaveBeenCalledWith(CHAT_URL);
    expect(close).toHaveBeenCalledTimes(1);
    // order: backend start → open bot chat → close Mini App
    const startIdx = order.indexOf("fetch:/api/channels/connect-bot-start");
    const openIdx = order.findIndex((o) => o.startsWith("open:"));
    const closeIdx = order.indexOf("close");
    expect(startIdx).toBeLessThan(openIdx);
    expect(openIdx).toBeLessThan(closeIdx);
    expect(text()).toContain("Waiting for channel selection");
  });

  it("never uses window.close() as a substitute", async () => {
    const windowClose = vi.spyOn(window, "close").mockImplementation(() => {});
    await renderReady();
    await click("Connect");
    await advance(3200);
    expect(windowClose).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("first-time user: opens the signed Start deep link returned by the server, then closes", async () => {
    await renderReady(connectOk({ mode: "start_link", botUrl: START_URL }));
    await click("Connect");
    await advance(3200);
    expect(openTelegramLink).toHaveBeenCalledWith(START_URL);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("the countdown follows the server expiry and ticks", async () => {
    await renderReady();
    await click("Connect");
    await advance(3100);
    await advance(60_000);
    const value = container.querySelector('[data-testid="connect-countdown-value"]')!.textContent!;
    expect(value).toMatch(/^08:5\d$/);
  });

  it("a transient backend failure (502) keeps ONE prepared request: 'Connect' retries WITHOUT creating a second request", async () => {
    let attempt = 0;
    await renderReady(() => {
      attempt += 1;
      return attempt === 1
        ? new Response(JSON.stringify({ error: "We couldn't reach Telegram right now. Please try again shortly.", reason: "telegram_api_error" }), { status: 502 })
        : connectOk()();
    });
    await click("Connect");
    await advance(4000);
    expect(openTelegramLink).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    expect(text()).toContain("couldn't reach Telegram");
    expect(container.querySelector('[data-testid="connect-countdown"]')).toBeNull();
    expect(calls("connect-bot-request")).toHaveLength(1);

    await click("Connect"); // retry
    expect(calls("connect-bot-request")).toHaveLength(1); // still only ONE pending request
    expect(calls("connect-bot-start")).toHaveLength(2);
    expect(JSON.parse(String(calls("connect-bot-start")[1][1]?.body))).toEqual({ token: "tok-1" }); // same token reused
    await advance(3200);
    expect(openTelegramLink).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("an expired/cancelled request on start is terminal and restarts with 'Connect'", async () => {
    await renderReady(json({ status: "expired", state: "expired", error: "This connection request expired. Please start again." }, 410));
    await click("Connect");
    expect(text()).toContain("expired");
    expect(button("Connect")).toBeTruthy();
    expect(openTelegramLink).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
  });

  it("Telegram refusing the navigation is surfaced with a manual link — never silent, never window.open, and the Mini App stays open", async () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    installTelegram({ openTelegramLinkImpl: () => { throw new Error("boom"); } });
    await renderReady();
    await click("Connect");
    await advance(3200);
    expect(container.querySelector('[data-testid="bot-open-failed"]')).toBeTruthy();
    expect(text()).toContain("@ConfiguredOnfileBot");
    expect(container.querySelector<HTMLAnchorElement>('[data-testid="bot-open-link"]')?.getAttribute("href")).toBe(CHAT_URL);
    expect(open).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled(); // closing without having navigated would strand the user
    expect(notificationOccurred).toHaveBeenCalledWith("warning");
  });

  it("a Mini App with no openTelegramLink at all falls back to the manual link too (no throw)", async () => {
    installTelegram({ openTelegramLinkImpl: null });
    await renderReady();
    await click("Connect");
    await advance(3200);
    expect(container.querySelector('[data-testid="bot-open-failed"]')).toBeTruthy();
    expect(close).not.toHaveBeenCalled();
  });

  it("a Telegram client WITHOUT WebApp.close() is handled gracefully: the chat still opens, nothing throws, the link appears", async () => {
    installTelegram({ closeImpl: null });
    await renderReady();
    await click("Connect");
    await advance(3200);
    expect(openTelegramLink).toHaveBeenCalledWith(CHAT_URL);
    expect(container.querySelector('[data-testid="bot-open-failed"]')).toBeNull();
    await advance(4200);
    expect(container.querySelector('[data-testid="bot-open-link"]')).toBeTruthy();
  });

  it("if the Mini App is still in the foreground a few seconds after navigating, the fallback link appears (user is never stuck)", async () => {
    await renderReady();
    await click("Connect");
    await advance(3200);
    expect(container.querySelector('[data-testid="bot-open-link"]')).toBeNull();
    await advance(4200);
    expect(container.querySelector('[data-testid="bot-open-link"]')).toBeTruthy();
    expect(text()).toContain("Didn't switch to Telegram? Tap here to open @ConfiguredOnfileBot");
    expect(container.querySelector('[data-testid="bot-open-failed"]')).toBeNull(); // navigation itself was accepted
  });

  it("the fallback link runs the SAME navigation: open the bot chat, then close the Mini App", async () => {
    await renderReady();
    await click("Connect");
    await advance(3200 + 4200);
    expect(openTelegramLink).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);

    const link = container.querySelector<HTMLAnchorElement>('[data-testid="bot-open-link"]')!;
    const ev = new MouseEvent("click", { bubbles: true, cancelable: true });
    await act(async () => {
      link.dispatchEvent(ev);
    });
    expect(openTelegramLink).toHaveBeenCalledTimes(2);
    expect(openTelegramLink).toHaveBeenLastCalledWith(CHAT_URL);
    expect(close).toHaveBeenCalledTimes(2);
    expect(ev.defaultPrevented).toBe(true); // handled by Telegram's API, not the browser
    expect(calls("connect-bot-request")).toHaveLength(1); // no duplicate backend operation
    expect(calls("connect-bot-start")).toHaveLength(1);
  });

  it("repeated taps on the fallback link do not navigate twice", async () => {
    await renderReady();
    await click("Connect");
    await advance(3200 + 4200);
    const link = container.querySelector<HTMLAnchorElement>('[data-testid="bot-open-link"]')!;
    await act(async () => {
      link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    expect(openTelegramLink).toHaveBeenCalledTimes(2); // 1 automatic + 1 manual
    expect(close).toHaveBeenCalledTimes(2);
  });

  it("unmounting the screen during the 3 s wait does NOT silently cancel the hand-off", async () => {
    const c2 = document.createElement("div");
    document.body.appendChild(c2);
    const r2 = createRoot(c2);
    mockFetch({ "/api/channels/connect-bot-request": startOk(), "/api/channels/connect-bot-start": connectOk(), "/api/channels/connect-status": pendingStatus() });
    await act(async () => r2.render(<Instructions />));
    await act(async () => {
      Array.from(c2.querySelectorAll("button")).find((b) => b.textContent?.trim() === "Connect")!.click();
    });
    expect(calls("connect-bot-start")).toHaveLength(1);
    await act(async () => r2.unmount());
    c2.remove();
    await advance(3200);
    expect(openTelegramLink).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("Cancel during the 3 s wait cancels the automatic hand-off (and tells the server)", async () => {
    mockFetch({
      "/api/channels/connect-bot-request": startOk(),
      "/api/channels/connect-bot-start": connectOk(),
      "/api/channels/connect-status": pendingStatus(),
      "/api/channels/connect-cancel": json({ ok: true }),
    });
    await render(<Instructions />);
    await click("Connect");
    await advance(1000);
    await click("Cancel");
    await advance(5000);
    expect(openTelegramLink).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    expect(calls("connect-cancel")).toHaveLength(1);
  });

  it("fires a subtle haptic right before navigating", async () => {
    await renderReady();
    await click("Connect");
    await advance(3200);
    expect(impactOccurred).toHaveBeenCalledWith("light");
  });
});

describe("Steps D–F — return to Onfile and automatic verification", () => {
  async function toWaiting(statusImpl: Handler = pendingStatus()) {
    mockFetch({
      "/api/channels/connect-bot-request": startOk(),
      "/api/channels/connect-bot-start": connectOk(),
      "/api/channels/connect-status": statusImpl,
    });
    await render(<Instructions />);
    await click("Connect");
    await advance(3200);
  }

  it("verifies automatically when the user comes back (no manual 'check' button) and reports success exactly once", async () => {
    let body: unknown = { status: "pending", stage: "awaiting_selection", state: "awaiting_channel_selection", ...serverClock() };
    await toWaiting(() => new Response(JSON.stringify(body), { status: 200 }));
    expect(button("Check")).toBeUndefined();
    expect(onSuccess).not.toHaveBeenCalled();

    body = { status: "verified", channel: { id: 3, channelName: "My Private Channel", status: "verified" } };
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onSuccess).toHaveBeenCalledWith(expect.objectContaining({ channelName: "My Private Channel" }));
    expect(notificationOccurred).toHaveBeenCalledWith("success");

    const n = calls("connect-status").length;
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    await advance(10_000);
    expect(calls("connect-status")).toHaveLength(n); // tracking stopped
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("polls at a calm interval while waiting (no request flood)", async () => {
    await toWaiting();
    const n0 = calls("connect-status").length;
    await advance(30_000);
    const made = calls("connect-status").length - n0;
    expect(made).toBeGreaterThanOrEqual(8);
    expect(made).toBeLessThanOrEqual(11);
  });

  it("shows 'verifying' once the server reports the channel was selected", async () => {
    await toWaiting(pendingStatus("verifying", "verifying"));
    await advance(100);
    expect(text()).toContain("Channel selected — verifying");
  });

  it("a freshly launched Mini App (Return to Onfile → /?connect=<ref>, empty storage) resumes from the server state and verifies", async () => {
    window.history.replaceState(null, "", `/?connect=${REF}#tgWebAppData=x`);
    resetLaunchConnectRefCache();
    let body: unknown = { status: "pending", stage: "awaiting_selection", state: "awaiting_channel_selection", ref: REF, ...serverClock() };
    mockFetch({ "/api/channels/connect-status": () => new Response(JSON.stringify(body), { status: 200 }) });
    await render(<Instructions />);
    await advance(0);
    // Requested by ref, not by a token this fresh WebView doesn't have.
    expect(String(calls("connect-status")[0][0])).toContain(`ref=${REF}`);
    expect(text()).toContain("Waiting for channel selection");
    expect(calls("connect-bot-request")).toHaveLength(0); // no NEW request is created on return
    expect(calls("connect-bot-start")).toHaveLength(0);

    body = { status: "verified", channel: { id: 9, channelName: "Returned Channel", status: "verified" }, ref: REF };
    await advance(3100);
    expect(onSuccess).toHaveBeenCalledWith(expect.objectContaining({ channelName: "Returned Channel" }));
    expect(window.location.search).not.toContain("connect="); // reload won't resume a finished request
  });

  it("a Mini App reopened with a stored token (no URL ref) resumes too, without opening the chat again", async () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ token: "tok-1", ref: REF, deadline: Date.now() + 5 * 60_000, botUrl: CHAT_URL, mode: "existing_chat" }));
    mockFetch({ "/api/channels/connect-status": pendingStatus() });
    await render(<Instructions />);
    await advance(0);
    expect(String(calls("connect-status")[0][0])).toContain("token=tok-1");
    expect(text()).toContain("Waiting for channel selection");
    expect(openTelegramLink).not.toHaveBeenCalled();
  });

  it("a stored 'prepared' request resumes at the Connect button and Connect REUSES it (no second request)", async () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ token: "tok-1", ref: REF, deadline: Date.now() + 5 * 60_000 }));
    mockFetch({ "/api/channels/connect-status": pendingStatus("awaiting_selection", "prepared"), "/api/channels/connect-bot-start": connectOk() });
    await render(<Instructions />);
    await advance(0);
    expect(button("Connect")).toBeTruthy();
    expect(button("Start")).toBeUndefined();
    await click("Connect");
    expect(calls("connect-bot-request")).toHaveLength(0); // the prepared request is reused, never duplicated
    expect(JSON.parse(String(calls("connect-bot-start")[0][1]?.body))).toEqual({ token: "tok-1" });
    await advance(3200);
    expect(openTelegramLink).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("expiry is decided by the server: the local countdown reaching 00:00 only triggers a status check", async () => {
    await toWaiting();
    await advance(10 * 60_000 + 1000);
    expect(container.querySelector('[data-testid="connect-countdown-value"]')?.textContent).toBe("00:00");
    expect(text()).not.toContain("expired"); // server still says pending → still waiting
  });

  it("an expired request (server says so) shows the expiry message and restarts with 'Connect'", async () => {
    let status: Handler = pendingStatus();
    await toWaiting((i) => status(i));
    status = json({ status: "expired", state: "expired" }, 404);
    await advance(3100);
    expect(text()).toContain("expired");
    expect(button("Connect")).toBeTruthy();
    expect(onSuccess).not.toHaveBeenCalled();
    expect(notificationOccurred).toHaveBeenCalledWith("error");
  });

  it("a backend verification failure is shown (never success) and can be retried with 'Connect'", async () => {
    await toWaiting(json({ status: "failed", reason: "bot_not_admin", error: "Our bot is in the channel but needs to be an administrator." }));
    await advance(100);
    expect(text()).toContain("needs to be an administrator");
    expect(button("Connect")).toBeTruthy();
    expect(text()).not.toContain("Congratulations");
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("a request owned by another Telegram user is never shown as success", async () => {
    await toWaiting(json({ status: "unauthorized", error: "Your Telegram session expired. Please reopen Onfile and try again." }, 401));
    await advance(100);
    expect(text()).toContain("session expired");
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("temporary network errors keep retrying quietly and recover", async () => {
    let fail = true;
    await toWaiting(() => (fail ? (Promise.reject(new Error("offline")) as unknown as Response) : pendingStatus()()));
    await advance(100);
    expect(text()).toContain("retrying automatically");
    expect(text()).toContain("Waiting for channel selection");
    fail = false;
    await advance(3100);
    expect(text()).not.toContain("retrying automatically");
  });

  it("Cancel abandons the request on the server and returns to 'Connect'", async () => {
    mockFetch({
      "/api/channels/connect-bot-request": startOk(),
      "/api/channels/connect-bot-start": connectOk(),
      "/api/channels/connect-status": pendingStatus(),
      "/api/channels/connect-cancel": json({ ok: true }),
    });
    await render(<Instructions />);
    await click("Connect");
    await advance(3200);
    await click("Cancel");
    expect(calls("connect-cancel")).toHaveLength(1);
    expect(JSON.parse(String(calls("connect-cancel")[0][1]?.body))).toEqual({ token: "tok-1" });
    expect(button("Connect")).toBeTruthy();
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});

describe("Channel Management (ChannelConnectFlow) uses the same flow", () => {
  it("Connect → success shows the congratulations with the real channel name", async () => {
    mockFetch({
      "/api/channels/connect-bot-request": startOk(),
      "/api/channels/connect-bot-start": connectOk(),
      "/api/channels/connect-status": () => new Response(JSON.stringify({ status: "verified", channel: { id: 3, channelName: "My Private Channel", status: "verified" } }), { status: 200 }),
    });
    await render(<ChannelConnectFlow />);
    expect(button("Start")).toBeUndefined();
    expect(button("Connect")).toBeTruthy();
    await click("Connect");
    await advance(3200);
    expect(text()).toContain("🎉 Congratulations! Your channel is now connected to your Onfile account.");
    expect(text()).toContain("My Private Channel");
  });

  it("outside Telegram it asks the user to open Onfile from Telegram", async () => {
    delete (window as unknown as { Telegram?: unknown }).Telegram;
    mockFetch({});
    await render(<ChannelConnectFlow />);
    expect(text()).toContain("Open Onfile from inside Telegram");
    expect(button("Start")).toBeUndefined();
  });
});
