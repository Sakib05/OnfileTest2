// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/components/ui/Toast";
import { AppProvider, useApp } from "@/contexts/AppContext";
import { installTelegramBackButton } from "@/test/telegramBackMock";
import HomeTab from "./HomeTab";
import { nativeBackDepth } from "@/lib/telegramBackButton";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** jsdom component tests of the Dashboard bell + notification screen (mocked fetch, no real backend / Telegram). */

type N = { id: string; type: string; title: string; body: string; createdAt: string; read: boolean; destination: { type: string; available: boolean } | null };
const mk = (id: string, over: Partial<N> = {}): N => ({
  id, type: "file_published", title: `Title ${id}`, body: `Body ${id}`, createdAt: new Date(Date.now() - 5 * 60_000).toISOString(), read: false, destination: null, ...over,
});

let container: HTMLDivElement;
let root: Root;
let server: { items: N[]; listFails: boolean };
let calls: { url: string; body?: unknown }[];
let probe: { entry: unknown };

function Probe() {
  probe.entry = useApp().profileEntry;
  return null;
}

function installFetch() {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url: String(url), body });
      const unread = () => server.items.filter((n) => !n.read).length;
      const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
      if (url.startsWith("/api/user/me")) return json({}, 401);
      if (url.startsWith("/api/analytics")) return json({ chart: [], totalFiles: 0 });
      if (url.startsWith("/api/notifications/read")) {
        if (body?.all) server.items.forEach((n) => (n.read = true));
        else server.items.find((n) => n.id === body?.id && (n.read = true));
        return json({ unreadCount: unread() });
      }
      if (url.startsWith("/api/notifications?summary=1")) return json({ unreadCount: unread() });
      if (url.startsWith("/api/notifications")) return server.listFails ? json({ error: "x" }, 500) : json({ notifications: server.items, unreadCount: unread() });
      return json({}, 404);
    })
  );
}

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const q = (sel: string) => container.querySelector(sel);
const qa = (sel: string) => Array.from(container.querySelectorAll(sel));
const click = (el: Element | null) => act(async () => { (el as HTMLElement).click(); });
let onTabChange: ReturnType<typeof vi.fn>;

async function mount() {
  onTabChange = vi.fn();
  await act(async () =>
    root.render(
      <AppProvider>
        <ToastProvider>
          <Probe />
          <HomeTab onTabChange={onTabChange} />
        </ToastProvider>
      </AppProvider>
    )
  );
  await flush();
}
const openBell = async () => { await click(q('[data-testid="notifications-bell"]')); await flush(); };

beforeEach(() => {
  server = { items: [], listFails: false };
  probe = { entry: null };
  installFetch();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  delete (window as unknown as { Telegram?: unknown }).Telegram;
  expect(nativeBackDepth()).toBe(0);
});

describe("Dashboard bell — badge", () => {
  it("shows no badge when nothing is unread, and an accurate count otherwise (9+ is capped)", async () => {
    await mount();
    expect(q('[data-testid="notifications-badge"]')).toBeNull();
    await act(async () => root.unmount());
    root = createRoot(container);
    server.items = [mk("a"), mk("b"), mk("c", { read: true })];
    await mount();
    expect(q('[data-testid="notifications-badge"]')!.textContent).toBe("2");
    expect(q('[data-testid="notifications-bell"]')!.getAttribute("aria-label")).toBe("Notifications, 2 unread");
    await act(async () => root.unmount());
    root = createRoot(container);
    server.items = Array.from({ length: 12 }, (_, i) => mk(`n${i}`));
    await mount();
    expect(q('[data-testid="notifications-badge"]')!.textContent).toBe("9+");
  });
});

