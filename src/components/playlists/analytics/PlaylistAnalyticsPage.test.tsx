// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installTelegramBackButton } from "@/test/telegramBackMock";

const router = { push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn(), refresh: vi.fn(), forward: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/contexts/AppContext", () => ({ useApp: () => ({ authStatus: "authenticated", channelStatus: "has_channel" }) }));

import PlaylistAnalyticsPage from "./PlaylistAnalyticsPage";
import type { AnalyticsResponse } from "./types";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TODAY = "2026-03-15";
function payload(over: Partial<AnalyticsResponse> = {}, range: Partial<AnalyticsResponse["range"]> = {}): AnalyticsResponse {
  return {
    playlist: { id: 5, title: "Business Studies" },
    range: { key: "30d", from: "2026-02-14", to: TODAY, days: 30, granularity: "day", timezone: "UTC", today: TODAY, ...range },
    views: { total: 1234, unique: 456 },
    downloads: { total: 78 },
    earnings: { available: false, currency: null, message: "Playlist-level earnings aren't available yet." },
    series: [
      { date: "2026-03-14", label: "Mar 14", views: 10, downloads: 2 },
      { date: "2026-03-15", label: "Mar 15", views: 20, downloads: 3 },
    ],
    insights: { avgDailyViews: 41.1, avgDailyDownloads: 2.6, bestDay: { date: "2026-03-15", label: "Mar 15", views: 20, downloads: 3 }, topFiles: [{ title: "Chapter 1.pdf", fileType: "document", downloads: 9 }] },
    ...over,
  };
}

let container: HTMLDivElement;
let root: Root;
let urls: string[];
let responder: (url: string) => Response;

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
const q = (sel: string) => document.body.querySelector(sel) as HTMLElement | null;
const qa = (sel: string) => Array.from(document.body.querySelectorAll(sel)) as HTMLElement[];
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const click = (el: Element | null | undefined) => act(async () => (el as HTMLElement).click());
function typeInto(el: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}
const mount = async (id = 5) => {
  await act(async () => root.render(<PlaylistAnalyticsPage playlistId={id} />));
  await flush();
};

beforeEach(() => {
  urls = [];
  responder = () => json(payload());
  Object.values(router).forEach((m) => m.mockReset());
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    urls.push(url);
    return responder(url);
  }));
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

describe("Playlist Analytics page", () => {
  it("loads the CURRENT playlist's analytics with the browser timezone and shows title, playlist name and period", async () => {
    await mount(5);
    expect(urls).toHaveLength(1);
    expect(urls[0]).toMatch(/^\/api\/playlists\/5\/analytics\?/);
    expect(urls[0]).toContain("range=30d");
    expect(urls[0]).toMatch(/tz=[^&]+/);
    expect(q('[data-testid="analytics-title"]')?.textContent).toBe("Playlist Analytics");
    expect(q('[data-testid="analytics-playlist-name"]')?.textContent).toBe("Business Studies");
    expect(q('[data-testid="analytics-period"]')?.textContent).toContain("Feb 14 – Mar 15, 2026");
  });

  it("shows exactly three headline metrics: Views, Downloads, Earnings — and never requests / deliveries as headline stats", async () => {
    await mount();
    const cards = qa('[data-testid="metrics"] > div');
    expect(cards).toHaveLength(3);
    expect(cards.map((c) => c.querySelector("p")?.textContent?.trim())).toEqual(["Views", "Downloads", "Earnings"]);
    expect(q('[data-testid="metric-views-value"]')?.textContent).toBe("1,234");
    expect(q('[data-testid="metric-views"]')?.textContent).toContain("456 unique viewers");
    expect(q('[data-testid="metric-downloads-value"]')?.textContent).toBe("78");
    const text = q('[data-testid="analytics-page"]')!.textContent!;
    expect(text).not.toMatch(/File requests|Successful deliver|Confirmed file deliver/i);
  });

  it("does not present an invented earnings figure: Earnings says it's not available and the earnings chart is a separate explanation", async () => {
    await mount();
    expect(q('[data-testid="metric-earnings-value"]')?.textContent).toBe("Not available");
    expect(q('[data-testid="earnings-section"]')).not.toBeNull();
    expect(q('[data-testid="earnings-unavailable"]')?.textContent).toContain("aren't available");
    expect(q('[data-testid="earnings-section"] .recharts-wrapper')).toBeNull();
    expect(q('[data-testid="metrics"]')!.textContent).not.toMatch(/[$€£]|USDT|\d+\.\d{2}/);
  });

  it("renders the Views + Downloads chart with a legend in its own section (not mixed with earnings)", async () => {
    await mount();
    const section = q('[data-testid="performance-section"]')!;
    expect(section.querySelector('[data-testid="views-downloads-chart"]')).not.toBeNull();
    expect(section.querySelector('[data-testid="chart-legend"]')?.textContent).toMatch(/Views.*Downloads/);
    expect(section.textContent).not.toMatch(/Earnings/);
  });

  it("shows insights from real data only (averages, best day, best files)", async () => {
    await mount();
    const text = q('[data-testid="insights"]')!.textContent!;
    expect(text).toContain("Avg. daily views");
    expect(text).toContain("Mar 15");
    expect(qa('[data-testid="top-files"] li')[0].textContent).toContain("Chapter 1.pdf");
  });

  it("shows an empty state (and no chart) for a period without activity", async () => {
    responder = () => json(payload({ views: { total: 0, unique: 0 }, downloads: { total: 0 }, insights: { avgDailyViews: 0, avgDailyDownloads: 0, bestDay: null, topFiles: [] } }));
    await mount();
    expect(q('[data-testid="analytics-empty"]')?.textContent).toContain("No activity in this period");
    expect(q('[data-testid="views-downloads-chart"]')).toBeNull();
    expect(q('[data-testid="insights"]')).toBeNull();
    expect(q('[data-testid="metric-views-value"]')?.textContent).toBe("0");
  });
});

