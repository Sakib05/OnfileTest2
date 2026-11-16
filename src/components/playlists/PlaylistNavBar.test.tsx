// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicPlaylistPayload } from "@/lib/playlistSharing";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("next/link", () => ({
  default: ({ href, children, replace: _r, ...rest }: { href: string; children: React.ReactNode; replace?: boolean }) => <a href={href} {...rest}>{children}</a>,
}));

import PlaylistNavBar from "./PlaylistNavBar";

const SLUG = "AbCdEfGhIjKlMnOp";
const items = Array.from({ length: 12 }, (_, i) => ({
  position: i + 1, slug: `file-${i + 1}`, title: `Video ${i + 1}`, fileType: "video", mimeType: null, fileSize: null, thumbnailUrl: null, hasPassword: false, starsPrice: 0,
}));
const payload = (over: Partial<PublicPlaylistPayload["playlist"]> = {}): PublicPlaylistPayload => ({
  playlist: { title: "Course", description: null, thumbnailUrl: null, itemCount: 12, hasPassword: false, locked: null, ...over },
  creator: null,
  items,
});

let container: HTMLDivElement;
let root: Root;
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const q = (sel: string) => container.querySelector(sel) as HTMLElement | null;
async function mount(file: string, res: Response = new Response(JSON.stringify(payload()), { status: 200 })) {
  vi.stubGlobal("fetch", vi.fn(async () => res));
  await act(async () => root.render(<PlaylistNavBar listSlug={SLUG} fileSlug={file} />));
  await flush();
}

beforeEach(() => {
  localStorage.clear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("playlist navigation bar on the file page", () => {
  it("shows '3 of 12', links to the previous/next items in saved order, and back to the playlist", async () => {
    await mount("file-3");
    expect(q('[data-testid="playlist-nav-position"]')!.textContent!.trim()).toBe("3 of 12");
    expect(q('[data-testid="playlist-nav-prev"]')!.getAttribute("href")).toBe(`/f/file-2?list=${SLUG}&i=2`);
    expect(q('[data-testid="playlist-nav-next"]')!.getAttribute("href")).toBe(`/f/file-4?list=${SLUG}&i=4`);
    expect(q('[data-testid="playlist-nav-back"]')!.getAttribute("href")).toBe(`/p/${SLUG}`);
    expect(q('[data-testid="playlist-nav-back"]')!.textContent).toContain("Course");
  });

  it("disables Previous on the first and Next on the last item", async () => {
    await mount("file-1");
    expect(q('[data-testid="playlist-nav-prev"]')).toBeNull();
    expect(q('[data-testid="playlist-nav-prev-disabled"]')!.getAttribute("aria-disabled")).toBe("true");
    expect(q('[data-testid="playlist-nav-next"]')).not.toBeNull();
    await act(async () => root.unmount());
    root = createRoot(container);
    await mount("file-12");
    expect(q('[data-testid="playlist-nav-next"]')).toBeNull();
    expect(q('[data-testid="playlist-nav-next-disabled"]')).not.toBeNull();
  });

  it("remembers the opened position for 'Continue'", async () => {
    await mount("file-5");
    expect(localStorage.getItem(`onfile_pl_last_${SLUG}`)).toBe("5");
  });

  it("renders nothing when the file isn't in the playlist (a forged ?list= can't add navigation)", async () => {
    await mount("not-in-playlist");
    expect(q('[data-testid="playlist-nav"]')).toBeNull();
  });

  it("renders nothing when the playlist is private/missing, password-locked or Stars-locked", async () => {
    await mount("file-3", new Response("{}", { status: 404 }));
    expect(q('[data-testid="playlist-nav"]')).toBeNull();
    await act(async () => root.unmount());
    root = createRoot(container);
    await mount("file-3", new Response(JSON.stringify(payload({ locked: "password" })), { status: 200 }));
    expect(q('[data-testid="playlist-nav"]')).toBeNull();
    await act(async () => root.unmount());
    root = createRoot(container);
    await mount("file-3", new Response(JSON.stringify(payload({ locked: "stars" })), { status: 200 }));
    expect(q('[data-testid="playlist-nav"]')).toBeNull();
  });

  it("is labelled for screen readers and announces position changes politely", async () => {
    await mount("file-2");
    expect(q("nav")!.getAttribute("aria-label")).toBe("Playlist navigation");
    expect(q('[data-testid="playlist-nav-position"]')!.getAttribute("aria-live")).toBe("polite");
    expect(q('[data-testid="playlist-nav-next"]')!.getAttribute("aria-label")).toBe("Next: Video 3");
  });
});
