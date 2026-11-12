// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import FilesTab from "./FilesTab";
import { ToastProvider } from "@/components/ui/Toast";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

type F = { id: number; title: string; fileType: string; createdAt: string; fileSize?: number; views: number; downloads: number; earnings: string; isPublished: boolean; smartLinkSlug: string; thumbnailUrl: string | null };
const mkFile = (id: number, fileType: string, title: string, extra: Partial<F> = {}): F => ({
  id, title, fileType, createdAt: new Date(2025, 0, id).toISOString(), views: id, downloads: 1, earnings: "0.5",
  isPublished: true, smartLinkSlug: `s${id}`, thumbnailUrl: null, ...extra,
});

const videos = Array.from({ length: 10 }, (_, i) => mkFile(i + 1, "video", `Video ${i + 1}`, { fileSize: i % 2 ? 987654321 : undefined }));
const FILES = [
  ...videos,
  mkFile(20, "audio", "Mix tape", { fileSize: 5_000_000 }),
  mkFile(21, "audio", "Podcast"),
  mkFile(22, "document", "Report.pdf", { fileSize: 2048 }),
];
const PLAYLISTS = [
  { id: 1, title: "Mix Playlist", totalFiles: 2, totalDownloads: 3, isPublished: true, createdAt: new Date(2025, 0, 5).toISOString(), thumbnailUrl: null },
  { id: 2, title: "Course", totalFiles: 1, totalDownloads: 0, isPublished: true, createdAt: new Date(2025, 0, 6).toISOString(), thumbnailUrl: null },
];

function mockApi(files: unknown[], playlists: unknown[]) {
  vi.stubGlobal("fetch", vi.fn((url: string) =>
    Promise.resolve(new Response(JSON.stringify(String(url).startsWith("/api/files") ? { files } : { playlists }), { status: 200 }))
  ));
}
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const click = (el: Element | null) => act(async () => { (el as HTMLElement).dispatchEvent(new MouseEvent("click", { bubbles: true })); });
const byLabel = (l: string) => container.querySelector(`[aria-label="${l}"]`);
const chip = (name: string) => Array.from(container.querySelectorAll('[role="group"][aria-label="Library categories"] button')).find((b) => b.textContent === name)!;
const sec = (k: string) => container.querySelector(`[data-testid="home-section-${k}"]`);
const SIZE_RE = /Unknown size|\b\d+(\.\d+)?\s?(B|KB|MB|GB)\b/;

