// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import BotConnectInstructions from "./BotConnectInstructions";
import ChannelConnectFlow from "../ChannelConnectFlow";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const BOT_URL = "https://t.me/ConfiguredOnfileBot?start=c1_abc_0123456789abcdef01234567";
const STORAGE_KEY = "onfile_pending_channel_connect";

let container: HTMLDivElement;
let root: Root;
let fetchMock: ReturnType<typeof vi.fn>;

interface TgOpts {
  supported: boolean;
  requestChat?: (id: string, cb: (sent: boolean) => void) => void;
}
let openTelegramLink: ReturnType<typeof vi.fn>;
let requestChat: ReturnType<typeof vi.fn>;

function installTelegram({ supported, requestChat: impl }: TgOpts) {
  openTelegramLink = vi.fn();
  requestChat = vi.fn(impl ?? ((_id: string, cb: (s: boolean) => void) => cb(true)));
  (window as unknown as { Telegram: unknown }).Telegram = {
    WebApp: {
      initData: "query_id=abc&user=%7B%7D&hash=zzz",
      requestChat,
      isVersionAtLeast: () => supported,
      openTelegramLink,
    },
  };
}

function mockFetch(handlers: Record<string, () => Response>) {
  fetchMock = vi.fn((url: string) => {
    const path = String(url).split("?")[0];
    const h = handlers[path];
    return Promise.resolve(h ? h() : new Response(JSON.stringify({ status: "pending" }), { status: 200 }));
  });
  vi.stubGlobal("fetch", fetchMock);
}
const json = (body: unknown, status = 200) => () => new Response(JSON.stringify(body), { status });

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

