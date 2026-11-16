// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/components/ui/Toast";
import type { PublicPlaylistPayload } from "@/lib/playlistSharing";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));
const router = { push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn(), refresh: vi.fn(), forward: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router }));

import PublicPlaylistView from "./PublicPlaylistView";

const SLUG = "AbCdEfGhIjKlMnOp";
const item = (position: number, over: Record<string, unknown> = {}) => ({
  position, slug: `file-${position}`, title: `Lesson ${position}.pdf`, fileType: "document", mimeType: null, fileSize: 2048,
  thumbnailUrl: null, hasPassword: false, starsPrice: 0, ...over,
});
const open = (items = [item(1), item(2), item(3)]): PublicPlaylistPayload => ({
  playlist: { title: "Accounting", description: "Intro course", thumbnailUrl: "https://cdn/c.webp", itemCount: items.length, hasPassword: false, locked: null },
  creator: { firstName: "Ada", username: "ada", avatarUrl: null },
  items,
});

let container: HTMLDivElement;
let root: Root;
let respond: (url: string, init?: RequestInit) => Response;
let posts: unknown[];
const json = (d: unknown, status = 200) => new Response(JSON.stringify(d), { status });
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const q = (sel: string) => container.querySelector(sel) as HTMLElement | null;
const qa = (sel: string) => Array.from(container.querySelectorAll(sel)) as HTMLElement[];

async function mount() {
  await act(async () => root.render(<ToastProvider><PublicPlaylistView slug={SLUG} /></ToastProvider>));
  await flush();
}