describe("Notification screen", () => {
  it("opens from the bell, lists title/message/relative time with unread vs read styling, and uses ONLY the native Back Button to close", async () => {
    const tg = installTelegramBackButton();
    server.items = [mk("a"), mk("b", { read: true })];
    await mount();
    expect(tg.btn.isVisible).toBe(false); // Dashboard root: hidden
    await openBell();
    expect(q('[data-testid="notifications-screen"]')).not.toBeNull();
    expect(tg.btn.isVisible).toBe(true);
    expect(tg.listeners.size).toBe(1);
    const items = qa('[data-testid="notification-item"]');
    expect(items.map((i) => i.getAttribute("data-read"))).toEqual(["false", "true"]);
    expect(items[0].textContent).toContain("Title a");
    expect(items[0].textContent).toContain("Body a");
    expect(items[0].textContent).toContain("5 minutes ago");
    expect(container.querySelector("svg.lucide-arrow-left, svg.lucide-chevron-left")).toBeNull(); // no in-app back arrow

    await act(async () => tg.press());
    expect(q('[data-testid="notifications-screen"]')).toBeNull();
    expect(q('[data-testid="notifications-bell"]')).not.toBeNull();
    expect(tg.btn.isVisible).toBe(false);
    expect(tg.listeners.size).toBe(0);
  });

  it("empty state", async () => {
    await mount();
    await openBell();
    expect(q('[data-testid="notifications-empty"]')!.textContent).toContain("No notifications yet");
    expect((q('[data-testid="notifications-mark-all"]') as HTMLButtonElement).disabled).toBe(true);
  });

  it("load failure shows an error with Try again, which recovers", async () => {
    server.listFails = true;
    await mount();
    await openBell();
    expect(q('[data-testid="notifications-error"]')).not.toBeNull();
    server.listFails = false;
    server.items = [mk("a")];
    await click(q('[data-testid="notifications-error"] button'));
    await flush();
    expect(qa('[data-testid="notification-item"]')).toHaveLength(1);
  });

  it("marking one notification read updates the item and the unread count immediately and tells the server", async () => {
    server.items = [mk("a"), mk("b")];
    await mount();
    await openBell();
    expect(q('[data-testid="notifications-subtitle"]')!.textContent).toBe("2 unread");
    await click(qa('[data-testid="notification-mark-read"]')[0]);
    await flush();
    expect(calls.some((c) => c.url === "/api/notifications/read" && (c.body as { id: string }).id === "a")).toBe(true);
    expect(qa('[data-testid="notification-item"]')[0].getAttribute("data-read")).toBe("true");
    expect(q('[data-testid="notifications-subtitle"]')!.textContent).toBe("1 unread");
  });

  it("mark all as read clears every unread state and the badge (after going back to the dashboard)", async () => {
    const tg = installTelegramBackButton();
    server.items = [mk("a"), mk("b"), mk("c")];
    await mount();
    await openBell();
    await click(q('[data-testid="notifications-mark-all"]'));
    await flush();
    expect(calls.filter((c) => c.url === "/api/notifications/read" && (c.body as { all?: boolean }).all === true)).toHaveLength(1);
    expect(qa('[data-testid="notification-item"]').every((i) => i.getAttribute("data-read") === "true")).toBe(true);
    expect(q('[data-testid="notifications-subtitle"]')!.textContent).toBe("You're all caught up");
    await act(async () => tg.press());
    expect(q('[data-testid="notifications-badge"]')).toBeNull();
  });

  it("tapping a notification marks it read and navigates to its destination (wallet → Wallet tab)", async () => {
    server.items = [mk("w", { type: "withdrawal_requested", destination: { type: "wallet", available: true } })];
    await mount();
    await openBell();
    await click(q('[data-testid="notification-item"] button'));
    await flush();
    expect(onTabChange).toHaveBeenCalledWith("wallet");
    expect(server.items[0].read).toBe(true);
    expect(q('[data-testid="notifications-screen"]')).toBeNull();
  });

  it("channel notifications open Profile → Channel Management; file notifications open the Library", async () => {
    server.items = [mk("c", { type: "channel_connected", destination: { type: "channels", available: true } })];
    await mount();
    await openBell();
    await click(q('[data-testid="notification-item"] button'));
    expect(onTabChange).toHaveBeenCalledWith("profile");
    expect(probe.entry).toBe("channel");

    await act(async () => root.unmount());
    root = createRoot(container);
    server.items = [mk("f", { destination: { type: "file", available: true } })];
    await mount();
    await openBell();
    await click(q('[data-testid="notification-item"] button'));
    expect(onTabChange).toHaveBeenCalledWith("files");
  });

  it("an unavailable destination (e.g. deleted file) is handled gracefully: message, no navigation, still marked read", async () => {
    server.items = [mk("f", { destination: { type: "file", available: false } })];
    await mount();
    await openBell();
    await click(q('[data-testid="notification-item"] button'));
    await flush();
    expect(onTabChange).not.toHaveBeenCalled();
    expect(container.textContent).toContain("no longer available");
    expect(q('[data-testid="notifications-screen"]')).not.toBeNull(); // stays on the list
    expect(server.items[0].read).toBe(true);
  });

  it("a notification without a destination just becomes read", async () => {
    server.items = [mk("n")];
    await mount();
    await openBell();
    await click(q('[data-testid="notification-item"] button'));
    await flush();
    expect(onTabChange).not.toHaveBeenCalled();
    expect(server.items[0].read).toBe(true);
  });
});
