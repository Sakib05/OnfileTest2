// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Navigation after the bot's "Verify" button: Telegram → Verify → Mini App opens at `/?connect=<ref>` → the Mini App
 * asks the backend to VERIFY the EXISTING request (POST /api/channels/connect-verify — the user's Verify action) →
 * Dashboard data refreshes → Dashboard opens.
 *
 * The REAL HomePage + REAL AppProvider + REAL ConnectionVerifyGate run; only `fetch` (the backend) and the heavy tab
 * screens are test doubles. The doubles make the destination observable: `DASHBOARD` is HomeTab, `CHANNEL_MANAGEMENT`
 * is ProfileTab (which hosts the Channel Management page). jsdom only — this is NOT a test of a real Telegram client.
 */

const renders = vi.hoisted(() => ({ dashboard: 0, profile: 0, creatorSetup: 0, order: [] as string[] }));

vi.mock("@/components/tabs/HomeTab", () => ({
  default: function HomeTab() {
    React.useEffect(() => {
      renders.order.push("dashboard-mounted");
      void fetch("/api/analytics?days=7"); // what the real Dashboard does on mount
    }, []);
    renders.dashboard++;
    return <div data-testid="dashboard">DASHBOARD</div>;
  },
}));
vi.mock("@/components/tabs/ProfileTab", () => ({
  default: function ProfileTab() {
    renders.profile++;
    return <div data-testid="channel-management">CHANNEL_MANAGEMENT</div>;
  },
}));
vi.mock("@/components/CreatorSetup", () => ({
  default: function CreatorSetup() {
    renders.creatorSetup++;
    return <div data-testid="creator-setup">CREATOR_SETUP</div>;
  },
}));
vi.mock("@/components/Onboarding", () => ({ default: () => <div data-testid="onboarding">ONBOARDING</div> }));
vi.mock("@/components/layout/BottomNav", () => ({ default: () => <nav data-testid="bottom-nav" /> }));
vi.mock("@/components/tabs/FilesTab", () => ({ default: () => <div>FILES</div> }));
vi.mock("@/components/tabs/CreateTab", () => ({ default: () => <div>CREATE</div> }));
vi.mock("@/components/tabs/WalletTab", () => ({ default: () => <div>WALLET</div> }));

import HomePage from "@/app/page";
import { AppProvider } from "@/contexts/AppContext";
import { resetLaunchConnectRefCache } from "@/lib/botConnectClient";

const REF = 1_073_741_900;
const CHANNEL = { id: 7, channelName: "Verified Channel", channelUsername: null, status: "verified", telegramChannelId: "-100123" };
const USER = { id: 1, firstName: "Test", balance: "0", pendingBalance: "0", referralEarnings: "0", totalDownloads: 0, totalEarnings: "0" };

let container: HTMLDivElement;
let root: Root;
let fetchMock: ReturnType<typeof vi.fn>;

interface Backend {
  /**
   * Successive answers of the verification endpoints; the last one repeats. The first call is the Verify action
   * (POST /api/channels/connect-verify); any later GET /api/channels/connect-status is the read-only wait for a
   * verification that is already running.
   */
  status: Array<() => Response>;
  signedIn: boolean;
  channels: () => Response;
  userMe?: () => Response;
}
const json = (body: unknown, status = 200) => () => new Response(JSON.stringify(body), { status });
const verified = json({ status: "verified", channel: CHANNEL, state: "connected", ref: REF });
const pending = (stage = "awaiting_selection") => json({ status: "pending", stage, state: "awaiting_channel_selection", ref: REF });
const channelsOk = json({ channels: [CHANNEL] });

let backend: Backend;
let statusCalls = 0;

function installBackend(b: Partial<Backend> = {}) {
  backend = { status: [verified], signedIn: true, channels: channelsOk, ...b };
  statusCalls = 0;
  renders.order = [];
  fetchMock = vi.fn((input: string, init?: RequestInit) => {
    const path = String(input).split("?")[0];
    const method = (init?.method ?? "GET").toUpperCase();
    renders.order.push(`${method} ${path}`);
    if (path === "/api/user/me") {
      if (backend.userMe) return Promise.resolve(backend.userMe());
      return Promise.resolve(backend.signedIn ? new Response(JSON.stringify({ user: USER }), { status: 200 }) : new Response("{}", { status: 401 }));
    }
    if (path === "/api/auth/telegram") {
      // The silent Telegram sign-in of a brand-new identity: no account yet, only a signed setup cookie.
      return Promise.resolve(new Response(JSON.stringify({ status: "setup_required", profile: { firstName: "T" } }), { status: 200 }));
    }
    if (path === "/api/channels") return Promise.resolve(backend.channels());
    if (path === "/api/channels/connect-status" || path === "/api/channels/connect-verify") {
      const answer = backend.status[Math.min(statusCalls, backend.status.length - 1)];
      statusCalls++;
      // A freshly verified brand-new account gets its session minted by this very response.
      if (!backend.signedIn && answer === verified) backend.signedIn = true;
      return Promise.resolve(answer());
    }
    return Promise.resolve(new Response("{}", { status: 200 }));
  });
  vi.stubGlobal("fetch", fetchMock);
}

function installTelegram() {
  (window as unknown as { Telegram: unknown }).Telegram = {
    WebApp: {
      initData: "query_id=abc&user=%7B%7D&hash=zzz",
      HapticFeedback: { impactOccurred: vi.fn(), notificationOccurred: vi.fn() },
      onEvent: vi.fn(),
      offEvent: vi.fn(),
    },
  };
}

function launch(search = `?connect=${REF}`) {
  window.history.replaceState({}, "", `/${search}`);
  resetLaunchConnectRefCache();
}

const calls = (path: string) => fetchMock.mock.calls.filter((c) => String(c[0]).split("?")[0] === path);
const text = () => container.textContent ?? "";
const testid = (id: string) => container.querySelector(`[data-testid="${id}"]`);

async function mount() {
  await act(async () => {
    root.render(
      <AppProvider>
        <HomePage />
      </AppProvider>
    );
  });
}
async function waitFor(pred: () => boolean, ms = 3000) {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > ms) throw new Error(`timed out waiting; DOM: ${text()}`);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
  }
}
async function click(label: string) {
  const b = Array.from(container.querySelectorAll("button")).find((x) => (x.textContent ?? "").trim() === label) as HTMLButtonElement | undefined;
  if (!b) throw new Error(`no "${label}" button; DOM: ${text()}`);
  await act(async () => {
    b.click();
  });
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  renders.dashboard = renders.profile = renders.creatorSetup = 0;
  window.localStorage.clear();
  window.sessionStorage.clear();
  installTelegram();
  installBackend();
  launch();
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  delete (window as unknown as { Telegram?: unknown }).Telegram;
  window.history.replaceState({}, "", "/");
  resetLaunchConnectRefCache();
});