describe("Old Telegram client — bot fallback", () => {
  it("shows 'Connect channel via bot' immediately and the forced-update message is gone", async () => {
    installTelegram({ supported: false });
    mockFetch({});
    await render(<Instructions />);
    expect(button("Connect channel via bot")).toBeTruthy();
    expect(text()).not.toContain("Update Required");
    expect(text()).not.toContain("update Telegram");
    // No dead-end Direct Picker button on a client that can't use it.
    expect(button("Connect Channel")).toBeUndefined();
    expect(requestChat).not.toHaveBeenCalled();
  });

  it("clicking it requests a bot link and opens the configured bot chat with that exact link", async () => {
    installTelegram({ supported: false });
    mockFetch({ "/api/channels/connect-bot-request": json({ token: "bot-tok", botUrl: BOT_URL, botUsername: "ConfiguredOnfileBot" }) });
    await render(<Instructions />);
    await click("Connect channel via bot");

    expect(fetchMock).toHaveBeenCalledWith("/api/channels/connect-bot-request", { method: "POST" });
    expect(openTelegramLink).toHaveBeenCalledTimes(1);
    expect(openTelegramLink).toHaveBeenCalledWith(BOT_URL);
    // The Direct Picker is never invoked for the fallback.
    expect(requestChat).not.toHaveBeenCalled();

    // Honest status: waiting in the bot chat, with Start / keyboard instructions — not "picker opened".
    expect(text()).toContain("Waiting for channel selection in the bot chat");
    expect(text()).toContain("tap Start");
    expect(text()).toContain("Select channel to connect");
    expect(button("Open bot chat again")).toBeTruthy();
  });

  it("persists the pending bot request so reopening the Mini App resumes it", async () => {
    installTelegram({ supported: false });
    mockFetch({ "/api/channels/connect-bot-request": json({ token: "bot-tok", botUrl: BOT_URL }) });
    await render(<Instructions />);
    await click("Connect channel via bot");
    const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY)!);
    expect(saved).toMatchObject({ token: "bot-tok", method: "bot", botUrl: BOT_URL });

    // Simulate reopening the Mini App.
    await act(async () => root.unmount());
    root = createRoot(container);
    mockFetch({});
    await render(<Instructions />);
    expect(text()).toContain("Waiting for channel selection in the bot chat");
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("connect-status?token=bot-tok"))).toBe(true);
  });

  it("'Open bot chat again' reopens the SAME link without creating a new request", async () => {
    installTelegram({ supported: false });
    mockFetch({ "/api/channels/connect-bot-request": json({ token: "bot-tok", botUrl: BOT_URL }) });
    await render(<Instructions />);
    await click("Connect channel via bot");
    const requests = fetchMock.mock.calls.filter((c) => String(c[0]).includes("connect-bot-request")).length;
    await click("Open bot chat again");
    expect(openTelegramLink).toHaveBeenCalledTimes(2);
    expect(openTelegramLink).toHaveBeenLastCalledWith(BOT_URL);
    expect(fetchMock.mock.calls.filter((c) => String(c[0]).includes("connect-bot-request")).length).toBe(requests);
  });

  it("shows 'verifying' once the server reports the channel was selected", async () => {
    installTelegram({ supported: false });
    mockFetch({
      "/api/channels/connect-bot-request": json({ token: "bot-tok", botUrl: BOT_URL }),
      "/api/channels/connect-status": json({ status: "pending", stage: "verifying" }),
    });
    await render(<Instructions />);
    await click("Connect channel via bot");
    expect(text()).toContain("Channel selected — verifying");
  });

  it("shows the connected channel when the backend reports verified (return to Onfile)", async () => {
    installTelegram({ supported: false });
    const onSuccess = vi.fn();
    mockFetch({
      "/api/channels/connect-bot-request": json({ token: "bot-tok", botUrl: BOT_URL }),
      "/api/channels/connect-status": json({ status: "verified", channel: { id: 1, channelName: "Priv", status: "verified" } }),
    });
    await render(<BotConnectInstructions onBack={() => {}} onSuccess={onSuccess} />);
    await click("Connect channel via bot");
    expect(onSuccess).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }));
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("surfaces the specific backend failure (e.g. bot not admin) rather than a generic error", async () => {
    installTelegram({ supported: false });
    mockFetch({
      "/api/channels/connect-bot-request": json({ token: "bot-tok", botUrl: BOT_URL }),
      "/api/channels/connect-status": json({ status: "failed", reason: "bot_not_admin", error: "Our bot is in the channel but needs to be an administrator." }),
    });
    await render(<Instructions />);
    await click("Connect channel via bot");
    expect(text()).toContain("needs to be an administrator");
    expect(button("Try Again")).toBeTruthy();
  });

  it("an expired request is reported as expired and Try Again returns to the bot option", async () => {
    installTelegram({ supported: false });
    mockFetch({
      "/api/channels/connect-bot-request": json({ token: "bot-tok", botUrl: BOT_URL }),
      "/api/channels/connect-status": json({ status: "expired" }, 404),
    });
    await render(<Instructions />);
    await click("Connect channel via bot");
    expect(text()).toContain("expired");
    mockFetch({});
    await click("Try Again");
    expect(button("Connect channel via bot")).toBeTruthy();
  });

  it("a failed bot-request creation shows the server's message (no silent failure)", async () => {
    installTelegram({ supported: false });
    mockFetch({ "/api/channels/connect-bot-request": json({ error: "Channel connection is temporarily unavailable." }, 502) });
    await render(<Instructions />);
    await click("Connect channel via bot");
    expect(text()).toContain("temporarily unavailable");
    expect(openTelegramLink).not.toHaveBeenCalled();
  });

  it("Cancel abandons the pending request on the server and returns to the bot option", async () => {
    installTelegram({ supported: false });
    mockFetch({ "/api/channels/connect-bot-request": json({ token: "bot-tok", botUrl: BOT_URL }) });
    await render(<Instructions />);
    await click("Connect channel via bot");
    await click("Cancel");
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("connect-cancel"))).toBe(true);
    expect(button("Connect channel via bot")).toBeTruthy();
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
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
