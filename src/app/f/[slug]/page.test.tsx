// @vitest-environment jsdom
import React, { Suspense, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/components/ui/Toast";
import { STORAGE_KEY } from "@/lib/savedItems";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));
const router = { push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn(), refresh: vi.fn(), forward: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router }));

import SmartLinkPage from "./page";

let container: HTMLDivElement;
let root: Root;

const FILE = {
  id: 7, title: "Quarterly Report", description: "All the numbers.", fileType: "document", mimeType: "application/pdf",
  fileSize: 123456, hasPassword: false, starsPrice: 0, views: 12, downloads: 3, slug: "abc", thumbnailUrl: null, thumbnailWidth: null, thumbnailHeight: null,
};
const CREATOR = { firstName: "Ada", username: "ada_private_handle", avatarUrl: null };
const SHARE = "AbCdEfGhIjKlMnOp";

type Post = (body: { password: string }) => { status: number; body: unknown };
let posts: { password: string }[];
let calls: string[];
let playlistResponse: () => Response;

function mockServer(file: Record<string, unknown>, post: Post, getStatus = 200) {
  posts = [];
  calls = [];
  playlistResponse = () => new Response("{}", { status: 404 });
  vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
    // Force Join gate probe (separate from the unlock request): this file isn't gated. Not part of `calls`/`posts`.
    if (String(url).endsWith("/gate")) return Promise.resolve(new Response(JSON.stringify({ gated: false }), { status: 200 }));
    calls.push(`${init?.method ?? "GET"} ${url}`);
    if (String(url).startsWith("/api/p/")) return Promise.resolve(playlistResponse());
    if (url === "/api/reports") return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 201 }));
    if (init?.method === "POST" && String(url).startsWith("/api/link/")) {
      const body = JSON.parse(init.body as string);
      posts.push(body);
      const r = post(body);
      return Promise.resolve(new Response(JSON.stringify(r.body), { status: r.status }));
    }
    if (getStatus !== 200) return Promise.resolve(new Response(JSON.stringify({ error: "x" }), { status: getStatus }));
    return Promise.resolve(new Response(JSON.stringify({ file, creator: CREATOR }), { status: 200 }));
  }));
}
const okPost: Post = () => ({ status: 200, body: { success: true, telegramMessageLink: "https://t.me/c/1/2" } });
const resolved = <T,>(v: T) => Object.assign(Promise.resolve(v), { status: "fulfilled", value: v }) as Promise<T>;

async function mount(list?: string) {
  await act(async () => root.render(
    <ToastProvider><Suspense fallback={null}><SmartLinkPage params={resolved({ slug: "abc" })} searchParams={resolved(list ? { list } : {})} /></Suspense></ToastProvider>
  ));
  await act(async () => { await Promise.resolve(); });
  await act(async () => { await Promise.resolve(); });
}
const click = (el: Element | null | undefined) => act(async () => { (el as HTMLElement).dispatchEvent(new MouseEvent("click", { bubbles: true })); });
const q = (sel: string) => container.querySelector(sel) as HTMLElement | null;
const btn = (text: string) => Array.from(document.querySelectorAll("button, a")).find((b) => b.textContent?.includes(text)) as HTMLElement | undefined;
// React schedules each 1s countdown timer only after the previous tick has rendered, so advance one second at a time.
const tick = async (ms: number) => { for (let i = 0; i < ms / 1000; i++) await act(async () => { await vi.advanceTimersByTimeAsync(1000); }); };
async function type(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const saved = () => JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") as { type: string; id: string }[];

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: false });
  Object.values(router).forEach((m) => m.mockReset());
  localStorage.clear();
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
});

