// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/components/ui/Toast";
import { installTelegramBackButton } from "@/test/telegramBackMock";

// Capture DndContext props so the drag-end handler (what a real drag triggers) can be invoked in jsdom,
// which has no layout engine for dnd-kit's collision detection.
let dnd: { onDragStart?: () => void; onDragEnd?: (e: unknown) => void; sensors?: unknown[] } = {};
vi.mock("@dnd-kit/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@dnd-kit/core")>();
  return {
    ...actual,
    DndContext: (props: React.ComponentProps<typeof actual.DndContext>) => {
      dnd = props as typeof dnd;
      return <actual.DndContext {...props} />;
    },
  };
});

const router = { push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn(), refresh: vi.fn(), forward: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const setActiveTab = vi.fn();
vi.mock("@/contexts/AppContext", () => ({
  useApp: () => ({ authStatus: "authenticated", channelStatus: "has_channel", setActiveTab }),
}));

import PlaylistPage from "./PlaylistPage";
import { FROM_LIBRARY_KEY } from "@/lib/playlistNav";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type F = { id: number; title: string; fileType: string; mimeType: null; fileSize: number; isPublished: boolean; thumbnailUrl: string | null; position: number };
type F2 = F & { smartLinkSlug: string | null };
const mk = (id: number, title: string, thumb: string | null = null): F2 => ({ id, title, fileType: "document", mimeType: null, fileSize: 1000, isPublished: true, smartLinkSlug: `slug-${id}`, thumbnailUrl: thumb, position: id });

const basePlaylist = { id: 1, title: "Accounting", description: "Intro course", totalFiles: 3, thumbnailUrl: "https://cdn/a.webp" };
const other = { id: 2, title: "BBA Materials", description: null, totalFiles: 1, thumbnailUrl: null };

let container: HTMLDivElement;
let root: Root;
let members: F2[];
let playlistMeta: typeof basePlaylist;
let calls: { url: string; method: string; body: unknown }[];
let failNext: { match: RegExp; status: number; body?: unknown } | null;
let shareResult: { status: number; body: unknown } | null;
const SHARE_SLUG = "AbCdEfGhIjKlMnOp";

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
const summary = () => ({ ...playlistMeta, totalFiles: members.length, thumbnailUrl: members[0]?.thumbnailUrl ?? null });

function installFetch() {
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(init.body as string) : undefined;
    calls.push({ url, method, body });
    if (failNext && failNext.match.test(`${method} ${url}`)) {
      const f = failNext;
      failNext = null;
      return json(f.body ?? { error: "boom" }, f.status);
    }
    const snapshot = () => ({ files: members, playlist: summary() });
    if (method === "GET" && url === "/api/playlists") return json({ playlists: [summary(), other] });
    if (method === "GET" && url === "/api/playlists/1/files") return json({ files: members });
    if (method === "GET" && url === "/api/playlists/404/files") return json({ error: "Not found" }, 404);
    if (method === "PUT" && url === "/api/playlists/1/files") {
      members = (body.fileIds as number[]).map((id) => members.find((m) => m.id === id)!);
      return json(snapshot());
    }
    if (method === "DELETE" && /^\/api\/playlists\/1\/files\/\d+$/.test(url)) {
      const id = Number(url.split("/").pop());
      members = members.filter((m) => m.id !== id);
      return json({ success: true, ...snapshot() });
    }
    if (method === "PATCH" && url === "/api/playlists/1") {
      playlistMeta = { ...playlistMeta, title: body.title, description: body.description };
      return json({ playlist: summary() });
    }
    if (method === "GET" && url === "/api/files") return json({ files: [mk(1, "One.pdf"), mk(2, "Two.pdf"), mk(3, "Three.pdf"), mk(4, "Four.pdf"), mk(5, "Five.docx")] });
    if (method === "POST" && url === "/api/playlists/1/files") {
      const ids = (body.fileIds as number[]).filter((i) => !members.some((m) => m.id === i));
      members = [...members, ...ids.map((i) => mk(i, `New ${i}`))];
      return json({ added: ids, alreadyMembers: [], ...snapshot() });
    }
    if (method === "POST" && /\/transfer$/.test(url)) {
      if (body.mode === "move") members = members.filter((m) => m.id !== Number(url.split("/")[5]));
      return json({ success: true, mode: body.mode, alreadyInDestination: false });
    }
    if (method === "DELETE" && url === "/api/playlists/1") return json({ success: true });
    if (method === "POST" && url === "/api/playlists/1/share") {
      if (shareResult) return json(shareResult.body, shareResult.status);
      return json({ share: { slug: SHARE_SLUG, path: `/p/${SHARE_SLUG}`, url: `https://onfile.test/p/${SHARE_SLUG}`, hasPassword: false } });
    }
    return json({ error: "unexpected" }, 500);
  }));
}

const buttons = () => Array.from(document.body.querySelectorAll("button"));
const byText = (t: string) => buttons().find((b) => b.textContent?.trim().includes(t)) as HTMLButtonElement | undefined;
const menuButton = () => document.body.querySelector('[data-testid="action-menu-button"]') as HTMLButtonElement;
const menuEl = () => document.body.querySelector('[data-testid="action-menu"]') as HTMLElement | null;
const choose = async (key: string) => {
  await act(async () => menuButton().click());
  await act(async () => (document.body.querySelector(`[data-testid="menu-item-${key}"]`) as HTMLButtonElement).click());
};
const rows = () => Array.from(document.body.querySelectorAll('[data-testid="playlist-file-row"]')) as HTMLElement[];
const rowTitles = () => rows().map((r) => r.querySelector('[data-testid="file-title"]')?.textContent);
const rowFor = (title: string) => rows().find((r) => r.textContent?.includes(title))!;
const layerOf = (row: HTMLElement) => row.querySelector('[data-testid="swipe-layer"]') as HTMLElement;
const swipeRowOf = (row: HTMLElement) => row.querySelector('[data-testid="swipe-row"]') as HTMLElement;
const isOpen = (row: HTMLElement) => swipeRowOf(row).getAttribute("data-open") === "true";
const coverImg = () => document.body.querySelector('[data-testid="playlist-cover"] img') as HTMLImageElement | null;
const anyModal = () => document.body.querySelector(".fixed.inset-0.z-50");

