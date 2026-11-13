// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import BotConnectInstructions from "./BotConnectInstructions";
import ChannelConnectFlow from "../ChannelConnectFlow";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// First-time / blocked user: signed start deep link. Returning user: plain chat link (NO "?start=").
const START_URL = "https://t.me/ConfiguredOnfileBot?start=c1_abc_0123456789abcdef01234567";
const CHAT_URL = "https://t.me/ConfiguredOnfileBot";
const BOT_URL = START_URL;
const STORAGE_KEY = "onfile_pending_channel_connect";

let container: HTMLDivElement;
let root: Root;
let fetchMock: ReturnType<typeof vi.fn>;

interface TgOpts {
  supported: boolean;
  requestChat?: (id: string, cb: (sent: boolean) => void) => void;
  /** Provide Telegram.WebApp.HapticFeedback (default true). */
  haptic?: boolean;
  /** Override openTelegramLink (e.g. to throw); `null` removes it entirely. */
  openTelegramLinkImpl?: ((url: string) => void) | null;
}
let openTelegramLink: ReturnType<typeof vi.fn>;
let requestChat: ReturnType<typeof vi.fn>;
let impactOccurred: ReturnType<typeof vi.fn>;
let notificationOccurred: ReturnType<typeof vi.fn>;

function installTelegram({ supported, requestChat: impl, haptic = true, openTelegramLinkImpl }: TgOpts) {
  openTelegramLink = vi.fn(openTelegramLinkImpl ?? undefined);
  impactOccurred = vi.fn();
  notificationOccurred = vi.fn();
  requestChat = vi.fn(impl ?? ((_id: string, cb: (s: boolean) => void) => cb(true)));
  (window as unknown as { Telegram: unknown }).Telegram = {
    WebApp: {
      initData: "query_id=abc&user=%7B%7D&hash=zzz",
      requestChat,
      isVersionAtLeast: () => supported,
      ...(openTelegramLinkImpl === null ? {} : { openTelegramLink }),
      ...(haptic ? { HapticFeedback: { impactOccurred, notificationOccurred } } : {}),
    },
  };
}

type Handler = () => Response | Promise<Response>;
function mockFetch(handlers: Record<string, Handler>) {
  fetchMock = vi.fn((url: string) => {
    const path = String(url).split("?")[0];
    const h = handlers[path];
    return Promise.resolve(h ? h() : new Response(JSON.stringify({ status: "pending" }), { status: 200 }));
  });
  vi.stubGlobal("fetch", fetchMock);
}
const json = (body: unknown, status = 200) => () => new Response(JSON.stringify(body), { status });
const statusCalls = () => fetchMock.mock.calls.filter((c) => String(c[0]).includes("connect-status")).length;
const botRequestCalls = () => fetchMock.mock.calls.filter((c) => String(c[0]).includes("connect-bot-request")).length;

async function render(node: React.ReactElement) {
  await act(async () => {
    root.render(node);
  });
}
const text = () => container.textContent ?? "";
const button = (label: string) =>
  Array.from(container.querySelectorAll("button")).find((b) => (b.textContent ?? "").includes(label)) as HTMLButtonElement | undefined;
async function click(label: string) {
  const b = button(label);
  expect(b, `button "${label}" should exist`).toBeTruthy();
  await act(async () => {
    b!.click();
  });
}
const Instructions = () => <BotConnectInstructions onBack={() => {}} onSuccess={() => {}} />;

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  delete (window as unknown as { Telegram?: unknown }).Telegram;
});

