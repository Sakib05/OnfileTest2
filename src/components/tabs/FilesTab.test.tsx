// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/components/ui/Toast";

const router = { push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn(), refresh: vi.fn(), forward: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router }));

import FilesTab from "./FilesTab";
import { FROM_LIBRARY_KEY } from "@/lib/playlistNav";

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
  Object.values(router).forEach((m) => m.mockReset());
  sessionStorage.clear();
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
    expect(card.textContent).toContain("document"); // the type tag (now on the thumbnail)
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
    expect(labels).toEqual(["Open Link", "Share", "Analytics", "Delete"]); // no "Thumbnail" item any more
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

describe("My Library — search field layout", () => {
  it("is one flex row: [icon][input][close] — the icon is an in-flow sibling, never absolutely positioned over the input", async () => {
    await mount();
    await click(byLabel("Search library"));
    const field = container.querySelector('[data-testid="library-search-field"]') as HTMLElement;
    const kids = Array.from(field.children) as HTMLElement[];
    expect(field.className).toContain("flex");
    expect(field.className).toContain("items-center");
    expect(kids).toHaveLength(3);
    expect(kids[0].getAttribute("data-testid")).toBe("library-search-icon");
    expect(kids[1].tagName).toBe("INPUT");
    expect(kids[2].getAttribute("aria-label")).toBe("Close search");
    for (const el of kids) expect(el.className.toString()).not.toMatch(/\babsolute\b/);
    expect(kids[0].getAttribute("class")).toContain("flex-shrink-0");
    expect(kids[1].className).toContain("min-w-0"); // lets the input shrink instead of clipping/overlapping
    expect((kids[1] as HTMLInputElement).placeholder).toBe("Search files & playlists...");
    expect(kids[1].className).not.toMatch(/\bpl-\d/); // no padding hack needed to dodge an overlay
  });
});

describe("My Library — file type tag on the thumbnail", () => {
  it("is pinned to the thumbnail's top-right corner, inside the thumbnail frame, in List, Grid and Home rows", async () => {
    const check = () => {
      const card = container.querySelector('[data-testid="file-card"]') as HTMLElement;
      const badge = card.querySelector('[data-testid="file-type-badge"]') as HTMLElement;
      expect(badge).not.toBeNull();
      expect(badge.className).toContain("absolute");
      expect(badge.className).toContain("top-1.5");
      expect(badge.className).toContain("right-1.5");
      const frame = badge.parentElement as HTMLElement;
      expect(frame.className).toContain("relative");
      expect(frame.className).toContain("overflow-hidden");
      expect(frame.querySelector('[data-testid="file-type-art"], img')).not.toBeNull(); // same frame as the artwork
      // old placement removed: only ONE type tag per card, and none in the text block
      expect(card.querySelectorAll('[data-testid="file-type-badge"]')).toHaveLength(1);
      expect(card.querySelector("span.text-left")?.textContent ?? "").not.toMatch(/^(video|audio|document|image|archive)\b/i);
      expect(card.querySelector(".chip.capitalize")).toBeNull();
      return badge;
    };
    await mount([mkFile(1, "video", "Clip")], []);
    check(); // Home row
    await click(chip("Video"));
    expect(check().textContent).toBe("video"); // list
    await click(byLabel("Grid view"));
    check(); // grid
  });

  it("is readable on any artwork (translucent dark pill with white text), so it works in light and dark themes", async () => {
    await mount([mkFile(1, "image", "Photo", { thumbnailUrl: "https://cdn.example/p.jpg" })], []);
    const badge = container.querySelector('[data-testid="file-type-badge"]') as HTMLElement;
    expect(badge.className).toContain("bg-black/60");
    expect(badge.className).toContain("text-white");
    expect(badge.getAttribute("data-file-type")).toBe("image");
  });

  it("keeps the Stars price chip below the thumbnail (it is not a type tag)", async () => {
    await mount([mkFile(1, "video", "Paid", { starsPrice: 50 } as Partial<F>)], []);
    await click(chip("Video"));
    const card = container.querySelector('[data-testid="file-card"]')!;
    expect(card.textContent).toContain("⭐ 50");
    expect(card.querySelector('[data-testid="file-type-badge"]')?.textContent).not.toContain("50");
  });
});