function typeInto(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

/** Fires a pointer event React understands (jsdom has no layout, so coordinates are all we need). */
function pointer(el: Element, type: "pointerdown" | "pointermove" | "pointerup" | "pointercancel", x: number, y: number, t: number, id = 1) {
  const ev = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 });
  Object.defineProperties(ev, { pointerId: { value: id }, pointerType: { value: "touch" }, timeStamp: { value: t } });
  return act(async () => { el.dispatchEvent(ev); });
}
/** A complete, slow (non-flick) horizontal drag from (x0,y) by dx. */
async function drag(el: Element, dx: number, opts: { y?: number; dy?: number; end?: "up" | "cancel" } = {}) {
  const x0 = 220, y0 = opts.y ?? 20;
  await pointer(el, "pointerdown", x0, y0, 0);
  await pointer(el, "pointermove", x0 + dx * 0.4, y0 + (opts.dy ?? 0) * 0.4, 100);
  await pointer(el, "pointermove", x0 + dx, y0 + (opts.dy ?? 0), 200);
  await pointer(el, opts.end === "cancel" ? "pointercancel" : "pointerup", x0 + dx, y0 + (opts.dy ?? 0), 1500); // long pause → not a flick
}
const swipeLeft = (title: string, dx = -90) => drag(layerOf(rowFor(title)), dx);

async function mount(opts: { initialView?: "list" | "edit"; id?: number } = {}) {
  await act(async () =>
    root.render(
      <ToastProvider>
        <PlaylistPage playlistId={opts.id ?? 1} initialView={opts.initialView ?? "list"} />
      </ToastProvider>
    )
  );
  await flush();
}

beforeEach(() => {
  members = [mk(1, "One.pdf", "https://cdn/a.webp"), mk(2, "Two.pdf"), mk(3, "Three.pdf")];
  playlistMeta = { ...basePlaylist };
  calls = [];
  failNext = null;
  shareResult = null;
  Object.values(router).forEach((m) => m.mockReset());
  setActiveTab.mockReset();
  sessionStorage.clear();
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
});

describe("Playlist page — layout (full page, not a popup)", () => {
  it("renders the cover, title, description, file count and actions on a full page with no modal", async () => {
    await mount();
    expect(document.querySelector('[data-testid="playlist-page"]')).not.toBeNull();
    expect(anyModal()).toBeNull(); // not a popup
    expect(document.querySelector('[data-testid="playlist-title"]')?.textContent).toBe("Accounting");
    expect(document.querySelector('[data-testid="playlist-description"]')?.textContent).toBe("Intro course");
    expect(document.querySelector('[data-testid="playlist-count"]')?.textContent?.trim()).toBe("3 files");
    expect(coverImg()?.src).toBe("https://cdn/a.webp");
    expect(byText("Add files from Library")).toBeTruthy();
  });

  it("lists files in order with a drag handle each and marks the first as the cover — rows have no menu of their own", async () => {
    await mount();
    expect(rowTitles()).toEqual(["One.pdf", "Two.pdf", "Three.pdf"]);
    expect(document.body.querySelectorAll('[data-testid="drag-handle"]')).toHaveLength(3);
    expect(rowFor("One.pdf").textContent).toContain("Cover");
    expect(document.body.querySelector('[aria-label^="Actions for"]')).toBeNull();
    expect(rows().some((r) => r.querySelector('[aria-haspopup="menu"]'))).toBe(false); // the ⋮ menu belongs to the playlist header
  });

  it("shows an empty-playlist message and the default cover", async () => {
    members = [];
    await mount();
    expect(document.body.textContent).toContain("This playlist is empty");
    expect(document.querySelector('[data-testid="playlist-count"]')?.textContent?.trim()).toBe("0 files");
    expect(document.querySelector('[data-testid="playlist-default-art"]')).not.toBeNull();
  });

  it("shows a friendly state when the playlist doesn't exist", async () => {
    await mount({ id: 404 });
    expect(document.querySelector('[data-testid="playlist-error"]')?.textContent).toContain("Playlist not found");
  });

  it("opens straight into the edit form when asked (?edit=1)", async () => {
    await mount({ initialView: "edit" });
    expect(document.getElementById("pl-edit-title")).not.toBeNull();
    expect(document.querySelector('[data-testid="playlist-header-title"]')?.textContent).toBe("Edit playlist");
  });
});