describe("New Telegram client — Direct Picker is preserved", () => {
  it("shows the Direct Picker button and NO bot fallback or update message", async () => {
    installTelegram({ supported: true });
    mockFetch({});
    await render(<Instructions />);
    expect(button("Connect Channel")).toBeTruthy();
    expect(text()).not.toContain("Connect channel via bot");
    expect(text()).not.toContain("Update Required");
  });

  it("tapping Connect Channel prepares a request and opens the native picker with the prepared button id", async () => {
    installTelegram({ supported: true });
    mockFetch({ "/api/channels/connect-request": json({ token: "tok", preparedButtonId: "prep-1" }) });
    await render(<Instructions />);
    await click("Connect Channel");
    expect(fetchMock).toHaveBeenCalledWith("/api/channels/connect-request", { method: "POST" });
    expect(requestChat).toHaveBeenCalledWith("prep-1", expect.any(Function));
    expect(openTelegramLink).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("connect-bot-request"))).toBe(false);
    expect(text()).not.toContain("Connect channel via bot");
  });

  it("a cancelled picker does NOT trigger the bot fallback", async () => {
    installTelegram({ supported: true, requestChat: (_id, cb) => cb(false) });
    mockFetch({ "/api/channels/connect-request": json({ token: "tok", preparedButtonId: "prep-1" }) });
    await render(<Instructions />);
    await click("Connect Channel");
    expect(text()).toContain("Channel selection was cancelled");
    expect(text()).not.toContain("Connect channel via bot");
  });

  it("a server error does NOT trigger the bot fallback", async () => {
    installTelegram({ supported: true });
    mockFetch({ "/api/channels/connect-request": json({ error: "We couldn't reach Telegram right now." }, 502) });
    await render(<Instructions />);
    await click("Connect Channel");
    expect(text()).toContain("We couldn't reach Telegram right now.");
    expect(text()).not.toContain("Connect channel via bot");
  });

  it("a network error does NOT trigger the bot fallback", async () => {
    installTelegram({ supported: true });
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("offline"))));
    await render(<Instructions />);
    await click("Connect Channel");
    expect(text()).toContain("Network error");
    expect(text()).not.toContain("Connect channel via bot");
  });
});