describe("My Library — relative upload time", () => {
  const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

  it("shows how long ago each file was uploaded, from the file's createdAt, in every layout", async () => {
    await mount([
      mkFile(1, "video", "Fresh", { createdAt: new Date().toISOString() }),
      mkFile(2, "video", "Two hours", { createdAt: hoursAgo(2) }),
      mkFile(3, "video", "Yesterday", { createdAt: hoursAgo(30) }),
      mkFile(4, "video", "Days", { createdAt: hoursAgo(72) }),
      mkFile(5, "video", "Weeks", { createdAt: hoursAgo(24 * 15) }),
      mkFile(6, "video", "Month", { createdAt: hoursAgo(24 * 40) }),
    ], []);
    await click(chip("Video"));
    const text = (title: string) =>
      Array.from(container.querySelectorAll('[data-testid="file-card"]')).find((c) => c.textContent?.includes(title))!.querySelector('[data-testid="relative-time"]')?.textContent;
    expect(text("Fresh")).toBe("Just now");
    expect(text("Two hours")).toBe("2 hours ago");
    expect(text("Yesterday")).toBe("Yesterday");
    expect(text("Days")).toBe("3 days ago");
    expect(text("Weeks")).toBe("2 weeks ago");
    expect(text("Month")).toBe("1 month ago");
    await click(byLabel("Grid view"));
    expect(container.querySelectorAll('[data-testid="relative-time"]')).toHaveLength(6);
    // exposes the real instant for assistive tech / tooltips
    expect(container.querySelector("time")?.getAttribute("datetime")).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("handles missing or invalid timestamps safely (no crash, no invented time)", async () => {
    await mount([
      mkFile(1, "video", "No date", { createdAt: undefined as unknown as string }),
      mkFile(2, "video", "Bad date", { createdAt: "not-a-date" }),
      mkFile(3, "video", "Empty date", { createdAt: "" }),
      mkFile(4, "video", "Good", { createdAt: hoursAgo(5) }),
    ], []);
    await click(chip("Video"));
    expect(container.querySelectorAll('[data-testid="file-card"]')).toHaveLength(4);
    expect(container.querySelectorAll('[data-testid="relative-time"]')).toHaveLength(1);
    expect(container.textContent).toContain("5 hours ago");
    expect(container.textContent).not.toMatch(/NaN|Invalid/);
  });

  it("does not add per-card requests (reuses the one files + playlists snapshot) and shows no upload time on playlists", async () => {
    await mount();
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    expect(fetchMock).toHaveBeenCalledTimes(2); // /api/files + /api/playlists, regardless of card count
    await click(chip("Playlist"));
    expect(container.querySelectorAll('[data-testid="playlist-card"]')).toHaveLength(2);
    expect(container.querySelector('[data-testid="playlist-card"] [data-testid="relative-time"]')).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("My Library — file menu has no Thumbnail option", () => {
  it("omits Thumbnail but keeps every other file action, and no thumbnail modal is mounted", async () => {
    await mount();
    await click(chip("Document"));
    await click(byLabel("More actions for Report.pdf"));
    const labels = Array.from(document.querySelectorAll('[role="menuitem"]')).map((m) => m.textContent);
    expect(labels).not.toContain("Thumbnail");
    expect(labels).toEqual(["Open Link", "Share", "Analytics", "Delete"]);
    expect(document.body.textContent).not.toContain("Replace thumbnail");
  });

  it("still renders thumbnails and the FileTypeArt fallback", async () => {
    await mount([mkFile(1, "video", "With", { thumbnailUrl: "https://cdn.example/t.jpg" }), mkFile(2, "audio", "Without")], []);
    await click(chip("Video"));
    expect((container.querySelector("img") as HTMLImageElement).src).toBe("https://cdn.example/t.jpg");
    await click(chip("Audio"));
    expect(container.querySelectorAll('[data-testid="file-type-art"]')).toHaveLength(1);
    expect(container.querySelector("img")).toBeNull();
  });
});

describe("My Library — playlists open as a full page (no popup)", () => {
  it("clicking a playlist card navigates to /playlists/[id] and opens no modal", async () => {
    await mount();
    await click(chip("Playlist"));
    await click(byLabel("Open playlist Course"));
    expect(router.push).toHaveBeenCalledWith("/playlists/2");
    expect(document.querySelector(".fixed.inset-0.z-50")).toBeNull();
    expect(sessionStorage.getItem(FROM_LIBRARY_KEY)).toBe("1"); // lets Back return to the Library with real history
  });

  it("opens from a Home row too, and 'View posts' / 'Edit' in the menu go to the page", async () => {
    await mount();
    await click(byLabel("Open playlist Mix Playlist"));
    expect(router.push).toHaveBeenLastCalledWith("/playlists/1");

    await click(byLabel("More actions for playlist Mix Playlist"));
    await click(Array.from(document.querySelectorAll('[role="menuitem"]')).find((m) => m.textContent === "View posts") ?? null);
    expect(router.push).toHaveBeenLastCalledWith("/playlists/1");

    await click(byLabel("More actions for playlist Mix Playlist"));
    await click(Array.from(document.querySelectorAll('[role="menuitem"]')).find((m) => m.textContent === "Edit") ?? null);
    expect(router.push).toHaveBeenLastCalledWith("/playlists/1?edit=1");
  });
});