describe("Playlist page — navigation", () => {
  const pressNativeBack = async (tg: ReturnType<typeof installTelegramBackButton>) => act(async () => tg.press());

  it("has NO in-page back arrow (Telegram's native Back Button is the only back control)", async () => {
    await mount();
    expect(document.querySelector('[data-testid="playlist-back"]')).toBeNull();
    expect(document.querySelector("svg.lucide-chevron-left")).toBeNull();
  });

  it("Back returns to the Library with real history when it came from the Library", async () => {
    const tg = installTelegramBackButton();
    sessionStorage.setItem(FROM_LIBRARY_KEY, "1");
    await mount();
    expect(tg.btn.isVisible).toBe(true);
    await pressNativeBack(tg);
    expect(setActiveTab).toHaveBeenCalledWith("files");
    expect(router.back).toHaveBeenCalledTimes(1);
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("Back from a deep link (no history from the Library) replaces the route with the Library", async () => {
    const tg = installTelegramBackButton();
    await mount();
    await pressNativeBack(tg);
    expect(router.replace).toHaveBeenCalledWith("/");
    expect(router.back).not.toHaveBeenCalled();
    expect(setActiveTab).toHaveBeenCalledWith("files");
  });

  it("Back inside a sub-screen (add files) returns to the playlist first, not the Library", async () => {
    const tg = installTelegramBackButton();
    await mount();
    await act(async () => byText("Add files from Library")!.click());
    expect(document.querySelector('[data-testid="playlist-header-title"]')?.textContent).toBe("Add files");
    await pressNativeBack(tg);
    expect(document.querySelector('[data-testid="playlist-title"]')).not.toBeNull();
    expect(router.back).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("drives Telegram's native BackButton (Android back gesture) and hides it when leaving", async () => {
    let handler: (() => void) | undefined;
    const BackButton = { show: vi.fn(), hide: vi.fn(), onClick: vi.fn((cb: () => void) => { handler = cb; }), offClick: vi.fn() };
    (window as unknown as { Telegram: unknown }).Telegram = { WebApp: { BackButton } };
    sessionStorage.setItem(FROM_LIBRARY_KEY, "1");
    await mount();
    expect(BackButton.show).toHaveBeenCalled();
    await act(async () => handler!());
    expect(router.back).toHaveBeenCalledTimes(1);
    await act(async () => root.unmount());
    expect(BackButton.offClick).toHaveBeenCalled();
    expect(BackButton.hide).toHaveBeenCalled();
    root = createRoot(container);
  });
});

describe("Playlist page — reorder (unchanged behaviour)", () => {
  it("uses mouse + touch + keyboard sensors and keeps the drag on the handle only", async () => {
    await mount();
    expect(dnd.sensors).toHaveLength(3);
    const handle = document.body.querySelector('[data-testid="drag-handle"]') as HTMLElement;
    expect(handle.style.touchAction).toBe("none");
    expect(handle.hasAttribute("data-no-swipe")).toBe(true); // the swipe gesture never starts here
    expect(handle.textContent).toBe("");
    expect(handle.getAttribute("aria-label")).toMatch(/Reorder One\.pdf/);
  });

  it("drag-end shows the new order immediately, PUTs the full id list and refreshes the cover", async () => {
    await mount();
    await act(async () => dnd.onDragEnd!({ active: { id: 3 }, over: { id: 1 } }));
    expect(rowTitles()).toEqual(["Three.pdf", "One.pdf", "Two.pdf"]);
    await flush();
    const put = calls.find((c) => c.method === "PUT")!;
    expect(put.url).toBe("/api/playlists/1/files");
    expect(put.body).toEqual({ fileIds: [3, 1, 2] });
    expect(coverImg()).toBeNull(); // new first file (Three.pdf) has no thumbnail → default art
    expect(document.querySelector('[data-testid="playlist-default-art"]')).not.toBeNull();
  });

  it("rolls the order back and shows an error when saving fails", async () => {
    await mount();
    failNext = { match: /^PUT /, status: 500, body: { error: "Couldn't save the new order. Please try again." } };
    await act(async () => dnd.onDragEnd!({ active: { id: 2 }, over: { id: 3 } }));
    await flush();
    expect(rowTitles()).toEqual(["One.pdf", "Two.pdf", "Three.pdf"]);
    expect(document.body.textContent).toContain("Couldn't save the new order");
  });

  it("on a 409 (changed elsewhere) it reloads the real order", async () => {
    await mount();
    failNext = { match: /^PUT /, status: 409, body: { error: "This playlist changed. Please reload it and try again." } };
    members = [mk(9, "Server copy")];
    await act(async () => dnd.onDragEnd!({ active: { id: 2 }, over: { id: 3 } }));
    await flush();
    expect(rowTitles()).toEqual(["Server copy"]);
  });

  it("dropping a row on itself does nothing (no request)", async () => {
    await mount();
    await act(async () => dnd.onDragEnd!({ active: { id: 2 }, over: { id: 2 } }));
    expect(calls.some((c) => c.method === "PUT")).toBe(false);
  });
});

describe("Playlist page — swipe to remove", () => {
  it("a right-to-left swipe slides the row left and reveals the Remove action on the right", async () => {
    await mount();
    expect(isOpen(rowFor("Two.pdf"))).toBe(false);
    await swipeLeft("Two.pdf");
    const row = rowFor("Two.pdf");
    expect(isOpen(row)).toBe(true);
    expect(layerOf(row).style.transform).toContain("translate3d(-92px");
    const remove = row.querySelector('[data-testid="swipe-remove"]') as HTMLButtonElement;
    expect(remove.textContent).toContain("Remove");
    expect(remove.getAttribute("aria-label")).toBe("Remove Two.pdf from playlist");
    expect(remove.parentElement?.className).toContain("right-0");
    expect(remove.parentElement?.className).toContain("bg-red-600");
    // nothing was removed just by swiping
    expect(calls.filter((c) => c.method === "DELETE")).toHaveLength(0);
  });

  it("a left-to-right swipe closes an open row", async () => {
    await mount();
    await swipeLeft("Two.pdf");
    expect(isOpen(rowFor("Two.pdf"))).toBe(true);
    await drag(layerOf(rowFor("Two.pdf")), 80);
    expect(isOpen(rowFor("Two.pdf"))).toBe(false);
    expect(layerOf(rowFor("Two.pdf")).style.transform).toContain("translate3d(0px");
  });

  it("a short swipe springs back (below the threshold); a cancelled gesture restores the rest state", async () => {
    await mount();
    await swipeLeft("Two.pdf", -20);
    expect(isOpen(rowFor("Two.pdf"))).toBe(false);
    expect(layerOf(rowFor("Two.pdf")).style.transform).toContain("translate3d(0px");

    await drag(layerOf(rowFor("Two.pdf")), -90, { end: "cancel" });
    expect(isOpen(rowFor("Two.pdf"))).toBe(false);
    expect(layerOf(rowFor("Two.pdf")).style.transform).toContain("translate3d(0px");
  });

  it("a fast flick opens even over a short distance", async () => {
    await mount();
    const layer = layerOf(rowFor("Two.pdf"));
    await pointer(layer, "pointerdown", 220, 20, 0);
    await pointer(layer, "pointermove", 205, 21, 10);
    await pointer(layer, "pointermove", 190, 21, 20);
    await pointer(layer, "pointerup", 190, 21, 30);
    expect(isOpen(rowFor("Two.pdf"))).toBe(true);
  });

  it("vertical scrolling never moves the row, reveals Remove or removes anything", async () => {
    await mount();
    await drag(layerOf(rowFor("Two.pdf")), 6, { dy: 90 }); // mostly vertical, drifting sideways
    await drag(layerOf(rowFor("Two.pdf")), -12, { dy: -70 });
    expect(isOpen(rowFor("Two.pdf"))).toBe(false);
    expect(layerOf(rowFor("Two.pdf")).style.transform).toContain("translate3d(0px");
    expect(calls.filter((c) => c.method === "DELETE")).toHaveLength(0);
    expect(rowTitles()).toEqual(["One.pdf", "Two.pdf", "Three.pdf"]);
  });

  it("the sliding layer keeps vertical scrolling native (touch-action: pan-y)", async () => {
    await mount();
    expect(layerOf(rowFor("One.pdf")).style.touchAction).toBe("pan-y");
  });

  it("only one row is open at a time", async () => {
    await mount();
    await swipeLeft("One.pdf");
    expect(isOpen(rowFor("One.pdf"))).toBe(true);
    await swipeLeft("Three.pdf");
    expect(isOpen(rowFor("Three.pdf"))).toBe(true);
    expect(isOpen(rowFor("One.pdf"))).toBe(false);
  });

  it("starting a swipe on another row closes the open one straight away", async () => {
    await mount();
    await swipeLeft("One.pdf");
    const other = layerOf(rowFor("Two.pdf"));
    await pointer(other, "pointerdown", 220, 20, 0);
    await pointer(other, "pointermove", 200, 20, 100);
    expect(isOpen(rowFor("One.pdf"))).toBe(false);
    await pointer(other, "pointerup", 200, 20, 1500);
  });

  it("pressing outside an open row closes it", async () => {
    await mount();
    await swipeLeft("Two.pdf");
    await act(async () => {
      document.querySelector('[data-testid="playlist-title"]')!.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    });
    expect(isOpen(rowFor("Two.pdf"))).toBe(false);
  });

  it("a swipe that starts on the drag handle never opens the row (reorder stays separate)", async () => {
    await mount();
    const handle = rowFor("Two.pdf").querySelector('[data-testid="drag-handle"]')!;
    await drag(handle, -90);
    expect(isOpen(rowFor("Two.pdf"))).toBe(false);
  });

  it("the click that ends a swipe is not treated as a tap; tapping an open row only closes it", async () => {
    await mount();
    await swipeLeft("Two.pdf");
    const info = rowFor("Two.pdf").querySelector('button[aria-label^="Add or move"]') as HTMLButtonElement;
    await act(async () => info.click()); // synthetic click right after the swipe → swallowed
    expect(document.querySelector('[data-testid="playlist-title"]')).not.toBeNull(); // still on the list
    await new Promise((r) => setTimeout(r, 80));
    await act(async () => info.click()); // row is open → tap closes it instead of opening the transfer view
    expect(isOpen(rowFor("Two.pdf"))).toBe(false);
    expect(document.querySelector('[data-testid="playlist-title"]')).not.toBeNull();
  });

  it("removes ONLY the membership of that file (DELETE membership endpoint, never /api/files) and updates count + rows immediately", async () => {
    await mount();
    await swipeLeft("Two.pdf");
    await act(async () => (rowFor("Two.pdf").querySelector('[data-testid="swipe-remove"]') as HTMLButtonElement).click());
    // optimistic: gone before the server answers
    expect(rowTitles()).toEqual(["One.pdf", "Three.pdf"]);
    await flush();
    expect(calls.filter((c) => c.method === "DELETE").map((c) => c.url)).toEqual(["/api/playlists/1/files/2"]);
    expect(calls.some((c) => /^\/api\/files\//.test(c.url))).toBe(false); // the original file is never touched
    expect(document.querySelector('[data-testid="playlist-count"]')?.textContent?.trim()).toBe("2 files");
    expect(document.body.textContent).toContain("still in your Library");
  });

  it("removing the FIRST file updates the playlist cover to the new first file", async () => {
    members = [mk(1, "One.pdf", "https://cdn/a.webp"), mk(2, "Two.pdf", "https://cdn/b.webp"), mk(3, "Three.pdf")];
    await mount();
    expect(coverImg()?.src).toBe("https://cdn/a.webp");
    await swipeLeft("One.pdf");
    await act(async () => (rowFor("One.pdf").querySelector('[data-testid="swipe-remove"]') as HTMLButtonElement).click());
    expect(coverImg()?.src).toBe("https://cdn/b.webp"); // optimistic
    await flush();
    expect(coverImg()?.src).toBe("https://cdn/b.webp"); // confirmed by the server snapshot
    expect(rowFor("Two.pdf").textContent).toContain("Cover");
  });

  it("restores the row, the count and the cover when the request fails", async () => {
    await mount();
    // Hold the server's answer so the optimistic state can be observed before the failure arrives.
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const original = globalThis.fetch;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "DELETE") {
        await gate;
        return json({ error: "boom" }, 500);
      }
      return original(url, init);
    }));
    await swipeLeft("One.pdf");
    await act(async () => (rowFor("One.pdf").querySelector('[data-testid="swipe-remove"]') as HTMLButtonElement).click());
    expect(rowTitles()).toEqual(["Two.pdf", "Three.pdf"]); // removed immediately
    expect(document.querySelector('[data-testid="playlist-count"]')?.textContent?.trim()).toBe("2 files");
    await act(async () => release());
    await flush();
    expect(rowTitles()).toEqual(["One.pdf", "Two.pdf", "Three.pdf"]); // back where it was
    expect(document.querySelector('[data-testid="playlist-count"]')?.textContent?.trim()).toBe("3 files");
    expect(coverImg()?.src).toBe("https://cdn/a.webp");
    expect(document.body.textContent).toContain("Couldn't remove it from the playlist");
  });

  it("a network error also restores the row", async () => {
    await mount();
    const original = globalThis.fetch;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "DELETE") throw new TypeError("offline");
      return original(url, init);
    }));
    await swipeLeft("Three.pdf");
    await act(async () => (rowFor("Three.pdf").querySelector('[data-testid="swipe-remove"]') as HTMLButtonElement).click());
    await flush();
    expect(rowTitles()).toEqual(["One.pdf", "Two.pdf", "Three.pdf"]);
  });

  it("is accessible without swiping: the Remove button is a labelled, focusable control that reveals itself on focus", async () => {
    await mount();
    const row = rowFor("Two.pdf");
    const remove = row.querySelector('[data-testid="swipe-remove"]') as HTMLButtonElement;
    expect(remove.tabIndex).toBe(0);
    expect(remove.getAttribute("aria-label")).toBe("Remove Two.pdf from playlist");
    await act(async () => remove.focus());
    expect(isOpen(row)).toBe(true);
    // keyboard: ArrowRight/Escape closes, ArrowLeft opens
    await act(async () => { layerOf(row).dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    expect(isOpen(row)).toBe(false);
    await act(async () => { layerOf(row).dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true })); });
    expect(isOpen(row)).toBe(true);
  });
});

