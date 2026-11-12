// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/components/ui/Toast";

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
const mk = (id: number, title: string, thumb: string | null = null): F => ({ id, title, fileType: "document", mimeType: null, fileSize: 1000, isPublished: true, thumbnailUrl: thumb, position: id });

const basePlaylist = { id: 1, title: "Accounting", description: "Intro course", totalFiles: 3, thumbnailUrl: "https://cdn/a.webp" };
const other = { id: 2, title: "BBA Materials", description: null, totalFiles: 1, thumbnailUrl: null };

let container: HTMLDivElement;
let root: Root;
let members: F[];
let playlistMeta: typeof basePlaylist;
let calls: { url: string; method: string; body: unknown }[];
let failNext: { match: RegExp; status: number; body?: unknown } | null;

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
    return json({ error: "unexpected" }, 500);
  }));
}

const buttons = () => Array.from(document.body.querySelectorAll("button"));
const byText = (t: string) => buttons().find((b) => b.textContent?.trim().includes(t)) as HTMLButtonElement | undefined;
const rows = () => Array.from(document.body.querySelectorAll('[data-testid="playlist-file-row"]')) as HTMLElement[];
const rowTitles = () => rows().map((r) => r.querySelector("span.font-semibold")?.textContent);
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
    expect(document.querySelector('[aria-label="Edit playlist name and description"]')).not.toBeNull();
    expect(byText("Delete playlist")).toBeTruthy();
  });

  it("lists files in order with a drag handle each and marks the first as the cover — and has NO three-dot menu", async () => {
    await mount();
    expect(rowTitles()).toEqual(["One.pdf", "Two.pdf", "Three.pdf"]);
    expect(document.body.querySelectorAll('[data-testid="drag-handle"]')).toHaveLength(3);
    expect(rowFor("One.pdf").textContent).toContain("Cover");
    expect(document.body.querySelector('[aria-label^="Actions for"]')).toBeNull();
    expect(document.body.querySelector("svg.lucide-ellipsis, svg.lucide-more-horizontal")).toBeNull();
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
  it("Back returns to the Library with real history when it came from the Library", async () => {
    sessionStorage.setItem(FROM_LIBRARY_KEY, "1");
    await mount();
    await act(async () => (document.querySelector('[data-testid="playlist-back"]') as HTMLButtonElement).click());
    expect(setActiveTab).toHaveBeenCalledWith("files");
    expect(router.back).toHaveBeenCalledTimes(1);
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("Back from a deep link (no history from the Library) replaces the route with the Library", async () => {
    await mount();
    await act(async () => (document.querySelector('[data-testid="playlist-back"]') as HTMLButtonElement).click());
    expect(router.replace).toHaveBeenCalledWith("/");
    expect(router.back).not.toHaveBeenCalled();
    expect(setActiveTab).toHaveBeenCalledWith("files");
  });

  it("Back inside a sub-screen (add files) returns to the playlist first, not the Library", async () => {
    await mount();
    await act(async () => byText("Add files from Library")!.click());
    expect(document.querySelector('[data-testid="playlist-header-title"]')?.textContent).toBe("Add files");
    await act(async () => (document.querySelector('[data-testid="playlist-back"]') as HTMLButtonElement).click());
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
    await act(async () => byText("Edit")!.click());
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
    await act(async () => byText("Delete playlist")!.click());
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
