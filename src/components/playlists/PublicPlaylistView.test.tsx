// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/components/ui/Toast";
import type { PublicPlaylistPayload } from "@/lib/playlistSharing";
import { STORAGE_KEY } from "@/lib/savedItems";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));
const router = { push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn(), refresh: vi.fn(), forward: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router }));

import PublicPlaylistView from "./PublicPlaylistView";

const SLUG = "AbCdEfGhIjKlMnOp";
const item = (position: number, over: Record<string, unknown> = {}) => ({
  position, slug: `file-${position}`, title: `Lesson ${position}`, fileType: "audio", mimeType: null, fileSize: 2048,
  thumbnailUrl: null, hasPassword: false, starsPrice: 0, ...over,
});
const open = (items = [item(1), item(2), item(3)]): PublicPlaylistPayload => ({
  playlist: { title: "Accounting", description: "Intro course", thumbnailUrl: "https://cdn/c.webp", itemCount: items.length, hasPassword: false, locked: null },
  creator: { firstName: "Ada", username: "ada_secret_handle", avatarUrl: null },
  items,
});
const detail = (n: number) => ({ file: { slug: `file-${n}`, description: `About lesson ${n}`, views: 5 * n, downloads: n } });

let container: HTMLDivElement;
let root: Root;
let respond: (url: string, init?: RequestInit) => Response;
let calls: { url: string; method: string; body?: unknown }[];
const json = (d: unknown, status = 200) => new Response(JSON.stringify(d), { status });
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const q = (sel: string) => container.querySelector(sel) as HTMLElement | null;
const qa = (sel: string) => Array.from(container.querySelectorAll(sel)) as HTMLElement[];
const click = (el: Element | null | undefined) => act(async () => { (el as HTMLElement).click(); });
const title = () => q('[data-testid="file-title"]')!.textContent;
const saved = () => JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") as { type: string; id: string; lastFile: string | null }[];

async function mount() {
  await act(async () => root.render(<ToastProvider><PublicPlaylistView slug={SLUG} /></ToastProvider>));
  await flush();
}
const defaultRespond = (url: string, init?: RequestInit) => {
  if (url.startsWith("/api/p/")) return json(open());
  const m = url.match(/^\/api\/link\/file-(\d)$/);
  if (m && init?.method === "POST") return json({ success: true, telegramMessageLink: `https://t.me/c/1/${m[1]}` });
  if (m) return json(detail(Number(m[1])));
  if (url === "/api/reports") return json({ ok: true }, 201);
  return json({}, 404);
};

beforeEach(() => {
  calls = [];
  Object.values(router).forEach((m) => m.mockReset());
  localStorage.clear();
  window.history.replaceState(null, "", `/p/${SLUG}`);
  respond = defaultRespond;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? "GET", body: init?.body ? JSON.parse(init.body as string) : undefined });
    return respond(url, init);
  }));
  window.scrollTo = vi.fn();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.useRealTimers();
  delete (window as unknown as { Telegram?: unknown }).Telegram;
});