describe("Playlist page — edit, add, transfer, delete (unchanged behaviour)", () => {
  it("edits the name and description and shows the update immediately", async () => {
    await mount();
    await choose("edit");
    const title = document.getElementById("pl-edit-title") as HTMLInputElement;
    const desc = document.getElementById("pl-edit-desc") as HTMLTextAreaElement;
    expect(title.value).toBe("Accounting");
    expect((byText("Save changes") as HTMLButtonElement).disabled).toBe(true);
    await act(async () => typeInto(title, "Accounting 101"));
    await act(async () => typeInto(desc, "Updated text"));
    await act(async () => byText("Save changes")!.click());
    await flush();
    expect(calls.find((c) => c.method === "PATCH")!.body).toEqual({ title: "Accounting 101", description: "Updated text" });
    expect(document.querySelector('[data-testid="playlist-title"]')?.textContent).toBe("Accounting 101");
    expect(document.querySelector('[data-testid="playlist-description"]')?.textContent).toBe("Updated text");
  });

  it("validates an empty name without calling the API", async () => {
    await mount({ initialView: "edit" });
    await act(async () => typeInto(document.getElementById("pl-edit-title") as HTMLInputElement, "   "));
    await act(async () => byText("Save changes")!.click());
    expect(document.body.textContent).toContain("Playlist name is required.");
    expect(calls.some((c) => c.method === "PATCH")).toBe(false);
  });

  it("adds several Library files at once and disables the ones already in the playlist", async () => {
    await mount();
    await act(async () => byText("Add files from Library")!.click());
    await flush();
    const boxes = Array.from(document.body.querySelectorAll('[data-testid="library-picker"] input[type="checkbox"]')) as HTMLInputElement[];
    expect(boxes).toHaveLength(5);
    expect(boxes.slice(0, 3).every((b) => b.disabled)).toBe(true);
    expect(document.body.textContent).toContain("In playlist");
    expect((byText("Select files to add") as HTMLButtonElement).disabled).toBe(true);
    await act(async () => boxes[3].click());
    await act(async () => boxes[4].click());
    await act(async () => byText("Add 2 files")!.click());
    await flush();
    const post = calls.find((c) => c.method === "POST" && c.url === "/api/playlists/1/files")!;
    expect(post.body).toEqual({ fileIds: [4, 5] });
    expect(rowTitles()).toEqual(["One.pdf", "Two.pdf", "Three.pdf", "New 4", "New 5"]);
    expect(document.querySelector('[data-testid="playlist-count"]')?.textContent?.trim()).toBe("5 files");
  });

  it("the Add-files search uses a flex row (icon + input) and filters the Library", async () => {
    await mount();
    await act(async () => byText("Add files from Library")!.click());
    await flush();
    const input = document.querySelector('input[type="search"]') as HTMLInputElement;
    expect(input.parentElement?.className).toContain("flex");
    expect(input.className).not.toContain("absolute");
    await act(async () => typeInto(input, "five"));
    expect(document.body.querySelectorAll('[data-testid="library-picker"] input[type="checkbox"]')).toHaveLength(1);
  });

  it("shows an error toast when adding fails and keeps the selection", async () => {
    await mount();
    await act(async () => byText("Add files from Library")!.click());
    await flush();
    failNext = { match: /^POST \/api\/playlists\/1\/files$/, status: 404, body: { error: "One or more files weren't found in your library." } };
    const boxes = Array.from(document.body.querySelectorAll('[data-testid="library-picker"] input[type="checkbox"]')) as HTMLInputElement[];
    await act(async () => boxes[3].click());
    await act(async () => byText("Add 1 file")!.click());
    await flush();
    expect(document.body.textContent).toContain("weren't found in your library");
    expect(byText("Add 1 file")).toBeTruthy();
  });

  it("tapping a file offers 'Add to another playlist' and 'Move to another playlist' (multi-playlist membership preserved)", async () => {
    await mount();
    const tap = (title: string) => act(async () => (rowFor(title).querySelector('button[aria-label^="Add or move"]') as HTMLButtonElement).click());
    await tap("One.pdf");
    expect(byText("Add to another playlist")).toBeTruthy();
    expect(byText("Move to another playlist")).toBeTruthy();

    // Add: stays in the source list
    expect(document.body.textContent).toContain("the file stays in this playlist");
    await act(async () => (document.body.querySelector('input[type="radio"]') as HTMLInputElement).click());
    await act(async () => byText("Add here")!.click());
    await flush();
    let t = calls.find((c) => /\/transfer$/.test(c.url))!;
    expect(t.url).toBe("/api/playlists/1/files/1/transfer");
    expect(t.body).toEqual({ toPlaylistId: 2, mode: "add" });
    expect(rowTitles()).toContain("One.pdf");

    // Move: leaves the source list
    calls = [];
    await tap("One.pdf");
    await act(async () => byText("Move to another playlist")!.click());
    expect(document.body.textContent).toContain("the file leaves this playlist");
    await act(async () => (document.body.querySelector('input[type="radio"]') as HTMLInputElement).click());
    await act(async () => byText("Move here")!.click());
    await flush();
    t = calls.find((c) => /\/transfer$/.test(c.url))!;
    expect(t.body).toEqual({ toPlaylistId: 2, mode: "move" });
    expect(rowTitles()).not.toContain("One.pdf");
    expect(document.querySelector('[data-testid="playlist-count"]')?.textContent?.trim()).toBe("2 files");
  });

  it("asks for confirmation before deleting, explains the files are kept, then leaves the page", async () => {
    await mount();
    await choose("delete");
    expect(document.body.textContent).toContain("will NOT be deleted");
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
    const confirm = buttons().filter((b) => b.textContent?.trim() === "Delete").pop()!;
    await act(async () => confirm.click());
    await flush();
    expect(calls.filter((c) => c.method === "DELETE").map((c) => c.url)).toEqual(["/api/playlists/1"]);
    expect(router.replace).toHaveBeenCalledWith("/");
    expect(setActiveTab).toHaveBeenCalledWith("files");
  });
});