describe("Old Telegram client — bot fallback (single primary action)", () => {
  const returning = { token: "bot-tok", mode: "existing_chat", botUrl: CHAT_URL, botUsername: "ConfiguredOnfileBot" };
  const firstTime = { token: "bot-tok", mode: "start_link", fallbackReason: "no_chat", botUrl: START_URL, botUsername: "ConfiguredOnfileBot" };

  it("shows ONLY the orange 'Connect channel via bot' button — no explanatory card, forced-update message or Direct Picker button", async () => {
    installTelegram({ supported: false });
    mockFetch({});
    await render(<Instructions />);
    expect(button("Connect channel via bot")).toBeTruthy();
    expect(text()).not.toContain("Connect through the Onfile Bot");
    expect(text()).not.toContain("Direct channel selection isn't available");
    expect(text()).not.toContain("no Telegram update needed");
    expect(text()).not.toContain("Update Required");
    expect(button("Connect Channel")).toBeUndefined();
    expect(requestChat).not.toHaveBeenCalled();
  });

  it("returning user: one tap prepares the request and automatically opens the PLAIN bot chat link (no ?start=)", async () => {
    installTelegram({ supported: false });
    mockFetch({ "/api/channels/connect-bot-request": json(returning) });
    await render(<Instructions />);
    await click("Connect channel via bot");

    expect(fetchMock).toHaveBeenCalledWith("/api/channels/connect-bot-request", { method: "POST" });
    expect(openTelegramLink).toHaveBeenCalledTimes(1);
    expect(openTelegramLink).toHaveBeenCalledWith(CHAT_URL);
    expect(openTelegramLink.mock.calls[0][0]).not.toContain("?start=");
    expect(openTelegramLink.mock.calls[0][0]).not.toContain("start=");
    expect(requestChat).not.toHaveBeenCalled();
    expect(botRequestCalls()).toBe(1);
  });

  it("first-time user: opens the signed Start deep link returned by the server", async () => {
    installTelegram({ supported: false });
    mockFetch({ "/api/channels/connect-bot-request": json(firstTime) });
    await render(<Instructions />);
    await click("Connect channel via bot");
    expect(openTelegramLink).toHaveBeenCalledTimes(1);
    expect(openTelegramLink).toHaveBeenCalledWith(START_URL);
  });

  it("waiting screen is minimal: small loader + 'Waiting for channel selection...' and NO instruction card", async () => {
    installTelegram({ supported: false });
    mockFetch({ "/api/channels/connect-bot-request": json(returning) });
    await render(<Instructions />);
    await click("Connect channel via bot");

    expect(text()).toContain("Waiting for channel selection...");
    expect(container.querySelector("[data-testid=bot-waiting] .animate-spin")).toBeTruthy();
    expect(text()).not.toContain("tap Start");
    expect(text()).not.toContain("Tap Start");
    expect(text()).not.toContain("Come back to Onfile");
    expect(container.querySelector("ol")).toBeNull();
    expect(button("check status")).toBeTruthy();
  });

  it("'Open bot chat again' does not exist in any bot-fallback state", async () => {
    installTelegram({ supported: false });
    mockFetch({ "/api/channels/connect-bot-request": json(returning) });
    await render(<Instructions />);
    expect(text()).not.toContain("Open bot chat again");
    await click("Connect channel via bot");
    expect(text()).not.toContain("Open bot chat again");
    expect(button("Open bot chat")).toBeUndefined();
    expect(button("Open bot")).toBeUndefined();
    // Failure state too.
    await act(async () => root.unmount());
    root = createRoot(container);
    window.localStorage.clear();
    window.sessionStorage.clear();
    installTelegram({ supported: false });
    mockFetch({ "/api/channels/connect-bot-request": json({ error: "Nope" }, 502) });
    await render(<Instructions />);
    await click("Connect channel via bot");
    expect(text()).not.toContain("Open bot chat again");
  });

  it("Telegram refusing to open the chat is surfaced (no silent failure, no window.open)", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    installTelegram({ supported: false, openTelegramLinkImpl: () => { throw new Error("refused"); } });
    mockFetch({ "/api/channels/connect-bot-request": json(returning) });
    await render(<Instructions />);
    await click("Connect channel via bot");
    expect(container.querySelector("[data-testid=bot-open-failed]")?.textContent).toContain("@ConfiguredOnfileBot");
    expect(open).not.toHaveBeenCalled();
    expect(button("Open bot chat again")).toBeUndefined();
    open.mockRestore();
  });

  it("double tap creates only ONE request and opens only ONE chat", async () => {
    installTelegram({ supported: false });
    mockFetch({ "/api/channels/connect-bot-request": json(returning) });
    await render(<Instructions />);
    const b = button("Connect channel via bot")!;
    await act(async () => {
      b.click();
      b.click();
    });
    expect(botRequestCalls()).toBe(1);
    expect(openTelegramLink).toHaveBeenCalledTimes(1);
  });

  it("persists the pending bot request so reopening the Mini App resumes it (without re-opening the chat)", async () => {
    installTelegram({ supported: false });
    mockFetch({ "/api/channels/connect-bot-request": json(returning) });
    await render(<Instructions />);
    await click("Connect channel via bot");
    const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY)!);
    expect(saved).toMatchObject({ token: "bot-tok", method: "bot", botUrl: CHAT_URL, mode: "existing_chat" });

    // Simulate reopening the Mini App.
    await act(async () => root.unmount());
    root = createRoot(container);
    installTelegram({ supported: false });
    mockFetch({});
    await render(<Instructions />);
    expect(text()).toContain("Waiting for channel selection...");
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("connect-status?token=bot-tok"))).toBe(true);
    expect(openTelegramLink).not.toHaveBeenCalled();
  });

  it("shows 'verifying' once the server reports the channel was selected", async () => {
    installTelegram({ supported: false });
    mockFetch({
      "/api/channels/connect-bot-request": json(returning),
      "/api/channels/connect-status": json({ status: "pending", stage: "verifying" }),
    });
    await render(<Instructions />);
    await click("Connect channel via bot");
    expect(text()).toContain("Channel selected — verifying");
  });

  it("surfaces the specific backend failure and retries with the SAME primary button", async () => {
    installTelegram({ supported: false });
    mockFetch({
      "/api/channels/connect-bot-request": json(returning),
      "/api/channels/connect-status": json({ status: "failed", reason: "bot_not_admin", error: "Our bot is in the channel but needs to be an administrator." }),
    });
    await render(<Instructions />);
    await click("Connect channel via bot");
    expect(text()).toContain("needs to be an administrator");
    expect(button("Connect channel via bot")).toBeTruthy();
    expect(button("Try Again")).toBeUndefined();
  });

  it("an expired request is reported as expired and the same primary button starts a FRESH attempt", async () => {
    installTelegram({ supported: false });
    mockFetch({
      "/api/channels/connect-bot-request": json(returning),
      "/api/channels/connect-status": json({ status: "expired" }, 404),
    });
    await render(<Instructions />);
    await click("Connect channel via bot");
    expect(text()).toContain("expired");
    expect(notificationOccurred).not.toHaveBeenCalledWith("success");
    mockFetch({ "/api/channels/connect-bot-request": json({ ...returning, token: "bot-tok-2" }) });
    await click("Connect channel via bot");
    expect(botRequestCalls()).toBe(1);
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY)!).token).toBe("bot-tok-2");
  });

  it("a failed bot-request creation shows the server's message (no silent failure) and does not open Telegram", async () => {
    installTelegram({ supported: false });
    mockFetch({ "/api/channels/connect-bot-request": json({ error: "Channel connection is temporarily unavailable." }, 502) });
    await render(<Instructions />);
    await click("Connect channel via bot");
    expect(text()).toContain("temporarily unavailable");
    expect(openTelegramLink).not.toHaveBeenCalled();
    expect(impactOccurred).not.toHaveBeenCalled();
    expect(notificationOccurred).toHaveBeenCalledWith("error");
    expect(button("Connect channel via bot")).toBeTruthy();
  });

  it("Cancel abandons the pending request on the server and returns to the bot option", async () => {
    installTelegram({ supported: false });
    mockFetch({ "/api/channels/connect-bot-request": json(returning) });
    await render(<Instructions />);
    await click("Connect channel via bot");
    await click("Cancel");
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("connect-cancel"))).toBe(true);
    expect(button("Connect channel via bot")).toBeTruthy();
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});