describe("date range filter", () => {
  it("offers Last 7/30/90 Days, All Time and Custom; the active one is pressed", async () => {
    await mount();
    expect(qa('[data-testid="range-picker"] [role="group"] button').map((b) => b.textContent?.trim())).toEqual(["Last 7 Days", "Last 30 Days", "Last 90 Days", "All Time", "Custom"]);
    expect(q('[data-testid="range-30d"]')?.getAttribute("aria-pressed")).toBe("true");
  });

  it("each preset reloads ALL metrics for that range and updates the shown period", async () => {
    await mount();
    responder = (url) =>
      json(url.includes("range=7d") ? payload({ views: { total: 5, unique: 4 }, downloads: { total: 1 } }, { key: "7d", from: "2026-03-09", days: 7 }) : payload());
    await click(q('[data-testid="range-7d"]'));
    await flush();
    expect(urls[urls.length - 1]).toContain("range=7d");
    expect(q('[data-testid="metric-views-value"]')?.textContent).toBe("5");
    expect(q('[data-testid="metric-downloads-value"]')?.textContent).toBe("1");
    expect(q('[data-testid="analytics-period"]')?.textContent).toContain("Mar 9 – Mar 15, 2026");

    await click(q('[data-testid="range-all"]'));
    await flush();
    expect(urls[urls.length - 1]).toContain("range=all");
    await click(q('[data-testid="range-90d"]'));
    await flush();
    expect(urls[urls.length - 1]).toContain("range=90d");
  });

  it("Custom opens a date form limited to today; applying sends from/to; reversed or empty dates are rejected without a request", async () => {
    await mount();
    await click(q('[data-testid="range-custom"]'));
    const from = q('[data-testid="custom-from"]') as HTMLInputElement;
    const to = q('[data-testid="custom-to"]') as HTMLInputElement;
    expect(from.max).toBe(TODAY);
    expect(to.max).toBe(TODAY);

    const before = urls.length;
    await click(q('[data-testid="custom-apply"]')); // both empty
    expect(q('[data-testid="custom-range-error"]')?.textContent).toContain("start and an end");
    await act(async () => typeInto(from, "2026-03-10"));
    await act(async () => typeInto(to, "2026-03-01"));
    await click(q('[data-testid="custom-apply"]'));
    expect(q('[data-testid="custom-range-error"]')?.textContent).toContain("on or before");
    expect(urls.length).toBe(before);

    responder = () => json(payload({}, { key: "custom", from: "2026-03-01", to: "2026-03-10", days: 10 }));
    await act(async () => typeInto(to, "2026-03-12"));
    await act(async () => typeInto(from, "2026-03-01"));
    await click(q('[data-testid="custom-apply"]'));
    await flush();
    expect(urls[urls.length - 1]).toContain("range=custom");
    expect(urls[urls.length - 1]).toContain("from=2026-03-01");
    expect(urls[urls.length - 1]).toContain("to=2026-03-12");
    expect(q('[data-testid="range-custom"]')?.getAttribute("aria-pressed")).toBe("true");
  });

  it("shows the server's message when it rejects a range, and keeps the last good numbers", async () => {
    await mount();
    responder = () => json({ error: "The start date can't be in the future" }, 400);
    await click(q('[data-testid="range-7d"]'));
    await flush();
    expect(q('[data-testid="analytics-inline-error"]')?.textContent).toContain("can't be in the future");
    expect(q('[data-testid="metric-views-value"]')?.textContent).toBe("1,234");
  });
});

describe("states and navigation", () => {
  it("shows a skeleton while loading", async () => {
    let release: (r: Response) => void = () => undefined;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((r) => (release = r))));
    await mount();
    expect(q('[aria-label="Loading analytics"]')).not.toBeNull();
    await act(async () => release(json(payload())));
    await flush();
    expect(q('[aria-label="Loading analytics"]')).toBeNull();
  });

  it("shows 'Playlist not found' (no data) when the server answers 404 — e.g. someone else's playlist", async () => {
    responder = () => json({ error: "Not found" }, 404);
    await mount(99);
    expect(q('[data-testid="analytics-notfound"]')).not.toBeNull();
    expect(q('[data-testid="metrics"]')).toBeNull();
  });

  it("shows an error with Try again, which reloads", async () => {
    responder = () => json({ error: "boom" }, 500);
    await mount();
    expect(q('[data-testid="analytics-error"]')).not.toBeNull();
    responder = () => json(payload());
    await click(Array.from(document.body.querySelectorAll("button")).find((b) => b.textContent?.includes("Try again")));
    await flush();
    expect(q('[data-testid="metrics"]')).not.toBeNull();
  });

  it("outside Telegram the Back button returns to THIS playlist's management page", async () => {
    await mount(5);
    await click(q('[data-testid="analytics-back"]'));
    expect(router.push).toHaveBeenCalledWith("/playlists/5");
  });

  it("inside Telegram the native Back Button is the only back control and returns to the same playlist", async () => {
    const tg = installTelegramBackButton();
    await mount(7);
    expect(q('[data-testid="analytics-back"]')).toBeNull();
    expect(tg.btn.isVisible).toBe(true);
    await act(async () => tg.press());
    expect(router.push).toHaveBeenCalledWith("/playlists/7");
  });
});
