// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import BotConnectInstructions from "./BotConnectInstructions";
import ChannelConnectFlow from "../ChannelConnectFlow";
import CreatorSetup from "../CreatorSetup";
import DirectConnectSuccess, { DIRECT_CONNECT_SUCCESS_COPY, DIRECT_SUCCESS_AUTO_NAVIGATE_MS } from "./DirectConnectSuccess";
import { resetLaunchConnectRefCache } from "@/lib/botConnectClient";
import { resetBotNavigationForTests } from "@/lib/botNavigation";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const app = vi.hoisted(() => ({
  setActiveTab: vi.fn(),
  setProfileEntry: vi.fn(),
  refreshDashboard: vi.fn(async () => true),
  refreshUser: vi.fn(async () => {}),
}));
vi.mock("@/contexts/AppContext", () => ({
  useApp: () => ({
    authStatus: "authenticated",
    user: { firstName: "T", lastName: null, username: null },
    setupProfile: null,
    startTelegramLogin: async () => ({ ok: true }),
    ...app,
  }),
}));

/**
 * UI tests of the DIRECT Mini App connection (Connect → native `requestChat` picker → backend verification →
 * in-app Congratulations → Dashboard) and of the capability switch that keeps older clients on the legacy bot-chat
 * flow. jsdom only: the Telegram bridge is a test double, so these tests prove Onfile's wiring — NOT the behaviour
 * of a real Telegram client.
 */

const BOT_URL = "https://t.me/ConfiguredOnfileBot";
const LEGACY_REF = 1_073_741_900;
const CHANNEL = { id: 7, channelName: "My Private Channel", channelUsername: null, status: "verified", telegramChannelId: "-100123" };

let container: HTMLDivElement;
let root: Root;
let fetchMock: ReturnType<typeof vi.fn>;
let requestChat: ReturnType<typeof vi.fn>;
let openTelegramLink: ReturnType<typeof vi.fn>;
let close: ReturnType<typeof vi.fn>;
let notificationOccurred: ReturnType<typeof vi.fn>;
/** What the (simulated) native picker does when opened. */
let pickerBehaviour: (reqId: string, cb: (sent: boolean) => void) => void;

function installTelegram(opts: { version?: "9.6" | "9.5" | "none"; requestChat?: boolean } = {}) {
  openTelegramLink = vi.fn();
  close = vi.fn();
  notificationOccurred = vi.fn();
  requestChat = vi.fn((reqId: string, cb: (sent: boolean) => void) => pickerBehaviour(reqId, cb));
  const version = opts.version ?? "9.6";
  (window as unknown as { Telegram: unknown }).Telegram = {
    WebApp: {
      initData: "query_id=abc&user=%7B%7D&hash=zzz",
      close,
      openTelegramLink,
      ...(version === "none" ? {} : { isVersionAtLeast: (v: string) => (version === "9.6" ? true : Number(v) <= 9.5) }),
      ...(opts.requestChat === false ? {} : { requestChat }),
      HapticFeedback: { impactOccurred: vi.fn(), notificationOccurred },
      onEvent: vi.fn(),
      offEvent: vi.fn(),
    },
  };
}

type Handler = (init?: RequestInit) => Response | Promise<Response>;
function mockFetch(handlers: Record<string, Handler>) {
  fetchMock = vi.fn((url: string, init?: RequestInit) => {
    const path = String(url).split("?")[0];
    const h = handlers[path];
    return Promise.resolve(h ? h(init) : new Response(JSON.stringify({ status: "pending", stage: "awaiting_selection" }), { status: 200 }));
  });
  vi.stubGlobal("fetch", fetchMock);
}
const json = (body: unknown, status = 200) => () => new Response(JSON.stringify(body), { status });
const calls = (path: string) => fetchMock.mock.calls.filter((c) => String(c[0]).includes(path));
const directOk = () => json({ token: "tok-direct", preparedButtonId: "prepared-1" });
const pending = (stage = "awaiting_selection") => json({ status: "pending", stage, state: "prepared" });

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

let onSuccess: ReturnType<typeof vi.fn>;
const Instructions = () => <BotConnectInstructions onBack={() => {}} onSuccess={onSuccess as never} />;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "setInterval", "clearTimeout", "clearInterval", "Date"] });
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.history.replaceState(null, "", "/");
  resetLaunchConnectRefCache();
  resetBotNavigationForTests();
  Object.values(app).forEach((f) => f.mockClear());
  onSuccess = vi.fn();
  pickerBehaviour = (_id, cb) => cb(true);
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
  resetLaunchConnectRefCache();
  delete (window as unknown as { Telegram?: unknown }).Telegram;
});