beforeEach(() => {
  posts = [];
  Object.values(router).forEach((m) => m.mockReset());
  localStorage.clear();
  respond = () => json(open());
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") posts.push(JSON.parse(init.body as string));
    return respond(url, init);
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

describe("public playlist page", () => {
  it("renders cover, title, description, creator and the ordered items as real links into the file page", async () => {
    await mount();
    expect(q('[data-testid="public-playlist-title"]')!.textContent).toBe("Accounting");
    expect(q('[data-testid="public-playlist-title"]')!.tagName).toBe("H1");
    expect(q('[data-testid="public-playlist-description"]')!.textContent).toBe("Intro course");
    expect((q('[data-testid="public-playlist-cover"] img') as HTMLImageElement).src).toBe("https://cdn/c.webp");
    expect(q('[data-testid="public-playlist-count"]')!.textContent!.trim()).toBe("3 files");
    expect(container.textContent).toContain("Ada");
    const links = qa('[data-testid="public-playlist-item"]');
    expect(links.map((a) => a.querySelector(".line-clamp-2")?.textContent)).toEqual(["Lesson 1.pdf", "Lesson 2.pdf", "Lesson 3.pdf"]);
    expect(links.map((a) => a.getAttribute("href"))).toEqual([1, 2, 3].map((n) => `/f/file-${n}?list=${SLUG}&i=${n}`));
    expect(links[0].textContent).toContain("2.0 KB");
    expect(links[0].textContent).not.toMatch(/\d+:\d{2}/); // no invented duration
    expect(fetch).toHaveBeenCalledWith(`/api/p/${SLUG}`, expect.objectContaining({ cache: "no-store" }));
  });

  it("has no owner controls: no edit / delete / reorder / add / menu / remove, and no numeric ids in the DOM", async () => {
    await mount();
    const html = container.innerHTML;
    expect(html).not.toMatch(/Delete|Edit playlist|Reorder|Add files|aria-haspopup|swipe-remove|drag-handle|data-file-id/i);
    expect(q('[data-testid="action-menu-button"]')).toBeNull();
    expect(qa("[draggable=true]")).toHaveLength(0);
  });

  it("'Play first' opens item 1 with the playlist context; a share button is available", async () => {
    await mount();
    expect(q('[data-testid="public-play"]')!.getAttribute("href")).toBe(`/f/file-1?list=${SLUG}&i=1`);
    expect(q('[data-testid="public-share"]')).not.toBeNull();
  });

  it("offers 'Continue' for the last opened item on this device (not for item 1)", async () => {
    localStorage.setItem(`onfile_pl_last_${SLUG}`, "3");
    await mount();
    expect(q('[data-testid="public-continue"]')!.getAttribute("href")).toBe(`/f/file-3?list=${SLUG}&i=3`);
  });

  it("Share copies the public link when native sharing isn't available", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    await mount();
    await act(async () => (q('[data-testid="public-share"]') as HTMLButtonElement).click());
    await flush();
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/p/${SLUG}`);
    expect(container.ownerDocument.body.textContent).toContain("Playlist link copied");
    Reflect.deleteProperty(navigator, "clipboard");
  });

  it("works inside the Telegram browser / Mini App: signals ready + expand and registers the native Back button", async () => {
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
    expect(q('[data-testid="public-playlist-items"]')).toBeNull();
  });

  it("shows a retryable error state when the network fails", async () => {
    respond = () => json({}, 500);
    await mount();
    expect(container.textContent).toContain("Couldn’t load this playlist");
    respond = () => json(open());
    await act(async () => (qa("button").find((b) => b.textContent === "Try again") as HTMLButtonElement).click());
    await flush();
    expect(q('[data-testid="public-playlist-title"]')).not.toBeNull();
  });

  it("an empty public playlist explains nothing is published yet", async () => {
    respond = () => json(open([]));
    await mount();
    expect(q('[data-testid="public-playlist-empty"]')).not.toBeNull();
    expect(q('[data-testid="public-play"]')).toBeNull(); // no dead button
  });

  it("shows file lock / price hints without exposing any link", async () => {
    respond = () => json(open([item(1, { hasPassword: true }), item(2, { starsPrice: 20 })]));
    await mount();
    const links = qa('[data-testid="public-playlist-item"]');
    expect(links[0].querySelector('[aria-label="Password protected"]')).not.toBeNull();
    expect(links[1].textContent).toContain("20");
    expect(container.innerHTML).not.toContain("t.me");
  });
});

describe("password-protected playlist", () => {
  const locked = (): PublicPlaylistPayload => ({ playlist: { title: "Secret", description: null, thumbnailUrl: null, itemCount: 0, hasPassword: true, locked: "password" }, creator: null, items: [] });

  it("shows only the password form — no items, no actions — and unlocks through the server", async () => {
    let unlocked = false;
    respond = (_u, init) => {
      if (init?.method === "POST") {
        const { password } = JSON.parse(init.body as string);
        if (password === "right") { unlocked = true; return json({ success: true }); }
        return json({ error: "Wrong password" }, 403);
      }
      return json(unlocked ? open() : locked());
    };
    await mount();
    expect(q('[data-testid="public-playlist-locked"]')).not.toBeNull();
    expect(q('[data-testid="public-playlist-items"]')).toBeNull();
    expect(q('[data-testid="public-play"]')).toBeNull();
    expect(q('[data-testid="public-playlist-count"]')).toBeNull();

    const input = q("#pl-unlock") as HTMLInputElement;
    const type = (v: string) => act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, v);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await type("wrong");
    await act(async () => q("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    await flush();
    expect(container.textContent).toContain("Incorrect password");
    expect(q('[data-testid="public-playlist-items"]')).toBeNull();

    await type("right");
    await act(async () => q("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    await flush();
    expect(q('[data-testid="public-playlist-locked"]')).toBeNull();
    expect(qa('[data-testid="public-playlist-item"]')).toHaveLength(3);
    expect(posts).toEqual([{ password: "wrong" }, { password: "right" }]);
  });

  it("reports rate limiting", async () => {
    respond = (_u, init) => (init?.method === "POST" ? json({ error: "Too many" }, 429) : json(locked()));
    await mount();
    const input = q("#pl-unlock") as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "x");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => q("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    await flush();
    expect(container.textContent).toContain("Too many attempts");
  });
});

describe("Stars-priced playlist", () => {
  it("stays locked with an honest explanation and no content", async () => {
    respond = () => json({ playlist: { title: "Paid", description: null, thumbnailUrl: null, itemCount: 0, hasPassword: false, locked: "stars" }, creator: null, items: [] });
    await mount();
    expect(q('[data-testid="public-playlist-paid"]')!.textContent).toContain("Stars");
    expect(q('[data-testid="public-playlist-items"]')).toBeNull();
    expect(q('[data-testid="public-play"]')).toBeNull();
  });
});

describe("mobile layout + themes", () => {
  it("is a width-capped, wrapping column (no horizontal overflow on a small Android screen) styled with theme tokens", async () => {
    await mount();
    const col = q('[data-testid="public-playlist-page"] > div')!;
    expect(col.className).toContain("max-w-2xl");
    expect(col.className).toContain("w-full");
    expect(q('[data-testid="public-playlist-title"]')!.className).toContain("break-words");
    expect(q('[data-testid="public-playlist-cover"]')!.className).toMatch(/aspect-video.*overflow-hidden|overflow-hidden.*aspect-video/);
    for (const a of qa('[data-testid="public-playlist-item"]')) expect(a.querySelector(".min-w-0")).not.toBeNull();
    expect(container.innerHTML).not.toMatch(/\b(bg-white|bg-black|text-black|bg-gray-\d+|text-gray-\d+)\b/);
  });
});