describe("Playlist page — modern header (no 'Playlist' label, no bottom delete)", () => {
  it("has NO 'Playlist' label above the title and no other eyebrow/top label in the list view", async () => {
    await mount();
    const texts = Array.from(document.body.querySelectorAll("*")).filter((el) => el.children.length === 0).map((el) => el.textContent?.trim());
    expect(texts).not.toContain("Playlist");
    expect(document.querySelector('[data-testid="playlist-header-title"]')).toBeNull();
    const title = document.querySelector('[data-testid="playlist-title"]')!;
    expect(title.tagName).toBe("H1");
    expect(title.previousElementSibling).toBeNull(); // nothing sits above the title inside its block
  });

  it("shows cover, title, description, count, total size and visibility facts", async () => {
    await mount();
    expect(document.querySelector('[data-testid="playlist-meta"]')?.textContent).toContain("3 files");
    expect(document.querySelector('[data-testid="playlist-meta"]')?.textContent).toContain("2.9 KB"); // 3 × 1000 B
    expect(document.querySelector('[data-testid="playlist-visibility"]')?.textContent).toBe("Private"); // base fixture has no isPublished flag
    expect(coverImg()?.src).toBe("https://cdn/a.webp"); // derived cover only — nothing uploaded
  });

  it("no longer renders the full-width 'Delete playlist' button or a visible 'Edit' button", async () => {
    await mount();
    expect(byText("Delete playlist")).toBeUndefined();
    expect(buttons().some((b) => b.textContent?.trim() === "Edit")).toBe(false);
    expect(document.querySelector('[aria-label="Edit playlist name and description"]')).toBeNull();
  });
});