describe("Verify launch (/?connect=<ref>) — a verified connection goes straight to the Dashboard", () => {
  it("existing creator: verifies the existing request, then shows the Dashboard — NOT the Channel Management page", async () => {
    await mount();
    await waitFor(() => testid("dashboard") !== null);

    expect(text()).toContain("DASHBOARD");
    expect(testid("channel-management")).toBeNull();
    // The Channel Management page (ProfileTab) was never even rendered at any point of the flow.
    expect(renders.profile).toBe(0);
    expect(renders.creatorSetup).toBe(0);
    expect(testid("bottom-nav")).not.toBeNull();
    // The Verify action asked the backend to verify THIS request ref (and only that) — a POST, not a poll.
    expect(calls("/api/channels/connect-verify").length).toBe(1);
    const verifyCall = calls("/api/channels/connect-verify")[0];
    expect((verifyCall[1] as RequestInit).method).toBe("POST");
    expect(JSON.parse(String((verifyCall[1] as RequestInit).body))).toEqual({ ref: REF }); // nothing else: no channel id, no user id
    expect(calls("/api/channels/connect-status").length).toBe(0);
  });

  it("brand-new creator (no account yet): signs in silently, verifies, refreshes, then lands on the Dashboard", async () => {
    installBackend({ signedIn: false });
    await mount();
    await waitFor(() => testid("dashboard") !== null);
    expect(renders.profile).toBe(0);
    expect(renders.creatorSetup).toBe(0);
    expect(calls("/api/auth/telegram").length).toBe(1);
    expect(calls("/api/channels/connect-verify").length).toBe(1);
  });

  it("Dashboard data is refreshed BEFORE the Dashboard is displayed (user + channels re-read after verification)", async () => {
    await mount();
    await waitFor(() => testid("dashboard") !== null);
    const order = renders.order;
    const verifyAt = order.indexOf("POST /api/channels/connect-verify");
    const dashboardAt = order.indexOf("dashboard-mounted");
    expect(verifyAt).toBeGreaterThanOrEqual(0);
    expect(dashboardAt).toBeGreaterThan(verifyAt);
    // Between "verified" and the Dashboard mounting, the user and the channels were re-fetched.
    const between = order.slice(verifyAt + 1, dashboardAt);
    expect(between).toContain("GET /api/user/me");
    expect(between).toContain("GET /api/channels");
    // …and the Dashboard fetched its own analytics only after that.
    expect(order.indexOf("GET /api/analytics")).toBeGreaterThan(dashboardAt - 1);
  });

  it("is a one-shot: ?connect= is removed from the address and the launch is not replayed", async () => {
    await mount();
    await waitFor(() => testid("dashboard") !== null);
    expect(window.location.search).toBe("");
    expect(window.localStorage.getItem("onfile_pending_channel_connect")).toBeNull();
  });

  it("no onboarding is shown in between, even with fresh storage", async () => {
    window.localStorage.clear();
    await mount();
    await waitFor(() => testid("dashboard") !== null);
    expect(testid("onboarding")).toBeNull();
  });

  it("never creates a connection request: the only POSTs are the silent sign-in (new identity) and the Verify action", async () => {
    installBackend({ signedIn: false });
    await mount();
    await waitFor(() => testid("dashboard") !== null);
    const forbidden = fetchMock.mock.calls.filter((c) => /\/api\/channels\/connect-(bot-start|bot-request|request|manual|cancel)/.test(String(c[0])));
    expect(forbidden).toHaveLength(0);
    const posts = fetchMock.mock.calls.filter((c) => (c[1] as RequestInit | undefined)?.method?.toUpperCase() === "POST");
    expect(posts.map((c) => String(c[0]))).toEqual(["/api/auth/telegram", "/api/channels/connect-verify"]);
  });

  it("while another tap/device is still verifying with Telegram, the same request is re-checked read-only (no second Verify, no new request) until it is verified", async () => {
    installBackend({ status: [pending("verifying"), verified] });
    await mount();
    await waitFor(() => testid("dashboard") !== null, 8000);
    expect(calls("/api/channels/connect-verify").length).toBe(1);
    expect(calls("/api/channels/connect-status").length).toBe(1);
    expect(String(calls("/api/channels/connect-status")[0][0])).toBe(`/api/channels/connect-status?ref=${REF}`);
    expect(testid("channel-management")).toBeNull();
  }, 12000);
});

