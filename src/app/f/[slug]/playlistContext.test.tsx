// @vitest-environment jsdom
import React, { Suspense, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SmartLinkPage from "./page";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("next/link", () => ({
  default: ({ href, children, replace: _r, ...rest }: { href: string; children: React.ReactNode; replace?: boolean }) => <a href={href} {...rest}>{children}</a>,
}));

const SLUG = "AbCdEfGhIjKlMnOp";
const FILE = { id: 7, title: "Video 2", fileType: "video", hasPassword: true, starsPrice: 0, views: 0, downloads: 0, slug: "file-2", thumbnailUrl: null };
const items = [1, 2, 3].map((n) => ({ position: n, slug: `file-${n}`, title: `Video ${n}`, fileType: "video", mimeType: null, fileSize: null, thumbnailUrl: null, hasPassword: false, starsPrice: 0 }));

let container: HTMLDivElement;
let root: Root;
const resolved = <T,>(v: T) => Object.assign(Promise.resolve(v), { status: "fulfilled", value: v }) as Promise<T>;

async function mount(list?: string) {
  await act(async () => root.render(<Suspense fallback={null}><SmartLinkPage params={resolved({ slug: "file-2" })} searchParams={resolved(list ? { list } : {})} /></Suspense>));
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (String(url).startsWith("/api/p/")) return new Response(JSON.stringify({ playlist: { title: "Course", locked: null, itemCount: 3 }, creator: null, items }), { status: 200 });
    return new Response(JSON.stringify({ file: FILE, creator: null }), { status: 200 });
  }));
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("file page with playlist context", () => {
  it("shows the playlist bar AND still demands the file's own password (context never unlocks anything)", async () => {
    await mount(SLUG);
    expect(container.querySelector('[data-testid="playlist-nav-position"]')!.textContent!.trim()).toBe("2 of 3");
    expect(container.querySelector('input[type="password"]')).not.toBeNull();
    expect(container.textContent).not.toContain("Open in Telegram");
  });

  it("without ?list there is no playlist bar and no playlist request; a malformed ?list is ignored", async () => {
    await mount();
    expect(container.querySelector('[data-testid="playlist-nav"]')).toBeNull();
    await act(async () => root.unmount());
    root = createRoot(container);
    await mount("42");
    expect(container.querySelector('[data-testid="playlist-nav"]')).toBeNull();
    expect((fetch as unknown as { mock: { calls: string[][] } }).mock.calls.some((c) => String(c[0]).startsWith("/api/p/"))).toBe(false);
  });
});