describe("Playlist page — three-dot menu", () => {
  it("opens with Edit, Share, Copy link and a separated destructive Delete; icons + labels; ARIA menu semantics", async () => {
    await mount();
    expect(menuEl()).toBeNull();
    expect(menuButton().getAttribute("aria-haspopup")).toBe("menu");
    expect(menuButton().getAttribute("aria-expanded")).toBe("false");
    await act(async () => menuButton().click());
    expect(menuButton().getAttribute("aria-expanded")).toBe("true");
    const items = Array.from(menuEl()!.querySelectorAll('[role="menuitem"]'));
    expect(items.map((i) => i.textContent?.trim())).toEqual(["Edit playlist", "Share playlist", "Copy playlist link", "Delete playlist"]);
    expect(items.every((i) => i.querySelector("svg"))).toBe(true);
    expect(items[3].className).toContain("text-red-500"); // destructive is visually distinguished
    expect(menuEl()!.querySelector('[role="separator"]')).not.toBeNull();
    expect(menuEl()!.className).toContain("max-w-[calc(100vw-2rem)]"); // can't overflow a narrow screen
  });

  it("closes on Escape (focus returns to the button), on an outside tap, and when an item is chosen", async () => {
    await mount();
    await act(async () => menuButton().click());
    await act(async () => { menuEl()!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    expect(menuEl()).toBeNull();
    expect(document.activeElement).toBe(menuButton());

    await act(async () => menuButton().click());
    await act(async () => { document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })); });
    expect(menuEl()).toBeNull();

    await choose("edit");
    expect(menuEl()).toBeNull();
  });

  it("Edit playlist opens the existing edit form and saving uses the existing PATCH", async () => {
    await mount();
    await choose("edit");
    expect(document.querySelector('[data-testid="playlist-header-title"]')?.textContent).toBe("Edit playlist");
    await act(async () => typeInto(document.getElementById("pl-edit-title") as HTMLInputElement, "Renamed"));
    await act(async () => byText("Save changes")!.click());
    await flush();
    expect(calls.find((c) => c.method === "PATCH")!.body).toMatchObject({ title: "Renamed" });
  });

  it("Delete playlist goes through the existing confirmation modal; cancelling deletes nothing, confirming deletes only the playlist", async () => {
    await mount();
    await choose("delete");
    expect(document.body.textContent).toContain("will NOT be deleted");
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
    await act(async () => buttons().find((b) => b.textContent?.trim() === "Cancel")!.click());
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
    await choose("delete");
    await act(async () => buttons().filter((b) => b.textContent?.trim() === "Delete").pop()!.click());
    await flush();
    expect(calls.filter((c) => c.method === "DELETE").map((c) => c.url)).toEqual(["/api/playlists/1"]); // never /api/files/*
    expect(router.replace).toHaveBeenCalledWith("/");
  });
});