describe("standalone file mode — presentation", () => {
  it("shows hero, title, uploader (photo + name only), description and the four-button row; no logo, no playlist UI", async () => {
    mockServer(FILE, okPost);
    await mount();
    expect(q('[data-testid="file-viewer"]')!.getAttribute("data-mode")).toBe("file");
    expect(q('[data-testid="file-hero"]')).not.toBeNull();
    expect(q("h1")?.textContent).toBe("Quarterly Report");
    expect(q('[data-testid="uploader"] p')!.textContent).toBe("Ada");
    expect(container.innerHTML).not.toContain("ada_private_handle");
    expect(q('[data-testid="description"]')!.textContent).toBe("All the numbers.");
    expect(q('[data-testid="playlist-meta"]')).toBeNull();
    expect(q('[data-testid="playlist-list"]')).toBeNull();
    expect(container.innerHTML).not.toMatch(/Onfile home/);
    expect(q('a[href="/"]')).toBeNull();
    const row = q('[data-testid="action-row"]')!;
    expect(Array.from(row.children).map((c) => c.getAttribute("aria-label") ?? c.textContent!.trim())).toEqual(["Get File", "Save", "Share", "Report"]);
    expect(row.children[0].className).toContain("col-span-3");
  });

  it("falls back to FileTypeArt (no broken image) when there is no thumbnail, and uses the thumbnail when there is one", async () => {
    mockServer(FILE, okPost);
    await mount();
    expect(q('[data-testid="file-hero"] [data-testid="file-type-art"]')).not.toBeNull();
    expect(container.querySelector("img")).toBeNull();

    await act(async () => root.unmount());
    root = createRoot(container);
    mockServer({ ...FILE, thumbnailUrl: "https://cdn.example/t.jpg", thumbnailWidth: 1280, thumbnailHeight: 720 }, okPost);
    await mount();
    const hero = q('[data-testid="file-hero"]') as HTMLElement;
    expect(hero.querySelector("img")?.className).toContain("object-cover");
    expect(hero.style.aspectRatio).toBeTruthy();
  });

  it("shows a not-found state for 404 and a retryable error state for server failures", async () => {
    mockServer(FILE, okPost, 404);
    await mount();
    expect(container.textContent).toContain("File not found");

    await act(async () => root.unmount());
    root = createRoot(container);
    mockServer(FILE, okPost, 500);
    await mount();
    expect(container.textContent).toContain("Couldn’t load this file");
    expect(btn("Try again")).toBeTruthy();
  });

  it("a missing description renders nothing; a long one expands and collapses", async () => {
    mockServer({ ...FILE, description: null }, okPost);
    await mount();
    expect(q('[data-testid="description"]')).toBeNull();

    await act(async () => root.unmount());
    root = createRoot(container);
    mockServer({ ...FILE, description: "Long text. ".repeat(40) }, okPost);
    await mount();
    const d = q('button[data-testid="description"]')!;
    expect(d.getAttribute("aria-expanded")).toBe("false");
    await click(d);
    expect(d.getAttribute("aria-expanded")).toBe("true");
    await click(d);
    expect(d.getAttribute("aria-expanded")).toBe("false");
  });
});