describe("Haptic feedback", () => {
  const returning = { token: "bot-tok", mode: "existing_chat", botUrl: CHAT_URL, botUsername: "ConfiguredOnfileBot" };

  it("fires AFTER the request is prepared and BEFORE the bot chat is opened", async () => {
    installTelegram({ supported: false });
    mockFetch({ "/api/channels/connect-bot-request": json(returning) });
    await render(<Instructions />);
    await click("Connect channel via bot");

    expect(impactOccurred).toHaveBeenCalledTimes(1);
    const requestOrder = fetchMock.mock.invocationCallOrder[0];
    const hapticOrder = impactOccurred.mock.invocationCallOrder[0];
    const openOrder = openTelegramLink.mock.invocationCallOrder[0];
    expect(requestOrder).toBeLessThan(hapticOrder);
    expect(hapticOrder).toBeLessThan(openOrder);
    // The connect haptic is not a success haptic.
    expect(notificationOccurred).not.toHaveBeenCalledWith("success");
  });

  it("an unavailable haptic API never blocks the redirect", async () => {
    installTelegram({ supported: false, haptic: false });
    mockFetch({ "/api/channels/connect-bot-request": json(returning) });
    await render(<Instructions />);
    await click("Connect channel via bot");
    expect(openTelegramLink).toHaveBeenCalledWith(CHAT_URL);
  });

  it("a throwing haptic API never blocks the redirect", async () => {
    installTelegram({ supported: false });
    impactOccurred.mockImplementation(() => {
      throw new Error("haptics broken");
    });
    mockFetch({ "/api/channels/connect-bot-request": json(returning) });
    await render(<Instructions />);
    await click("Connect channel via bot");
    expect(openTelegramLink).toHaveBeenCalledWith(CHAT_URL);
  });

  it("a server-confirmed connection triggers the success haptic exactly once", async () => {
    installTelegram({ supported: false });
    const onSuccess = vi.fn();
    mockFetch({
      "/api/channels/connect-bot-request": json(returning),
      "/api/channels/connect-status": json({ status: "verified", channel: { id: 1, channelName: "Priv", status: "verified" } }),
    });
    await render(<BotConnectInstructions onBack={() => {}} onSuccess={onSuccess} />);
    await click("Connect channel via bot");
    expect(notificationOccurred).toHaveBeenCalledTimes(1);
    expect(notificationOccurred).toHaveBeenCalledWith("success");
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();

    // Returning to the app after success must not re-notify.
    const calls = statusCalls();
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(statusCalls()).toBe(calls);
    expect(notificationOccurred).toHaveBeenCalledTimes(1);
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it("pending and failed requests never trigger the success haptic", async () => {
    installTelegram({ supported: false });
    mockFetch({
      "/api/channels/connect-bot-request": json(returning),
      "/api/channels/connect-status": json({ status: "pending", stage: "awaiting_selection" }),
    });
    await render(<Instructions />);
    await click("Connect channel via bot");
    expect(notificationOccurred).not.toHaveBeenCalled();

    await act(async () => root.unmount());
    root = createRoot(container);
    window.localStorage.clear();
    window.sessionStorage.clear();
    installTelegram({ supported: false });
    mockFetch({
      "/api/channels/connect-bot-request": json(returning),
      "/api/channels/connect-status": json({ status: "failed", reason: "bot_not_admin", error: "Not admin." }),
    });
    await render(<Instructions />);
    await click("Connect channel via bot");
    expect(notificationOccurred).not.toHaveBeenCalledWith("success");
    expect(notificationOccurred).toHaveBeenCalledWith("error");
  });
});

describe("“I've finished in the bot — check status”", () => {
  const returning = { token: "bot-tok", mode: "existing_chat", botUrl: CHAT_URL, botUsername: "ConfiguredOnfileBot" };
  let statusImpl: Handler;

  async function openWaiting(onSuccess: (c: unknown) => void = () => {}) {
    installTelegram({ supported: false });
    // The first (automatic) poll stays pending; later calls use statusImpl.
    let first = true;
    mockFetch({
      "/api/channels/connect-bot-request": json(returning),
      "/api/channels/connect-status": () => {
        if (first) {
          first = false;
          return new Response(JSON.stringify({ status: "pending", stage: "awaiting_selection" }), { status: 200 });
        }
        return statusImpl();
      },
    });
    await render(<BotConnectInstructions onBack={() => {}} onSuccess={onSuccess} />);
    await click("Connect channel via bot");
  }

  it("shows loading immediately, calls the status API, and reports success only after the server confirms", async () => {
    const onSuccess = vi.fn();
    let release!: (r: Response) => void;
    statusImpl = () => new Promise<Response>((resolve) => (release = resolve));
    await openWaiting(onSuccess);

    const before = statusCalls();
    await click("check status");
    expect(statusCalls()).toBe(before + 1);
    expect(button("Checking...")?.disabled).toBe(true); // loading, immediately
    expect(onSuccess).not.toHaveBeenCalled(); // never success before server verification
    expect(notificationOccurred).not.toHaveBeenCalledWith("success");

    await act(async () => {
      release(new Response(JSON.stringify({ status: "verified", channel: { id: 7, channelName: "Priv", status: "verified" } }), { status: 200 }));
    });
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onSuccess).toHaveBeenCalledWith(expect.objectContaining({ id: 7 }));
    expect(notificationOccurred).toHaveBeenCalledWith("success");
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("still pending → a short pending message, no success, polling continues, can check again", async () => {
    statusImpl = json({ status: "pending", stage: "awaiting_selection" });
    await openWaiting();
    await click("check status");
    expect(container.querySelector("[data-testid=bot-check-message]")?.textContent).toContain("Not connected yet");
    expect(notificationOccurred).not.toHaveBeenCalledWith("success");
    expect(button("check status")).toBeTruthy();
    expect(window.localStorage.getItem(STORAGE_KEY)).not.toBeNull();
  });

  it("expired → expired state and a fresh attempt via the primary button", async () => {
    statusImpl = json({ status: "expired" }, 404);
    await openWaiting();
    await click("check status");
    expect(text()).toContain("expired");
    expect(button("Connect channel via bot")).toBeTruthy();
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("server error (non-JSON 500) → useful error and retry stays available", async () => {
    statusImpl = () => new Response("<html>Internal Server Error</html>", { status: 500 });
    await openWaiting();
    await click("check status");
    const msg = container.querySelector("[data-testid=bot-check-message]")?.textContent ?? "";
    expect(msg).toContain("Couldn't check the status");
    expect(button("check status")).toBeTruthy();
    expect(button("Checking...")).toBeUndefined();
    expect(notificationOccurred).not.toHaveBeenCalledWith("success");
  });

  it("network error → useful error and retry stays available", async () => {
    statusImpl = () => Promise.reject(new Error("offline"));
    await openWaiting();
    await click("check status");
    expect(container.querySelector("[data-testid=bot-check-message]")?.textContent).toContain("Couldn't check the status");
    expect(button("check status")).toBeTruthy();
  });

  it("a failed verification reported by the server is shown (not success)", async () => {
    statusImpl = json({ status: "failed", reason: "channel_is_public", error: "Only private channels can be connected." });
    await openWaiting();
    await click("check status");
    expect(text()).toContain("Only private channels can be connected.");
    expect(notificationOccurred).not.toHaveBeenCalledWith("success");
  });

  it("unauthorized (request belongs to another Telegram user) is never shown as success", async () => {
    statusImpl = json({ status: "unauthorized", error: "Please sign in with Telegram again before connecting a channel." }, 401);
    await openWaiting();
    await click("check status");
    expect(text()).toContain("sign in with Telegram again");
    expect(notificationOccurred).not.toHaveBeenCalledWith("success");
  });

  it("repeated taps while a check is in flight create a single request (no duplicates)", async () => {
    let release!: (r: Response) => void;
    statusImpl = () => new Promise<Response>((resolve) => (release = resolve));
    await openWaiting();
    const before = statusCalls();
    const b = button("check status")!;
    await act(async () => {
      b.click();
      b.click();
      b.click();
    });
    expect(statusCalls()).toBe(before + 1);
    await act(async () => {
      release(new Response(JSON.stringify({ status: "pending" }), { status: 200 }));
    });
  });

  it("a status result for a superseded request is ignored (no stale success)", async () => {
    const onSuccess = vi.fn();
    let release!: (r: Response) => void;
    statusImpl = () => new Promise<Response>((resolve) => (release = resolve));
    await openWaiting(onSuccess);
    await click("check status");
    await click("Cancel"); // abandons the request while the check is in flight
    await act(async () => {
      release(new Response(JSON.stringify({ status: "verified", channel: { id: 9, status: "verified" } }), { status: 200 }));
    });
    expect(onSuccess).not.toHaveBeenCalled();
    expect(notificationOccurred).not.toHaveBeenCalledWith("success");
  });
});

describe("Runtime fallback — client reports supported but requestChat throws WebAppMethodUnsupported", () => {
  it("cancels the prepared request and offers the bot fallback", async () => {
    installTelegram({
      supported: true,
      requestChat: () => {
        throw new Error("WebAppMethodUnsupported");
      },
    });
    mockFetch({ "/api/channels/connect-request": json({ token: "tok", preparedButtonId: "prep-1" }) });
    await render(<Instructions />);
    await click("Connect Channel");
    expect(button("Connect channel via bot")).toBeTruthy();
    expect(text()).not.toContain("Update Required");
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("connect-cancel"))).toBe(true);
  });
});

describe("Channel Management (ChannelConnectFlow) shares the same behavior", () => {
  it("old client: shows the bot option; new client: does not", async () => {
    installTelegram({ supported: false });
    mockFetch({});
    await render(<ChannelConnectFlow />);
    expect(button("Connect channel via bot")).toBeTruthy();
    expect(text()).not.toContain("Update Required");

    await act(async () => root.unmount());
    root = createRoot(container);
    installTelegram({ supported: true });
    await render(<ChannelConnectFlow />);
    expect(button("Connect Telegram Channel")).toBeTruthy();
    expect(text()).not.toContain("Connect channel via bot");
  });
});

describe("Direct Channel Picker — success confirmation", () => {
  it("shows the congratulatory message with the channel name, only after server verification, with ONE success haptic", async () => {
    installTelegram({ supported: true });
    let statusBody: unknown = { status: "pending", stage: "awaiting_selection" };
    mockFetch({
      "/api/channels/connect-request": json({ token: "tok", preparedButtonId: "prep-1" }),
      "/api/channels/connect-status": () => new Response(JSON.stringify(statusBody), { status: 200 }),
    });
    await render(<ChannelConnectFlow />);
    await click("Connect Telegram Channel");

    // Pending: no success UI, no success haptic.
    expect(text()).not.toContain("Congratulations");
    expect(notificationOccurred).not.toHaveBeenCalled();

    // Server verifies on the next check (return to the app).
    statusBody = { status: "verified", channel: { id: 3, channelName: "My Private Channel", status: "verified" } };
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(text()).toContain("🎉 Congratulations! Your channel is now connected to your Onfile account.");
    expect(text()).toContain("My Private Channel");
    expect(notificationOccurred).toHaveBeenCalledTimes(1);
    expect(notificationOccurred).toHaveBeenCalledWith("success");

    // Refresh / more polling: no duplicate notification.
    const calls = statusCalls();
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(statusCalls()).toBe(calls);
    expect(notificationOccurred).toHaveBeenCalledTimes(1);
    expect(container.textContent!.split("Congratulations").length - 1).toBe(1);
  });

  it("a Direct Picker failure shows the error, never the congratulations", async () => {
    installTelegram({ supported: true });
    mockFetch({
      "/api/channels/connect-request": json({ token: "tok", preparedButtonId: "prep-1" }),
      "/api/channels/connect-status": json({ status: "failed", reason: "channel_is_public", error: "Only private channels can be connected." }),
    });
    await render(<ChannelConnectFlow />);
    await click("Connect Telegram Channel");
    expect(text()).toContain("Only private channels can be connected.");
    expect(text()).not.toContain("Congratulations");
    expect(notificationOccurred).not.toHaveBeenCalledWith("success");
  });
});