describe("Playlist page — sharing", () => {
  const clip = () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    return writeText;
  };
  afterEach(() => {
    Reflect.deleteProperty(navigator, "clipboard");
    Reflect.deleteProperty(navigator, "share");
  });
  const sheet = () => document.body.querySelector('[data-testid="share-sheet"]') as HTMLElement | null;
  const shareBtn = (id: string) => document.body.querySelector(`[data-testid="${id}"]`) as HTMLButtonElement;

  it("Share is a prominent header button AND a menu item; both open the same share dialog", async () => {
    await mount();
    expect(document.querySelector('[data-testid="playlist-actions"] [data-testid="playlist-share"]')?.textContent).toContain("Share");
    await act(async () => (document.querySelector('[data-testid="playlist-share"]') as HTMLButtonElement).click());
    await flush();
    expect(sheet()).not.toBeNull();
    await act(async () => buttons().find((b) => b.getAttribute("aria-label") === "Close")!.click());
    expect(sheet()).toBeNull();
    await choose("share");
    await flush();
    expect(sheet()).not.toBeNull();
  });

  it("shows the server-issued public URL (stable token, never the numeric id) and Copy link copies exactly that URL with a success toast", async () => {
    const writeText = clip();
    await mount();
    await act(async () => (document.querySelector('[data-testid="playlist-share"]') as HTMLButtonElement).click());
    await flush();
    const url = `https://onfile.test/p/${SHARE_SLUG}`;
    expect((shareBtn("share-url") as unknown as HTMLInputElement).value).toBe(url);
    const post = calls.find((c) => c.method === "POST" && c.url === "/api/playlists/1/share");
    expect(post).toBeTruthy();
    await act(async () => shareBtn("share-copy").click());
    await flush();
    expect(writeText).toHaveBeenCalledWith(url);
    expect(document.body.textContent).toContain("Playlist link copied");
  });

  it("shows a failure toast when the clipboard is unavailable", async () => {
    Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn(async () => { throw new Error("denied"); }) }, configurable: true });
    const exec = vi.fn(() => false);
    (document as unknown as { execCommand: unknown }).execCommand = exec;
    await mount();
    await act(async () => (document.querySelector('[data-testid="playlist-share"]') as HTMLButtonElement).click());
    await flush();
    await act(async () => shareBtn("share-copy").click());
    await flush();
    expect(document.body.textContent).toContain("Couldn't copy the link");
    Reflect.deleteProperty(document, "execCommand");
  });

  it("Share on Telegram opens Telegram's share dialog for the correct URL (Mini App bridge)", async () => {
    const openTelegramLink = vi.fn();
    (window as unknown as { Telegram: unknown }).Telegram = { WebApp: { openTelegramLink } };
    await mount();
    await act(async () => (document.querySelector('[data-testid="playlist-share"]') as HTMLButtonElement).click());
    await flush();
    await act(async () => shareBtn("share-telegram").click());
    expect(openTelegramLink).toHaveBeenCalledTimes(1);
    const target = new URL(openTelegramLink.mock.calls[0][0] as string);
    expect(target.origin + target.pathname).toBe("https://t.me/share/url");
    expect(target.searchParams.get("url")).toBe(`https://onfile.test/p/${SHARE_SLUG}`);
    expect(target.searchParams.get("text")).toContain("Accounting");
  });

  it("Share on Telegram falls back to a new tab outside Telegram", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    await mount();
    await act(async () => (document.querySelector('[data-testid="playlist-share"]') as HTMLButtonElement).click());
    await flush();
    await act(async () => shareBtn("share-telegram").click());
    expect(String(open.mock.calls[0][0])).toContain("https://t.me/share/url?url=https%3A%2F%2Fonfile.test%2Fp%2F" + SHARE_SLUG);
    open.mockRestore();
  });

  it("offers native sharing only where supported, and passes the real URL", async () => {
    await mount();
    await act(async () => (document.querySelector('[data-testid="playlist-share"]') as HTMLButtonElement).click());
    await flush();
    expect(shareBtn("share-native")).toBeNull(); // jsdom: no navigator.share
    await act(async () => buttons().find((b) => b.getAttribute("aria-label") === "Close")!.click());

    const share = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "share", { value: share, configurable: true });
    await act(async () => (document.querySelector('[data-testid="playlist-share"]') as HTMLButtonElement).click());
    await flush();
    await act(async () => shareBtn("share-native").click());
    expect(share).toHaveBeenCalledWith(expect.objectContaining({ url: `https://onfile.test/p/${SHARE_SLUG}`, title: "Accounting" }));
  });

  it("'Copy playlist link' in the menu copies the link without opening the dialog", async () => {
    const writeText = clip();
    await mount();
    await choose("copy");
    await flush();
    expect(writeText).toHaveBeenCalledWith(`https://onfile.test/p/${SHARE_SLUG}`);
    expect(sheet()).toBeNull();
    expect(document.body.textContent).toContain("Playlist link copied");
  });

  it("a private playlist explains why it can't be shared and offers 'Make public & share' (existing PATCH isPublished)", async () => {
    shareResult = { status: 409, body: { error: "This playlist is private. Make it public to share it.", reason: "private" } };
    await mount();
    await act(async () => (document.querySelector('[data-testid="playlist-share"]') as HTMLButtonElement).click());
    await flush();
    expect(document.querySelector('[data-testid="share-blocked"]')?.textContent).toContain("private");
    expect(document.querySelector('[data-testid="share-url"]')).toBeNull(); // no link is shown or invented
    shareResult = null;
    const original = globalThis.fetch;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "PATCH" && url === "/api/playlists/1") { calls.push({ url, method: "PATCH", body: JSON.parse(init.body as string) }); return json({ playlist: summary() }); }
      return original(url, init);
    }));
    await act(async () => byText("Make public")!.click());
    await flush();
    expect(calls.find((c) => c.method === "PATCH")!.body).toEqual({ isPublished: true });
    expect((shareBtn("share-url") as unknown as HTMLInputElement).value).toBe(`https://onfile.test/p/${SHARE_SLUG}`);
  });

  it("a paid playlist can't be shared and says why; the menu's Copy link reports the same error", async () => {
    shareResult = { status: 409, body: { error: "Paid playlists can't be shared yet because Telegram Stars payments aren't connected.", reason: "paid_unavailable" } };
    await mount();
    await choose("copy");
    await flush();
    expect(document.body.textContent).toContain("Paid playlists can't be shared yet");
  });

  it("notes that password protection stays in force", async () => {
    shareResult = { status: 200, body: { share: { slug: SHARE_SLUG, path: `/p/${SHARE_SLUG}`, url: `https://onfile.test/p/${SHARE_SLUG}`, hasPassword: true } } };
    await mount();
    await act(async () => (document.querySelector('[data-testid="playlist-share"]') as HTMLButtonElement).click());
    await flush();
    expect(document.querySelector('[data-testid="share-password-note"]')?.textContent).toContain("password");
  });
});