describe("New clients (Bot API 9.6+): Connect opens Telegram's native channel picker inside the Mini App", () => {
  it("tap → ONE secure request → requestChat(preparedButtonId); the bot chat is never opened, the Mini App never closes", async () => {
    pickerBehaviour = () => {}; // the picker stays open
    mockFetch({ "/api/channels/connect-request": directOk(), "/api/channels/connect-status": pending() });
    await render(<Instructions />);
    await click("Connect");

    expect(calls("connect-request")).toHaveLength(1);
    expect(fetchMock.mock.calls.find((c) => String(c[0]).includes("connect-request"))?.[1]).toMatchObject({ method: "POST" });
    expect(requestChat).toHaveBeenCalledTimes(1);
    expect(requestChat.mock.calls[0][0]).toBe("prepared-1");
    // Never the legacy flow:
    expect(calls("connect-bot-request")).toHaveLength(0);
    expect(calls("connect-bot-start")).toHaveLength(0);
    expect(openTelegramLink).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    expect(text()).toContain("Waiting for channel selection");
    expect(text()).not.toContain("Select channel to connect");
    expect(text()).not.toContain("Time remaining"); // no bot-chat countdown screen
  });

  it("the Connect button shows a loading state while the request is prepared, and a second tap cannot start a second request", async () => {
    let release!: () => void;
    pickerBehaviour = () => {};
    mockFetch({
      "/api/channels/connect-request": () => new Promise<Response>((resolve) => (release = () => resolve(new Response(JSON.stringify({ token: "tok-direct", preparedButtonId: "prepared-1" }), { status: 200 })))),
      "/api/channels/connect-status": pending(),
    });
    await render(<Instructions />);
    await click("Connect");
    expect(button("Connecting…")?.disabled).toBe(true);
    expect(button("Connect")).toBeUndefined(); // nothing left to double-tap
    expect(requestChat).not.toHaveBeenCalled(); // only after the prepared id was obtained
    release();
    await advance(0);
    expect(calls("connect-request")).toHaveLength(1);
    expect(requestChat).toHaveBeenCalledTimes(1);
  });

  it("requestChat → true is NOT success: the Mini App keeps waiting for the BACKEND, then shows success only on 'verified'", async () => {
    let statusBody: unknown = { status: "pending", stage: "channel_selected", state: "channel_selected" };
    mockFetch({ "/api/channels/connect-request": directOk(), "/api/channels/connect-status": () => new Response(JSON.stringify(statusBody), { status: 200 }) });
    await render(<Instructions />);
    await click("Connect");
    await advance(1100);

    expect(requestChat).toHaveBeenCalledTimes(1);
    expect(text()).toContain("Channel selected — verifying");
    expect(onSuccess).not.toHaveBeenCalled();
    expect(notificationOccurred).not.toHaveBeenCalledWith("success");

    statusBody = { status: "verified", channel: CHANNEL };
    await advance(1100);
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onSuccess).toHaveBeenCalledWith(expect.objectContaining({ id: 7 }), { direct: true });
    expect(notificationOccurred).toHaveBeenCalledWith("success");
    await advance(5000);
    expect(onSuccess).toHaveBeenCalledTimes(1); // exactly once
    // status is read from the authoritative endpoint using the opaque token
    expect(String(calls("connect-status")[0][0])).toContain("token=tok-direct");
  });

  it("a fast backend verdict that arrives BEFORE the picker callback is still accepted (no dependence on the callback)", async () => {
    pickerBehaviour = () => {}; // the callback never fires
    let statusBody: unknown = { status: "pending", stage: "awaiting_selection" };
    mockFetch({ "/api/channels/connect-request": directOk(), "/api/channels/connect-status": () => new Response(JSON.stringify(statusBody), { status: 200 }) });
    await render(<Instructions />);
    await click("Connect");
    statusBody = { status: "verified", channel: CHANNEL };
    await advance(1100);
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it("the user cancels the picker: the request is abandoned (server-side, only if nothing was selected) and Connect is offered again", async () => {
    pickerBehaviour = (_id, cb) => cb(false);
    mockFetch({
      "/api/channels/connect-request": directOk(),
      "/api/channels/connect-status": pending(),
      "/api/channels/connect-cancel": json({ ok: true, cancelled: true }),
    });
    await render(<Instructions />);
    await click("Connect");
    await advance(0);

    expect(calls("connect-cancel")).toHaveLength(1);
    expect(JSON.parse(String(calls("connect-cancel")[0][1]?.body))).toEqual({ token: "tok-direct", onlyIfUnselected: true });
    expect(text()).toContain("Channel selection was cancelled");
    expect(onSuccess).not.toHaveBeenCalled();
    expect(button("Connect")).toBeTruthy();
    expect(openTelegramLink).not.toHaveBeenCalled();

    // Retry works and starts a brand-new request.
    pickerBehaviour = () => {};
    await click("Connect");
    expect(calls("connect-request")).toHaveLength(2);
  });

  it("cancel reported, but the server already holds a selection: the backend's verdict decides (no false 'cancelled')", async () => {
    pickerBehaviour = (_id, cb) => cb(false);
    let statusBody: unknown = { status: "pending", stage: "verifying" };
    mockFetch({
      "/api/channels/connect-request": directOk(),
      "/api/channels/connect-status": () => new Response(JSON.stringify(statusBody), { status: 200 }),
      "/api/channels/connect-cancel": json({ ok: true, cancelled: false }),
    });
    await render(<Instructions />);
    await click("Connect");
    await advance(0);
    expect(text()).not.toContain("cancelled");
    expect(text()).toContain("verifying");
    statusBody = { status: "verified", channel: CHANNEL };
    await advance(1100);
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it("backend verification fails (e.g. the user is not an administrator): the reason is shown, nothing succeeds, Connect is offered again", async () => {
    mockFetch({
      "/api/channels/connect-request": directOk(),
      "/api/channels/connect-status": json({ status: "failed", reason: "user_not_admin", error: "You must be an administrator (or the owner) of this channel to connect it." }),
    });
    await render(<Instructions />);
    await click("Connect");
    await advance(1100);
    expect(text()).toContain("You must be an administrator");
    expect(onSuccess).not.toHaveBeenCalled();
    expect(notificationOccurred).not.toHaveBeenCalledWith("success");
    expect(button("Connect")).toBeTruthy();
  });

  it("the request expires: the server's 'expired' answer is shown and Connect starts over", async () => {
    mockFetch({ "/api/channels/connect-request": directOk(), "/api/channels/connect-status": json({ status: "expired", state: "expired" }, 404) });
    await render(<Instructions />);
    await click("Connect");
    await advance(1100);
    expect(text()).toContain("expired");
    expect(onSuccess).not.toHaveBeenCalled();
    expect(button("Connect")).toBeTruthy();
  });

  it("a network failure while preparing is reported and can be retried", async () => {
    mockFetch({ "/api/channels/connect-request": () => Promise.reject(new TypeError("offline")) as unknown as Response });
    await render(<Instructions />);
    await click("Connect");
    expect(text()).toContain("Network error");
    expect(requestChat).not.toHaveBeenCalled();
    expect(button("Connect")).toBeTruthy();
  });

  it("a server error while preparing (Telegram refused the prepared button) shows the server's message; the picker is never opened", async () => {
    mockFetch({ "/api/channels/connect-request": json({ error: "We couldn't reach Telegram right now. Please try again shortly.", reason: "telegram_api_error" }, 502) });
    await render(<Instructions />);
    await click("Connect");
    expect(text()).toContain("We couldn't reach Telegram right now");
    expect(requestChat).not.toHaveBeenCalled();
    expect(calls("connect-bot-request")).toHaveLength(0);
  });

  it("picker closed ('sent') but the selection never reaches the backend: the request is abandoned after a while, with a clear message", async () => {
    mockFetch({
      "/api/channels/connect-request": directOk(),
      "/api/channels/connect-status": pending(),
      "/api/channels/connect-cancel": json({ ok: true, cancelled: true }),
    });
    await render(<Instructions />);
    await click("Connect");
    await advance(44_000);
    expect(text()).toContain("verifying");
    expect(calls("connect-cancel")).toHaveLength(0);
    await advance(2_000);
    expect(calls("connect-cancel")).toHaveLength(1);
    expect(text()).toContain("didn't receive your channel selection");
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("a client that throws WebAppMethodUnsupported at runtime (picker never opened) falls back to the unchanged bot-chat flow", async () => {
    pickerBehaviour = () => {
      throw new Error("WebAppMethodUnsupported");
    };
    mockFetch({
      "/api/channels/connect-request": directOk(),
      "/api/channels/connect-cancel": json({ ok: true, cancelled: true }),
      "/api/channels/connect-bot-request": json({ token: "tok-legacy", ref: LEGACY_REF, botUsername: "ConfiguredOnfileBot" }),
      "/api/channels/connect-bot-start": json({ mode: "existing_chat", botUrl: BOT_URL, botUsername: "ConfiguredOnfileBot", ref: LEGACY_REF, state: "awaiting_channel_selection", expiresAt: new Date(Date.now() + 600_000).toISOString(), serverTime: new Date().toISOString() }),
      "/api/channels/connect-status": json({ status: "pending", stage: "awaiting_selection", state: "awaiting_channel_selection", ref: LEGACY_REF }),
    });
    await render(<Instructions />);
    await click("Connect");
    await advance(0);
    expect(calls("connect-bot-request")).toHaveLength(1);
    expect(calls("connect-bot-start")).toHaveLength(1);
    expect(openTelegramLink).toHaveBeenCalledWith(BOT_URL);
    expect(text()).toContain("Waiting for channel selection");
  });
});

describe("Older clients keep the ORIGINAL bot-chat flow (the direct flow is never applied to them)", () => {
  const legacyHandlers = () => ({
    "/api/channels/connect-bot-request": json({ token: "tok-legacy", ref: LEGACY_REF, botUsername: "ConfiguredOnfileBot" }),
    "/api/channels/connect-bot-start": json({ mode: "existing_chat", botUrl: BOT_URL, botUsername: "ConfiguredOnfileBot", ref: LEGACY_REF, state: "awaiting_channel_selection", expiresAt: new Date(Date.now() + 600_000).toISOString(), serverTime: new Date().toISOString() }),
    "/api/channels/connect-status": json({ status: "pending", stage: "awaiting_selection", state: "awaiting_channel_selection", ref: LEGACY_REF }),
  });

  for (const [label, opts] of [
    ["Bot API 9.5 client (script defines requestChat, but isVersionAtLeast('9.6') is false)", { version: "9.5" as const }],
    ["very old bridge without isVersionAtLeast", { version: "none" as const }],
    ["9.6 client without a requestChat method", { requestChat: false }],
  ] as const) {
    it(`${label}: Connect uses connect-bot-request + bot chat, never connect-request / requestChat`, async () => {
      installTelegram(opts);
      mockFetch(legacyHandlers());
      await render(<Instructions />);
      await click("Connect");
      await advance(0);
      expect(calls("connect-request")).toHaveLength(0);
      expect(requestChat).not.toHaveBeenCalled();
      expect(calls("connect-bot-request")).toHaveLength(1);
      expect(calls("connect-bot-start")).toHaveLength(1);
      expect(openTelegramLink).toHaveBeenCalledWith(BOT_URL);
    });
  }
});

describe("Congratulations (in-app) → automatic Dashboard navigation", () => {
  it("DirectConnectSuccess shows the exact copy and navigates exactly once, automatically", async () => {
    const onDone = vi.fn();
    await render(<DirectConnectSuccess channel={CHANNEL as never} onDone={onDone} />);
    expect(text()).toContain("🎉 Congratulations!");
    expect(text()).toContain("Your Telegram channel has been successfully connected to Onfile.");
    expect(text()).toContain("Your channel is now ready. You can manage your content and start using Onfile.");
    expect(DIRECT_CONNECT_SUCCESS_COPY.title).toBe("🎉 Congratulations!");
    expect(onDone).not.toHaveBeenCalled();
    await advance(DIRECT_SUCCESS_AUTO_NAVIGATE_MS + 50);
    expect(onDone).toHaveBeenCalledTimes(1);
    await click("Open Dashboard"); // a late tap cannot navigate a second time
    await advance(5000);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("onboarding: backend-verified direct connection → Congratulations (no old success screen) → Dashboard opened + data refreshed", async () => {
    mockFetch({
      "/api/channels/connect-request": directOk(),
      "/api/channels/connect-status": json({ status: "verified", channel: CHANNEL }),
    });
    await render(<CreatorSetup />);
    await click("Connect channel via bot");
    await click("Connect");
    await advance(1100);

    expect(text()).toContain("🎉 Congratulations!");
    expect(text()).toContain("Your Telegram channel has been successfully connected to Onfile.");
    expect(text()).not.toContain("Channel Connected Successfully!"); // the legacy success screen
    expect(app.setActiveTab).not.toHaveBeenCalled(); // not before the message was shown

    await advance(DIRECT_SUCCESS_AUTO_NAVIGATE_MS + 50);
    expect(app.setProfileEntry).toHaveBeenCalledWith(null);
    expect(app.setActiveTab).toHaveBeenCalledWith("home"); // the Dashboard, never Channel Management
    expect(app.refreshDashboard).toHaveBeenCalledTimes(1);
    expect(openTelegramLink).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
  });

  it("Channel Management: the same in-app Congratulations, then the Dashboard (not Channel Management) is opened and refreshed", async () => {
    const onConnected = vi.fn();
    mockFetch({
      "/api/channels/connect-request": directOk(),
      "/api/channels/connect-status": json({ status: "verified", channel: CHANNEL }),
    });
    await render(<ChannelConnectFlow onConnected={onConnected} />);
    await click("Connect");
    await advance(1100);
    expect(container.querySelector('[data-testid="direct-success-overlay"]')).toBeTruthy();
    expect(text()).toContain("🎉 Congratulations!");

    await advance(DIRECT_SUCCESS_AUTO_NAVIGATE_MS + 50);
    expect(app.setActiveTab).toHaveBeenCalledWith("home");
    expect(app.setProfileEntry).toHaveBeenCalledWith(null);
    expect(app.refreshDashboard).toHaveBeenCalledTimes(1);
  });
});