describe("standalone file mode — Save / Share / Report", () => {
  it("Save stores ONE file entry (public slug only) and toggles off again", async () => {
    mockServer(FILE, okPost);
    await mount();
    expect(q('[data-testid="saved-fab"]')).toBeNull();
    await click(q('[data-testid="save"]'));
    expect(saved()).toHaveLength(1);
    expect(saved()[0]).toMatchObject({ type: "file", id: "abc" });
    expect(localStorage.getItem(STORAGE_KEY)).not.toMatch(/t\.me|telegram|password/i);
    expect(q('[data-testid="saved-count"]')!.textContent).toBe("1");
    await click(q('[data-testid="save"]')); // toggle
    expect(saved()).toHaveLength(0);
  });

  it("Share copies the existing /f/<slug> link", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    mockServer(FILE, okPost);
    await mount();
    await click(q('[data-testid="share"]'));
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/f/abc`);
    Reflect.deleteProperty(navigator, "clipboard");
  });

  it("Report targets the file only (no playlist choice) and sends its public slug", async () => {
    mockServer(FILE, okPost);
    await mount();
    await click(q('[data-testid="report"]'));
    expect(document.querySelector('[data-testid="report-target"]')).toBeNull();
    expect(document.body.textContent).toContain("Quarterly Report");
    await click(document.querySelector('input[name="report-reason"][value="broken_link"]'));
    await act(async () => { document.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });
    const call = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls.find((c) => c[0] === "/api/reports")!;
    expect(JSON.parse(call[1].body as string)).toMatchObject({ target: "file", slug: "abc", reason: "broken_link" });
    expect(document.querySelector('[data-testid="report-success"]')).not.toBeNull();
  });
});

describe("standalone file mode — advertisement flow (server still decides)", () => {
  const get = () => q('[data-testid="get-file"]') as HTMLButtonElement;

  it("requires the full countdown before the file can be requested; nothing is sent to the server until then", async () => {
    mockServer(FILE, okPost);
    await mount();
    expect(get().disabled).toBe(false);
    await click(get());
    expect(posts).toHaveLength(0);
    expect(get().disabled).toBe(true);
    expect(q('[role="progressbar"]')).not.toBeNull();
    await tick(5000);
    expect(get().disabled).toBe(true);
    expect(get().textContent).toContain("5s");
    await tick(5000);
    expect(get().disabled).toBe(false);
    expect(posts).toHaveLength(0); // the ad finishing alone grants nothing
  });

  it("unlocks only from the server's successful answer, and a double tap sends one request", async () => {
    mockServer(FILE, okPost);
    await mount();
    await click(get());
    await tick(10_000);
    const g = get();
    await act(async () => {
      g.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      g.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(posts).toHaveLength(1);
    expect(container.textContent).toContain("Your file is ready");
    const link = btn("Open in Telegram") as HTMLAnchorElement;
    expect(link.href).toBe("https://t.me/c/1/2");
    expect(link.rel).toContain("noopener");
  });

  it("shows an error and stays locked when the server refuses; the user can retry", async () => {
    let n = 0;
    mockServer(FILE, () => (++n === 1 ? { status: 500, body: { error: "boom" } } : okPost({ password: "" })));
    await mount();
    await click(get());
    await tick(10_000);
    await click(get());
    expect(container.querySelector('[role="alert"]')?.textContent).toMatch(/Something went wrong/);
    expect(container.textContent).not.toContain("Your file is ready");
    expect(get().disabled).toBe(false);
    await click(get());
    expect(container.textContent).toContain("Your file is ready");
  });

  it("never renders a javascript: link from the server as the Telegram target", async () => {
    mockServer(FILE, () => ({ status: 200, body: { success: true, telegramMessageLink: "javascript:alert(1)" } }));
    await mount();
    await click(get());
    await tick(10_000);
    await click(get());
    expect(container.textContent).toContain("Your file is ready");
    expect(container.querySelector('a[href^="javascript"]')).toBeNull();
  });
});

describe("standalone file mode — password & Stars", () => {
  const PW = { ...FILE, hasPassword: true };

  it("password files ask for the password (no ad); a wrong password is rejected by the server and shows an error", async () => {
    mockServer(PW, ({ password }) => (password === "secret" ? okPost({ password }) : { status: 403, body: { error: "Wrong password" } }));
    await mount();
    await click(q('[data-testid="get-file"]'));
    expect(q('[role="progressbar"]')).toBeNull();
    const input = document.querySelector("#file-password") as HTMLInputElement;
    expect((btn("Unlock file") as HTMLButtonElement).disabled).toBe(true); // empty → disabled
    await type(input, "nope");
    await click(btn("Unlock file"));
    expect(posts).toEqual([{ password: "nope" }]);
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("Incorrect password");
    expect(container.textContent).not.toContain("Your file is ready");

    await type(input, "secret");
    await click(btn("Unlock file"));
    expect(posts).toHaveLength(2);
    expect(container.textContent).toContain("Your file is ready");
  });

  it("the password field can be revealed and submitted with Enter (form submit)", async () => {
    mockServer(PW, okPost);
    await mount();
    await click(q('[data-testid="get-file"]'));
    const input = document.querySelector("#file-password") as HTMLInputElement;
    expect(input.type).toBe("password");
    await click(document.querySelector('[aria-label="Show password"]'));
    expect(input.type).toBe("text");
    await type(input, "x");
    await act(async () => { input.form!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    expect(posts).toHaveLength(1);
  });

  it("Stars: shown honestly, never unlocks anything", async () => {
    mockServer({ ...FILE, starsPrice: 100 }, okPost);
    await mount();
    expect(q('[data-testid="stars-note"]')!.textContent).toContain("isn’t available yet");
    expect(btn("Pay 100 Stars")).toBeUndefined();
    expect(posts).toHaveLength(0);
  });
});

describe("old /f/<slug>?list=<token> links", () => {
  it("forward to the unified playlist page when the public playlist really contains the file", async () => {
    mockServer(FILE, okPost);
    playlistResponse = () => new Response(JSON.stringify({ playlist: { locked: null }, creator: null, items: [{ slug: "abc" }] }), { status: 200 });
    await mount(SHARE);
    expect(router.replace).toHaveBeenCalledWith(`/p/${SHARE}?f=abc`);
  });

  it("stay a standalone file when the playlist is private, locked or doesn't contain the file", async () => {
    mockServer(FILE, okPost);
    await mount(SHARE); // playlist 404
    expect(router.replace).not.toHaveBeenCalled();
    expect(q('[data-testid="file-viewer"]')!.getAttribute("data-mode")).toBe("file");

    await act(async () => root.unmount());
    root = createRoot(container);
    mockServer(FILE, okPost);
    playlistResponse = () => new Response(JSON.stringify({ playlist: { locked: "password" }, creator: null, items: [] }), { status: 200 });
    await mount(SHARE);
    expect(router.replace).not.toHaveBeenCalled();
    expect(q('[data-testid="file-viewer"]')).not.toBeNull();
  });

  it("without ?list (or with a malformed one) the playlist endpoint is never called", async () => {
    mockServer(FILE, okPost);
    await mount();
    await act(async () => root.unmount());
    root = createRoot(container);
    await mount("42");
    expect(calls.some((c) => c.includes("/api/p/"))).toBe(false);
  });
});