describe("Playlist page — opening content (sequential viewing entry points)", () => {
  it("tapping a published file opens the existing file page with the playlist context (list token + position)", async () => {
    await mount();
    await act(async () => (rowFor("Two.pdf").querySelector('[data-testid="playlist-file-open"]') as HTMLButtonElement).click());
    await flush();
    expect(router.push).toHaveBeenCalledWith(`/f/slug-2?list=${SHARE_SLUG}&i=2`);
  });

  it("'Play first' opens the first published file", async () => {
    await mount();
    await act(async () => (document.querySelector('[data-testid="playlist-play"]') as HTMLButtonElement).click());
    await flush();
    expect(router.push).toHaveBeenCalledWith(`/f/slug-1?list=${SHARE_SLUG}&i=1`);
  });

  it("position counts only published files (matching the public list); unpublished files can't be opened and say so", async () => {
    members = [{ ...mk(1, "Draft.pdf"), isPublished: false, smartLinkSlug: null }, mk(2, "Live.pdf"), mk(3, "Live 2.pdf")];
    await mount();
    expect(rowFor("Draft.pdf").querySelector('[data-testid="file-unpublished"]')).not.toBeNull();
    await act(async () => (rowFor("Draft.pdf").querySelector('[data-testid="playlist-file-open"]') as HTMLButtonElement).click());
    expect(router.push).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("isn't published yet");
    await act(async () => (rowFor("Live 2.pdf").querySelector('[data-testid="playlist-file-open"]') as HTMLButtonElement).click());
    await flush();
    expect(router.push).toHaveBeenCalledWith(`/f/slug-3?list=${SHARE_SLUG}&i=2`);
    await act(async () => (document.querySelector('[data-testid="playlist-play"]') as HTMLButtonElement).click());
    await flush();
    expect(router.push).toHaveBeenLastCalledWith(`/f/slug-2?list=${SHARE_SLUG}&i=1`);
  });

  it("when the playlist can't be shared the file still opens plainly (no playlist context)", async () => {
    shareResult = { status: 409, body: { error: "private", reason: "private" } };
    await mount();
    await act(async () => (rowFor("One.pdf").querySelector('[data-testid="playlist-file-open"]') as HTMLButtonElement).click());
    await flush();
    expect(router.push).toHaveBeenCalledWith("/f/slug-1");
  });

  it("hides 'Play first' when nothing is published (no dead button) and the empty state is unchanged", async () => {
    members = [{ ...mk(1, "Draft.pdf"), isPublished: false, smartLinkSlug: null }];
    await mount();
    expect(document.querySelector('[data-testid="playlist-play"]')).toBeNull();
    members = [];
    await act(async () => root.unmount());
    root = createRoot(container);
    await mount();
    expect(document.querySelector('[data-testid="playlist-play"]')).toBeNull();
    expect(document.body.textContent).toContain("This playlist is empty");
  });

  it("each row shows position, type, size and a transfer button that still opens add/move", async () => {
    await mount();
    const row = rowFor("Two.pdf");
    expect(row.querySelector('[data-testid="file-position"]')?.textContent).toBe("2");
    expect(row.textContent).toContain("1000 B");
    expect(row.textContent).not.toMatch(/\d+:\d{2}/); // no invented duration
    await act(async () => (row.querySelector('[data-testid="file-transfer"]') as HTMLButtonElement).click());
    expect(byText("Add to another playlist")).toBeTruthy();
  });
});

describe("Playlist page — layout safety & themes", () => {
  it("uses min-w-0 / wrapping on text blocks and a width-capped column so a 320px screen can't overflow horizontally", async () => {
    await mount();
    const page = document.querySelector('[data-testid="playlist-page"] > div') as HTMLElement;
    expect(page.className).toContain("max-w-2xl");
    expect(page.className).toContain("w-full");
    expect(document.querySelector('[data-testid="playlist-title"]')!.className).toContain("break-words");
    expect(document.querySelector('[data-testid="playlist-title"]')!.parentElement!.className).toContain("min-w-0");
    expect(rowFor("One.pdf").querySelector('[data-testid="playlist-file-open"]')!.className).toContain("min-w-0");
    expect(document.querySelector('[data-testid="playlist-cover"]')!.className).toContain("overflow-hidden");
  });

  it("styles only through theme tokens (bg-card/bg-secondary/text-primary…), never hard-coded light/dark colours", () => {
    const fs = require("fs") as typeof import("fs"); // eslint-disable-line @typescript-eslint/no-require-imports
    for (const f of ["PlaylistPage.tsx", "ShareSheet.tsx", "PublicPlaylistView.tsx", "../viewer/FileViewer.tsx", "../viewer/ActionRow.tsx", "../viewer/PlaylistList.tsx", "../viewer/SavedItemsWidget.tsx", "../viewer/ReportDialog.tsx", "../viewer/DescriptionBlock.tsx", "../ui/ActionMenu.tsx"]) {
      const src = fs.readFileSync(`${__dirname}/${f}`, "utf8");
      expect(src, f).not.toMatch(/\b(bg-white|bg-black|bg-gray-\d+|text-gray-\d+|text-black|bg-slate-\d+)/);
    }
  });
});