describe("unified viewer — layout", () => {
  it("shows the selected file on top in the specified order, then the playlist list", async () => {
    await mount();
    const viewer = q('[data-testid="file-viewer"]')!;
    expect(viewer.getAttribute("data-mode")).toBe("playlist");
    expect(title()).toBe("Lesson 1");
    expect(q('[data-testid="file-title"]')!.tagName).toBe("H1");
    expect(q('[data-testid="playlist-meta"]')!.textContent).toBe("Playlist • 3 audio");

    // DOM order: hero → title → uploader → playlist meta → description area → action row → list
    const order = ['[data-testid="file-hero"]', '[data-testid="file-title"]', '[data-testid="uploader"]', '[data-testid="playlist-meta"]', '[data-testid="action-row"]', '[data-testid="playlist-list"]'].map((s) => q(s)!);
    for (let i = 1; i < order.length; i++) expect(order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING, `element ${i}`).toBeTruthy();
    expect(qa('[data-testid="playlist-item"]')).toHaveLength(3);
  });

  it("uploader shows photo + display name only — never the username — and there is no logo, nav, Previous/Next or Telegram button", async () => {
    await mount();
    expect(q('[data-testid="uploader"] p')!.textContent).toBe("Ada");
    expect(container.innerHTML).not.toContain("ada_secret_handle");
    expect(container.innerHTML).not.toMatch(/Onfile home|aria-label="Onfile"|<nav|Previous|Next\b/i);
    expect(q('a[href="/"]')).toBeNull();
    expect(qa("button, a").map((b) => b.textContent).join("|")).not.toMatch(/Open in Telegram/);
  });

  it("has ONE action row with exactly four buttons: Get File (3/6) + Save, Share, Report (1/6 each, icon-only with labels)", async () => {
    await mount();
    const row = q('[data-testid="action-row"]')!;
    expect(row.className).toContain("grid-cols-6");
    const buttons = Array.from(row.children) as HTMLElement[];
    expect(buttons).toHaveLength(4);
    expect(buttons[0].className).toContain("col-span-3");
    expect(buttons[0].textContent).toContain("Get File");
    expect(buttons[0].querySelector("svg")).not.toBeNull();
    for (const [i, name] of [[1, "Save playlist"], [2, "Share playlist"], [3, "Report"]] as const) {
      expect(buttons[i].textContent).toBe("");
      expect(buttons[i].getAttribute("aria-label")).toBe(name);
      expect(buttons[i].getAttribute("title")).toBeTruthy();
      expect(buttons[i].querySelector("svg")).not.toBeNull();
    }
  });

  it("does not show the old advertisement card", async () => {
    await mount();
    expect(container.textContent).not.toMatch(/Watch a short ad|10-second ad|Free access after one short ad|Step 1|Ad space|Powered by Adsgram/i);
    expect(q('[role="progressbar"]')).toBeNull();
  });
});

describe("unified viewer — in-place selection", () => {
  it("clicking a file updates the top section in place: no navigation, no reload, list stays, selected row highlighted", async () => {
    await mount();
    expect(title()).toBe("Lesson 1");
    await click(qa('[data-testid="playlist-item"]')[1]);
    await flush();

    expect(title()).toBe("Lesson 2");
    expect(router.push).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe(`/p/${SLUG}`); // existing playlist route retained
    expect(window.location.search).toBe("?f=file-2");
    expect(qa('[data-testid="playlist-item"]')).toHaveLength(3); // list still visible
    expect(qa('[data-testid="playlist-item"]').map((a) => a.getAttribute("aria-current"))).toEqual([null, "true", null]);
    expect(q('[data-testid="description"]')!.textContent).toContain("About lesson 2"); // details loaded for the new file
    expect(q('[data-testid="file-facts"]')!.textContent).toContain("10 views");
    expect(window.scrollTo).toHaveBeenCalled();
  });

  it("each file in the playlist can be selected and shows its own title", async () => {
    await mount();
    for (const n of [3, 2, 1]) {
      await click(qa('[data-testid="playlist-item"]')[n - 1]);
      await flush();
      expect(title()).toBe(`Lesson ${n}`);
    }
  });

  it("modified clicks (new tab) are left to the browser", async () => {
    await mount();
    const a = qa('[data-testid="playlist-item"]')[2] as HTMLAnchorElement;
    expect(a.getAttribute("href")).toBe(`/p/${SLUG}?f=file-3`);
    await act(async () => { a.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ctrlKey: true })); });
    expect(title()).toBe("Lesson 1");
  });

  it("refresh restores the selected file from ?f=; an unknown or malformed value falls back to the first file", async () => {
    window.history.replaceState(null, "", `/p/${SLUG}?f=file-3`);
    await mount();
    expect(title()).toBe("Lesson 3");
    expect(qa('[data-testid="playlist-item"]')[2].getAttribute("aria-current")).toBe("true");

    await act(async () => root.unmount());
    root = createRoot(container);
    window.history.replaceState(null, "", `/p/${SLUG}?f=not-in-this-playlist`);
    await mount();
    expect(title()).toBe("Lesson 1");

    await act(async () => root.unmount());
    root = createRoot(container);
    window.history.replaceState(null, "", `/p/${SLUG}?f=%3Cscript%3E`);
    await mount();
    expect(title()).toBe("Lesson 1");
  });

  it("an unpublished/hidden file slug in the URL can't be selected (only server-listed items are)", async () => {
    window.history.replaceState(null, "", `/p/${SLUG}?f=hidden-file`);
    await mount();
    expect(title()).toBe("Lesson 1");
    expect(calls.some((c) => c.url.includes("hidden-file"))).toBe(false);
  });

  it("browser Back / Forward walk through earlier selections", async () => {
    await mount();
    await click(qa('[data-testid="playlist-item"]')[1]);
    await click(qa('[data-testid="playlist-item"]')[2]);
    await flush();
    expect(title()).toBe("Lesson 3");

    await act(async () => { window.history.back(); await new Promise((r) => setTimeout(r, 30)); });
    expect(title()).toBe("Lesson 2");
    await act(async () => { window.history.back(); await new Promise((r) => setTimeout(r, 30)); });
    expect(title()).toBe("Lesson 1");
    await act(async () => { window.history.forward(); await new Promise((r) => setTimeout(r, 30)); });
    expect(title()).toBe("Lesson 2");
  });
});