describe("Verify launch — anything that is not a verified connection never reaches the Dashboard", () => {
  const cases: Array<[string, () => Response, RegExp]> = [
    ["unverified (no channel selected yet)", pending("awaiting_selection"), /haven.t received your channel selection/],
    ["channel selected but verification did not complete", pending("channel_selected"), /selected but couldn.t be verified yet/],
    ["retryable Telegram outage (503)", json({ status: "failed", retryable: true, reason: "telegram_api_error", error: "We couldn't reach Telegram right now. Please try again shortly." }, 503), /couldn.t reach Telegram/],
    ["expired / invalid / another user's request (server answers 404 expired)", json({ status: "expired", state: "expired" }, 404), /expired or isn.t valid for your account/],
    ["failed verification", json({ status: "failed", error: "The Onfile bot is not an administrator of that channel.", reason: "bot_not_admin" }), /not an administrator/],
    ["unauthorized (no valid Telegram identity)", json({ status: "unauthorized", error: "Telegram identity could not be verified." }, 401), /Telegram identity could not be verified/],
    ["server error / non-JSON", () => new Response("<html>boom</html>", { status: 502 }), /couldn.t reach Onfile/],
    ["'verified' without a channel", json({ status: "verified" }), /couldn.t reach Onfile/],
  ];

  for (const [name, answer, message] of cases) {
    it(`${name}: shows a clear error + retry, and the Dashboard is never rendered`, async () => {
      installBackend({ status: [answer] });
      await mount();
      await waitFor(() => testid("verify-error") !== null);
      expect(testid("verify-error")?.textContent).toMatch(message);
      expect(testid("dashboard")).toBeNull();
      expect(testid("channel-management")).toBeNull();
      expect(renders.dashboard).toBe(0);
      expect(renders.profile).toBe(0);
      expect(Array.from(container.querySelectorAll("button")).map((b) => b.textContent?.trim())).toContain("Try Again");
    });
  }

  it("a network failure while verifying is reported (not treated as success)", async () => {
    installBackend();
    fetchMock.mockImplementation((input: string) => {
      const path = String(input).split("?")[0];
      if (path === "/api/channels/connect-verify") return Promise.reject(new TypeError("Failed to fetch"));
      if (path === "/api/user/me") return Promise.resolve(new Response(JSON.stringify({ user: USER }), { status: 200 }));
      return Promise.resolve(channelsOk());
    });
    await mount();
    await waitFor(() => testid("verify-error") !== null);
    expect(renders.dashboard).toBe(0);
  });

  it("verified by the server but the refreshed data shows no verified channel → error, no Dashboard", async () => {
    installBackend({ channels: json({ channels: [] }) });
    await mount();
    await waitFor(() => testid("verify-error") !== null);
    expect(testid("verify-error")?.textContent).toMatch(/couldn.t load your dashboard/);
    expect(renders.dashboard).toBe(0);
  });

  it("outside Telegram (no initData, no session) the user is told to open Onfile from Telegram — no Dashboard", async () => {
    delete (window as unknown as { Telegram?: unknown }).Telegram;
    installBackend({ signedIn: false });
    await mount();
    await waitFor(() => testid("verify-error") !== null);
    expect(testid("verify-error")?.textContent).toMatch(/inside Telegram/);
    expect(calls("/api/channels/connect-verify").length).toBe(0);
    expect(calls("/api/channels/connect-status").length).toBe(0);
    expect(renders.dashboard).toBe(0);
  });
});