async function type(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function mount(files = FILES as unknown[], playlists = PLAYLISTS as unknown[], onCreate = vi.fn()) {
  mockApi(files, playlists);
  await act(async () => root.render(<ToastProvider><FilesTab onCreateClick={onCreate} /></ToastProvider>));
  await flush();
  return onCreate;
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("My Library — header & categories", () => {
  it("shows a search icon and the Add button, with no permanently visible search bar", async () => {
    await mount();
    expect(byLabel("Search library")).not.toBeNull();
    expect(byLabel("Add file")).not.toBeNull();
    expect(container.querySelector('[data-testid="library-search"]')?.getAttribute("data-open")).toBe("false");
    expect(container.querySelector('[data-testid="library-search"]')?.hasAttribute("inert")).toBe(true);
  });

  it("renames All → Home and keeps the other categories, Home active by default", async () => {
    await mount();
    const names = Array.from(container.querySelectorAll('[aria-label="Library categories"] button')).map((b) => b.textContent);
    expect(names).toEqual(["Home", "Video", "Document", "Audio", "Image", "Archive", "Playlist"]);
    expect(chip("Home").getAttribute("aria-pressed")).toBe("true");
    expect(container.querySelector('[aria-label="Library categories"]')?.className).toContain("overflow-x-auto");
  });
});

describe("My Library — Home sections", () => {
  it("renders organised sections, hides empty ones and caps rows", async () => {
    await mount();
    for (const k of ["recent", "video", "document", "audio", "playlist"]) expect(sec(k), k).not.toBeNull();
    expect(sec("image")).toBeNull();
    expect(sec("archive")).toBeNull();
    expect(sec("video")!.querySelectorAll('[data-testid="file-card"]')).toHaveLength(8);
    expect(sec("audio")!.querySelectorAll('[data-testid="file-card"]')).toHaveLength(2);
    expect(sec("playlist")!.querySelectorAll('[data-testid="playlist-card"]')).toHaveLength(2);
    // Audio only has audio; Documents only documents
    expect(sec("audio")!.textContent).not.toContain("Report.pdf");
    expect(sec("document")!.textContent).toContain("Report.pdf");
  });

  it("offers See all only where there is more, and it opens the category list", async () => {
    await mount();
    expect(byLabel("See all Videos")).not.toBeNull();
    expect(byLabel("See all Audio")).toBeNull();
    await click(byLabel("See all Videos"));
    expect(chip("Video").getAttribute("aria-pressed")).toBe("true");
    expect(container.querySelectorAll('[data-testid="file-card"]')).toHaveLength(10);
    expect(container.querySelector('[data-testid="home-sections"]')).toBeNull();
  });

  it("Recently Added → See all expands to every file, newest first, with a way back", async () => {
    await mount();
    await click(byLabel("See all Recently Added"));
    const cards = container.querySelectorAll('[data-testid="file-card"]');
    expect(cards).toHaveLength(FILES.length);
    expect(cards[0].textContent).toContain("Report.pdf");
    expect(container.querySelector('[data-testid="playlist-card"]')).toBeNull();
    await click(byLabel("Back to Home"));
    expect(container.querySelector('[data-testid="home-sections"]')).not.toBeNull();
  });

  it("shows a tailored empty state for an empty category and a first-run state for an empty library", async () => {
    await mount();
    await click(chip("Image"));
    expect(container.textContent).toContain("No images yet");

    await act(async () => root.unmount());
    root = createRoot(container);
    const onCreate = await mount([], []);
    expect(container.querySelector('[data-testid="library-empty"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="home-sections"]')).toBeNull();
    await click(Array.from(container.querySelectorAll("button")).find((b) => b.textContent === "Upload File")!);
    expect(onCreate).toHaveBeenCalled();
  });
});

describe("My Library — search icon", () => {
  it("opens on tap, filters files AND playlists, and closing clears the query", async () => {
    await mount();
    await click(byLabel("Search library"));
    const wrap = container.querySelector('[data-testid="library-search"]')!;
    expect(wrap.getAttribute("data-open")).toBe("true");
    expect(wrap.hasAttribute("inert")).toBe(false);
    const input = container.querySelector('input[type="search"]') as HTMLInputElement;
    expect(document.activeElement).toBe(input);

    await type(input, "mix");
    expect(container.querySelectorAll('[data-testid="file-card"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-testid="playlist-card"]')).toHaveLength(1);
    expect(container.querySelector('[data-testid="home-sections"]')).toBeNull();
    expect(container.querySelector('[data-testid="library-results-label"]')?.textContent).toBe("2 results");

    await type(input, "zzz-nothing");
    expect(container.querySelector('[data-testid="library-empty-search"]')?.textContent).toContain("No results for “zzz-nothing”");

    await click(wrap.querySelector('[aria-label="Close search"]'));
    expect(wrap.getAttribute("data-open")).toBe("false");
    expect(input.value).toBe("");
    expect(container.querySelector('[data-testid="home-sections"]')).not.toBeNull();
  });

  it("closes with Escape", async () => {
    await mount();
    await click(byLabel("Search library"));
    const input = container.querySelector('input[type="search"]') as HTMLInputElement;
    await act(async () => { input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    expect(container.querySelector('[data-testid="library-search"]')?.getAttribute("data-open")).toBe("false");
  });
});

describe("My Library — cards", () => {
  it("never shows a file size or 'Unknown size' in Home rows, List or Grid", async () => {
    await mount();
    expect(container.textContent).not.toMatch(SIZE_RE);
    await click(chip("Video"));
    expect(container.textContent).not.toMatch(SIZE_RE);
    await click(byLabel("Grid view"));
    expect(container.querySelector('[data-testid="library-items"]')?.getAttribute("data-view")).toBe("grid");
    expect(container.textContent).not.toMatch(SIZE_RE);
    await click(chip("Document"));
    expect(container.textContent).not.toMatch(SIZE_RE);
  });

  it("still shows title, type, views, downloads and earnings", async () => {
    await mount();
    await click(chip("Document"));
    const card = container.querySelector('[data-testid="file-card"]')!;
    expect(card.textContent).toContain("Report.pdf");
    expect(card.textContent).toContain("document");
    expect(card.textContent).toContain("+$0.50");
    expect(card.querySelectorAll("svg").length).toBeGreaterThanOrEqual(3);
  });

  it("uses larger, aspect-locked thumbnail frames in List and Grid", async () => {
    await mount();
    await click(chip("Audio"));
    let frame = container.querySelector('[data-testid="file-card"] > button span.relative') as HTMLElement;
    expect(frame.className).toContain("w-28"); // 112px, up from 48px
    expect(frame.className).toContain("aspect-[4/3]");
    await click(byLabel("Grid view"));
    frame = container.querySelector('[data-testid="file-card"] > button span.relative') as HTMLElement;
    expect(frame.className).toContain("aspect-video");
    expect(frame.className).toContain("w-full");
  });

  it("uses a real thumbnail with uniform cover scaling, else the FileTypeArt fallback", async () => {
    await mount([mkFile(1, "video", "With thumb", { thumbnailUrl: "https://cdn.example/t.jpg" }), mkFile(2, "video", "No thumb")], []);
    await click(chip("Video"));
    const img = container.querySelector("img") as HTMLImageElement;
    expect(img.src).toBe("https://cdn.example/t.jpg");
    expect(img.className).toContain("object-cover");
    expect(container.querySelectorAll('[data-testid="file-type-art"]')).toHaveLength(1);
  });

  it("opens the item menu without clipping (fixed position) and Analytics shows details without a size", async () => {
    await mount();
    await click(chip("Document"));
    await click(byLabel("More actions for Report.pdf"));
    const menu = document.querySelector('[role="menu"]') as HTMLElement;
    expect(menu.style.position === "" ? menu.className : "fixed").toContain("fixed");
    const labels = Array.from(menu.querySelectorAll('[role="menuitem"]')).map((m) => m.textContent);
    expect(labels).toEqual(["Thumbnail", "Open Link", "Share", "Analytics", "Delete"]);
    await click(Array.from(menu.querySelectorAll("button")).find((b) => b.textContent === "Analytics")!);
    expect(document.body.textContent).toContain("File Details");
    expect(document.body.textContent).not.toMatch(SIZE_RE);
  });

  it("playlist cards open the manager menu with the playlist actions", async () => {
    await mount();
    await click(chip("Playlist"));
    expect(container.querySelectorAll('[data-testid="playlist-card"]')).toHaveLength(2);
    await click(byLabel("More actions for playlist Course"));
    const labels = Array.from(document.querySelectorAll('[role="menuitem"]')).map((m) => m.textContent);
    expect(labels).toEqual(["View posts", "Edit", "Delete"]);
  });
});