describe("unified viewer — Save (device-local)", () => {
  it("saves the ENTIRE playlist as ONE entry; selecting other files never adds entries", async () => {
    await mount();
    expect(q('[data-testid="saved-fab"]')).toBeNull(); // nothing saved yet
    await click(q('[data-testid="save"]'));
    expect(saved()).toHaveLength(1);
    expect(saved()[0]).toMatchObject({ type: "playlist", id: SLUG, lastFile: "file-1" });
    expect(q('[data-testid="saved-fab"]')).not.toBeNull();
    expect(q('[data-testid="saved-count"]')!.textContent).toBe("1");

    await click(qa('[data-testid="playlist-item"]')[1]);
    await click(qa('[data-testid="playlist-item"]')[2]);
    await flush();
    expect(saved()).toHaveLength(1); // still one entry
    expect(saved()[0]).toMatchObject({ type: "playlist", id: SLUG, lastFile: "file-3" }); // remembers where the visitor was
    expect(q('[data-testid="save"]')!.getAttribute("aria-pressed")).toBe("true"); // playlist is saved, whichever file is selected
    expect(localStorage.getItem(STORAGE_KEY)).not.toMatch(/t\.me|telegram/i);
  });

  it("selecting files in an UNSAVED playlist creates nothing", async () => {
    await mount();
    await click(qa('[data-testid="playlist-item"]')[1]);
    await flush();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("the drawer lists the saved playlist, links back to the last file, removes entries and clears all", async () => {
    await mount();
    await click(q('[data-testid="save"]'));
    await click(qa('[data-testid="playlist-item"]')[1]);
    await flush();
    await click(q('[data-testid="saved-fab"]'));
    const drawer = document.querySelector('[data-testid="saved-drawer"]') as HTMLElement;
    expect(drawer.textContent).toMatch(/this device and browser only/i);
    const link = drawer.querySelector('[data-testid="saved-open"]') as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe(`/p/${SLUG}?f=file-2`);
    await click(drawer.querySelector('[data-testid="saved-clear"]'));
    await click(document.querySelector('[data-testid="saved-clear-confirm"]'));
    expect(saved()).toHaveLength(0);
    expect(q('[data-testid="saved-fab"]')).toBeNull(); // button disappears with the last entry
  });

  it("tolerates malformed or outdated storage", async () => {
    localStorage.setItem(STORAGE_KEY, "{not json");
    await mount();
    expect(q('[data-testid="saved-fab"]')).toBeNull();
    await click(q('[data-testid="save"]'));
    expect(saved()).toHaveLength(1);
  });
});

describe("unified viewer — Share", () => {
  it("shares the playlist's public link (never the file or a private Telegram URL)", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    await mount();
    await click(qa('[data-testid="playlist-item"]')[1]);
    await click(q('[data-testid="share"]'));
    await flush();
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/p/${SLUG}`);
    expect(document.body.textContent).toContain("Playlist link copied");
    Reflect.deleteProperty(navigator, "clipboard");
  });
});

describe("unified viewer — Report", () => {
  const openReport = async () => { await click(q('[data-testid="report"]')); };
  const dlg = () => document.querySelector("form[aria-label='Report content']") as HTMLFormElement;
  const submitForm = () => act(async () => { dlg().dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
  const pick = (value: string) => click(document.querySelector(`input[name="report-reason"][value="${value}"]`));

  it("offers the five reasons, requires one, and lets the visitor choose the selected file or the playlist", async () => {
    await mount();
    await click(qa('[data-testid="playlist-item"]')[1]);
    await openReport();
    const labels = Array.from(dlg().querySelectorAll('input[name="report-reason"]')).map((i) => (i as HTMLInputElement).value);
    expect(labels).toEqual(["copyright", "inappropriate", "spam", "broken_link", "other"]);
    expect(dlg().textContent).toContain("Lesson 2");
    expect(dlg().textContent).toContain("Accounting");
    expect((Array.from(dlg().querySelectorAll("button")).find((b) => b.textContent === "Submit report") as HTMLButtonElement).disabled).toBe(true);
  });

  it("reports the currently selected file by slug and only claims success after the server confirms", async () => {
    await mount();
    await click(qa('[data-testid="playlist-item"]')[1]);
    await openReport();
    await pick("spam");
    await submitForm();
    await flush();
    const post = calls.find((c) => c.url === "/api/reports")!;
    expect(post.body).toMatchObject({ target: "file", slug: "file-2", reason: "spam" });
    expect(document.querySelector('[data-testid="report-success"]')).not.toBeNull();
  });

  it("can report the playlist itself", async () => {
    await mount();
    await openReport();
    await click(document.querySelector('input[name="report-target"]:not(:checked)'));
    await pick("copyright");
    await submitForm();
    await flush();
    expect(calls.find((c) => c.url === "/api/reports")!.body).toMatchObject({ target: "playlist", slug: SLUG, reason: "copyright" });
  });

  it("shows an error and NO success when the server fails or rate limits", async () => {
    respond = (url, init) => (url === "/api/reports" ? json({ error: "x" }, 500) : defaultRespond(url, init));
    await mount();
    await openReport();
    await pick("other");
    await submitForm();
    await flush();
    expect(document.body.textContent).toContain("couldn’t submit your report");
    expect(document.querySelector('[data-testid="report-success"]')).toBeNull();

    respond = (url, init) => (url === "/api/reports" ? json({ error: "x" }, 429) : defaultRespond(url, init));
    await submitForm();
    await flush();
    expect(document.body.textContent).toMatch(/several reports/);
    expect(document.querySelector('[data-testid="report-success"]')).toBeNull();
  });
});

describe("unified viewer — Get File keeps the existing server-side flow", () => {
  const advance = async (ms: number) => { for (let i = 0; i < ms / 1000; i++) await act(async () => { await vi.advanceTimersByTimeAsync(1000); }); };
  const posts = () => calls.filter((c) => c.method === "POST" && c.url.startsWith("/api/link/"));

  async function mountFake() {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    await act(async () => root.render(<ToastProvider><PublicPlaylistView slug={SLUG} /></ToastProvider>));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  }

  it("runs the existing ad countdown first (no card), then asks the server to authorise the SELECTED file", async () => {
    await mountFake();
    await click(qa('[data-testid="playlist-item"]')[1]); // select file-2
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    const get = q('[data-testid="get-file"]') as HTMLButtonElement;
    await click(get);
    expect(posts()).toHaveLength(0);
    expect(get.disabled).toBe(true);
    expect(q('[role="progressbar"]')).not.toBeNull();
    await advance(9000);
    expect(get.disabled).toBe(true);
    expect(posts()).toHaveLength(0);
    await advance(1000);
    expect(get.disabled).toBe(false);
    expect(posts()).toHaveLength(0); // the ad finishing alone grants nothing

    await act(async () => { get.click(); get.click(); }); // double tap
    expect(posts()).toHaveLength(1);
    expect(posts()[0].url).toBe("/api/link/file-2");
    const link = q('a[href="https://t.me/c/1/2"]') as HTMLAnchorElement;
    expect(link).not.toBeNull();
    expect(link.rel).toContain("noopener");
  });

  it("switching the selected file resets the access state (no unlock carries over)", async () => {
    await mountFake();
    await click(q('[data-testid="get-file"]'));
    await advance(10_000);
    await click(q('[data-testid="get-file"]'));
    expect(q('a[href="https://t.me/c/1/1"]')).not.toBeNull();
    await click(qa('[data-testid="playlist-item"]')[1]);
    expect(q('a[href^="https://t.me"]')).toBeNull();
    expect((q('[data-testid="get-file"]') as HTMLButtonElement).disabled).toBe(false);
  });

  it("password files ask for the password (no ad); the server decides", async () => {
    respond = (url, init) => {
      if (url.startsWith("/api/p/")) return json(open([item(1), item(2, { hasPassword: true })]));
      if (init?.method === "POST") return JSON.parse(init.body as string).password === "secret" ? json({ success: true, telegramMessageLink: "https://t.me/c/1/2" }) : json({ error: "Wrong password" }, 403);
      return json(detail(2));
    };
    await mountFake();
    await click(qa('[data-testid="playlist-item"]')[1]);
    await click(q('[data-testid="get-file"]'));
    expect(q('[role="progressbar"]')).toBeNull();
    const input = document.querySelector("#file-password") as HTMLInputElement;
    expect(input).not.toBeNull();
    const type = (v: string) => act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, v); input.dispatchEvent(new Event("input", { bubbles: true })); });
    const submit = () => act(async () => { input.form!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    await type("nope");
    await submit();
    expect(document.body.textContent).toContain("Incorrect password");
    expect(q('a[href^="https://t.me"]')).toBeNull();
    await type("secret");
    await submit();
    expect(q('a[href="https://t.me/c/1/2"]')).not.toBeNull();
    expect(posts().map((p) => (p.body as { password: string }).password)).toEqual(["nope", "secret"]);
  });

  it("Stars price is shown honestly and never unlocks anything", async () => {
    respond = (url, init) => (url.startsWith("/api/p/") ? json(open([item(1, { starsPrice: 50 })])) : defaultRespond(url, init));
    await mountFake();
    expect(q('[data-testid="stars-note"]')!.textContent).toContain("isn’t available yet");
    expect(posts()).toHaveLength(0);
  });
});

describe("states", () => {
  it("Telegram browser / Mini App: signals ready + expand and registers the native Back button", async () => {
    const BackButton = { show: vi.fn(), hide: vi.fn(), onClick: vi.fn(), offClick: vi.fn() };
    const ready = vi.fn();
    const expand = vi.fn();
    (window as unknown as { Telegram: unknown }).Telegram = { WebApp: { ready, expand, BackButton, initData: "x" } };
    await mount();
    expect(ready).toHaveBeenCalled();
    expect(expand).toHaveBeenCalled();
    expect(BackButton.show).toHaveBeenCalled();
  });

  it("a private / unknown link shows 'Playlist not found' without any content", async () => {
    respond = () => json({ error: "Playlist not found" }, 404);
    await mount();
    expect(q('[data-testid="public-playlist-message"]')!.textContent).toContain("Playlist not found");
    expect(q('[data-testid="playlist-list"]')).toBeNull();
  });

  it("shows a retryable error state when the network fails", async () => {
    respond = () => json({}, 500);
    await mount();
    expect(container.textContent).toContain("Couldn’t load this playlist");
    respond = defaultRespond;
    await click(qa("button").find((b) => b.textContent === "Try again"));
    await flush();
    expect(title()).toBe("Lesson 1");
  });

  it("an empty public playlist explains nothing is published yet and shows no actions", async () => {
    respond = () => json(open([]));
    await mount();
    expect(q('[data-testid="public-playlist-empty"]')).not.toBeNull();
    expect(q('[data-testid="action-row"]')).toBeNull();
  });

  it("shows file lock / price hints in the list without exposing any link", async () => {
    respond = (url, init) => (url.startsWith("/api/p/") ? json(open([item(1, { hasPassword: true }), item(2, { starsPrice: 20 })])) : defaultRespond(url, init));
    await mount();
    const links = qa('[data-testid="playlist-item"]');
    expect(links[0].querySelector('[aria-label="Password protected"]')).not.toBeNull();
    expect(links[1].textContent).toContain("20");
    expect(container.innerHTML).not.toContain("t.me");
  });

  it("list rows show type and size, and a missing description renders nothing", async () => {
    respond = (url, init) => (/^\/api\/link\//.test(url) && !init?.method ? json({ file: { slug: "file-1", description: null, views: 0, downloads: 0 } }) : defaultRespond(url, init));
    await mount();
    expect(qa('[data-testid="playlist-item"]')[0].textContent).toContain("Audio · 2.0 KB");
    expect(q('[data-testid="description"]')).toBeNull();
    expect(q('[data-testid="description-loading"]')).toBeNull();
  });

  it("long descriptions expand on click and collapse again", async () => {
    const long = "A very long description. ".repeat(20);
    respond = (url, init) => (/^\/api\/link\//.test(url) && !init?.method ? json({ file: { slug: "file-1", description: long, views: 1, downloads: 1 } }) : defaultRespond(url, init));
    await mount();
    const d = q('button[data-testid="description"]')!;
    expect(d.getAttribute("aria-expanded")).toBe("false");
    expect(d.querySelector(".line-clamp-2")).not.toBeNull();
    await click(d);
    expect(d.getAttribute("aria-expanded")).toBe("true");
    expect(d.querySelector(".line-clamp-2")).toBeNull();
    await click(d);
    expect(d.querySelector(".line-clamp-2")).not.toBeNull();
  });
});

describe("password-protected playlist", () => {
  const locked = (): PublicPlaylistPayload => ({ playlist: { title: "Secret", description: null, thumbnailUrl: null, itemCount: 0, hasPassword: true, locked: "password" }, creator: null, items: [] });

  it("shows only the password form — no items, no actions — and unlocks through the server", async () => {
    let unlocked = false;
    const posted: unknown[] = [];
    respond = (url, init) => {
      if (init?.method === "POST") {
        const body = JSON.parse(init.body as string);
        posted.push(body);
        if (body.password === "right") { unlocked = true; return json({ success: true }); }
        return json({ error: "Wrong password" }, 403);
      }
      return url.startsWith("/api/p/") ? json(unlocked ? open() : locked()) : defaultRespond(url, init);
    };
    await mount();
    expect(q('[data-testid="public-playlist-locked"]')).not.toBeNull();
    expect(q('[data-testid="playlist-list"]')).toBeNull();
    expect(q('[data-testid="action-row"]')).toBeNull();

    const input = q("#pl-unlock") as HTMLInputElement;
    const type = (v: string) => act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, v);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await type("wrong");
    await act(async () => q("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    await flush();
    expect(container.textContent).toContain("Incorrect password");
    expect(q('[data-testid="playlist-list"]')).toBeNull();

    await type("right");
    await act(async () => q("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    await flush();
    expect(q('[data-testid="public-playlist-locked"]')).toBeNull();
    expect(qa('[data-testid="playlist-item"]')).toHaveLength(3);
    expect(posted).toEqual([{ password: "wrong" }, { password: "right" }]);
  });

  it("a locked playlist ignores ?f= and fetches no file details", async () => {
    window.history.replaceState(null, "", `/p/${SLUG}?f=file-2`);
    respond = (url, init) => (url.startsWith("/api/p/") ? json(locked()) : defaultRespond(url, init));
    await mount();
    expect(q('[data-testid="file-viewer"]')).toBeNull();
    expect(calls.some((c) => c.url.startsWith("/api/link/"))).toBe(false);
  });
});

describe("Stars-priced playlist", () => {
  it("stays locked with an honest explanation and no content", async () => {
    respond = () => json({ playlist: { title: "Paid", description: null, thumbnailUrl: null, itemCount: 0, hasPassword: false, locked: "stars" }, creator: null, items: [] });
    await mount();
    expect(q('[data-testid="public-playlist-paid"]')!.textContent).toContain("Stars");
    expect(q('[data-testid="playlist-list"]')).toBeNull();
    expect(q('[data-testid="action-row"]')).toBeNull();
  });
});

describe("mobile layout + themes", () => {
  it("is a width-capped, wrapping column with no horizontal overflow, styled with theme tokens", async () => {
    await mount();
    const col = q('[data-testid="file-viewer"] > div')!;
    expect(col.className).toContain("max-w-2xl");
    expect(col.className).toContain("w-full");
    expect(col.className).toContain("overflow-x-hidden");
    expect(q('[data-testid="file-title"]')!.className).toContain("break-words");
    expect(q('[data-testid="file-hero"]')!.className).toContain("overflow-hidden");
    for (const a of qa('[data-testid="playlist-item"]')) expect(a.querySelector(".min-w-0")).not.toBeNull();
    expect(container.innerHTML).not.toMatch(/\b(bg-white|bg-black|text-black|bg-gray-\d+|text-gray-\d+)\b/);
  });
});