describe("Verify launch — safe retry", () => {
  it("'Try Again' re-submits Verify for the SAME request ref, never creates another request, and then reaches the Dashboard", async () => {
    installBackend({ status: [pending("awaiting_selection"), verified] });
    await mount();
    await waitFor(() => testid("verify-error") !== null);
    expect(renders.dashboard).toBe(0);

    await click("Try Again");
    await waitFor(() => testid("dashboard") !== null);

    const verifyBodies = calls("/api/channels/connect-verify").map((c) => JSON.parse(String((c[1] as RequestInit).body)));
    expect(verifyBodies).toEqual([{ ref: REF }, { ref: REF }]);
    const creating = fetchMock.mock.calls.filter((c) => /connect-(bot-start|bot-request|request|manual)/.test(String(c[0])));
    expect(creating).toHaveLength(0);
    expect(renders.profile).toBe(0);
  });

  it("repeated failures keep failing safely; a double-tap on Try Again runs one verification at a time", async () => {
    let release: (r: Response) => void = () => {};
    installBackend({ status: [pending("awaiting_selection")] });
    await mount();
    await waitFor(() => testid("verify-error") !== null);

    // Make the next check slow, then tap twice.
    const base = fetchMock.getMockImplementation() as (i: string, init?: RequestInit) => Promise<Response>;
    fetchMock.mockImplementation((input: string, init?: RequestInit) => {
      if (String(input).startsWith("/api/channels/connect-verify")) {
        return new Promise<Response>((resolve) => {
          release = resolve;
        });
      }
      return base(input, init);
    });
    const before = calls("/api/channels/connect-verify").length;
    await click("Try Again");
    // While verifying the button is gone, so a second tap is impossible; even a stray call is ignored.
    expect(testid("verify-progress")).not.toBeNull();
    expect(calls("/api/channels/connect-verify").length).toBe(before + 1);
    await act(async () => {
      release(pending("awaiting_selection")());
    });
    await waitFor(() => testid("verify-error") !== null);
    expect(renders.dashboard).toBe(0);
  });

  it("'Connect a channel' is an explicit user choice: for a user without a verified channel it opens the normal connect flow, not the Dashboard", async () => {
    installBackend({ status: [json({ status: "expired", state: "expired" }, 404)], channels: json({ channels: [] }) });
    await mount();
    await waitFor(() => testid("verify-error") !== null);
    await click("Connect a channel");
    await waitFor(() => testid("creator-setup") !== null);
    expect(renders.dashboard).toBe(0);
    expect(window.location.search).toBe("");
  });
});

describe("Normal launches are unchanged", () => {
  it("opening Onfile without ?connect= shows the Dashboard directly and never calls connect-status / connect-verify", async () => {
    launch("");
    window.localStorage.setItem("onfile_onboarding_done", "1");
    await mount();
    await waitFor(() => testid("dashboard") !== null);
    expect(calls("/api/channels/connect-status").length).toBe(0);
    expect(calls("/api/channels/connect-verify").length).toBe(0);
    expect(testid("connection-verify-gate")).toBeNull();
  });

  it("a malformed ?connect= value is ignored (no verification screen)", async () => {
    launch("?connect=abc");
    window.localStorage.setItem("onfile_onboarding_done", "1");
    await mount();
    await waitFor(() => testid("dashboard") !== null);
    expect(calls("/api/channels/connect-status").length).toBe(0);
    expect(calls("/api/channels/connect-verify").length).toBe(0);
  });
});
