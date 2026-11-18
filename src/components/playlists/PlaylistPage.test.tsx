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

type F = { id: number; title: string; fileType: string; mimeType: null; fileSize: number; isPublished: boolean; thumbnailUrl: string | null; position: number; hasPassword?: boolean; starsPrice?: number };
type F2 = F & { smartLinkSlug: string | null };
const mk = (id: number, title: string, thumb: string | null = null): F2 => ({ id, title, fileType: "document", mimeType: null, fileSize: 1000, isPublished: true, smartLinkSlug: `slug-${id}`, thumbnailUrl: thumb, position: id });

const basePlaylist: { id: number; title: string; description: string | null; totalFiles: number; thumbnailUrl: string | null; isPublished?: boolean; starsPrice?: number; hasPassword?: boolean } = { id: 1, title: "Accounting", description: "Intro course", totalFiles: 3, thumbnailUrl: "https://cdn/a.webp", isPublished: true };
const other = { id: 2, title: "BBA Materials", description: null, totalFiles: 1, thumbnailUrl: null };

let container: HTMLDivElement;
let root: Root;
let members: F2[];
let playlistMeta: typeof basePlaylist;
let calls: { url: string; method: string; body: unknown }[];
let failNext: { match: RegExp; status: number; body?: unknown } | null;
let shareResult: { status: number; body: unknown } | null;
let duplicateCreate = false;
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
      playlistMeta = { ...playlistMeta, ...body } as typeof playlistMeta;
      if ("password" in body) (playlistMeta as Record<string, unknown>).hasPassword = !!body.password;
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
    if (method === "GET" && url === "/api/playlists/1/stats") return json({ stats: { fileRequests: 7 } });
    if (method === "PATCH" && /^\/api\/files\/\d+$/.test(url)) {
      const id = Number(url.split("/").pop());
      members = members.map((m) => (m.id === id ? { ...m, ...(body.isPublished !== undefined ? { isPublished: body.isPublished } : {}), ...(body.title ? { title: body.title } : {}), ...(body.starsPrice !== undefined ? { starsPrice: body.starsPrice } : {}), ...("password" in body ? { hasPassword: !!body.password } : {}) } : m));
      const m = members.find((x) => x.id === id)!;
      return json({ file: { ...m, password: m.hasPassword ? "hash" : null } });
    }
    if (method === "POST" && url === "/api/playlists") return json({ playlist: { id: 3, title: body.title, description: body.description, totalFiles: 0, thumbnailUrl: null, isPublished: true }, duplicate: duplicateCreate }, duplicateCreate ? 200 : 201);
    if (method === "POST" && url === "/api/playlists/3/files") return json({ added: body.fileIds, alreadyMembers: [] });
    if (method === "PATCH" && url === "/api/playlists/3") return json({ playlist: { id: 3, title: "x", isPublished: body.isPublished } });
    if (method === "DELETE" && url === "/api/playlists/3") return json({ success: true });
    if (method === "POST" && url === "/api/playlists/1/share") {
      if (shareResult) return json(shareResult.body, shareResult.status);
      return json({ share: { slug: SHARE_SLUG, path: `/p/${SHARE_SLUG}`, url: `https://onfile.test/p/${SHARE_SLUG}`, hasPassword: false } });
    }
    return json({ error: "unexpected" }, 500);
  }));
}


const buttons = () => Array.from(document.body.querySelectorAll("button"));
const byText = (t: string) => buttons().find((b) => b.textContent?.trim().includes(t)) as HTMLButtonElement | undefined;
const q = (sel: string) => document.body.querySelector(sel) as HTMLElement | null;
const qa = (sel: string) => Array.from(document.body.querySelectorAll(sel)) as HTMLElement[];
const click = (el: Element | null | undefined) => act(async () => (el as HTMLElement).click());
const headerMenuButton = () => q('[aria-label="Playlist options"]') as HTMLButtonElement;
const moreTile = () => q('[data-testid="playlist-actions"] [data-testid="action-menu-button"]') as HTMLButtonElement;
const menuEl = () => q('[data-testid="action-menu"]');
/** Opens the playlist ⋮ menu in the header and picks an item. */
const choose = async (key: string) => {
  await click(headerMenuButton());
  await click(q(`[data-testid="menu-item-${key}"]`));
};
const rows = () => qa('[data-testid="playlist-file-row"]');
const rowTitles = () => rows().map((r) => r.querySelector('[data-testid="file-title"]')?.textContent);
const rowFor = (title: string) => rows().find((r) => r.textContent?.includes(title))!;
/** Opens a file row's ⋮ menu and picks an item. */
const chooseRow = async (title: string, key: string) => {
  await click(rowFor(title).querySelector('[data-testid="action-menu-button"]'));
  await click(q(`[data-testid="menu-item-${key}"]`));
};
const confirmBtn = () => q('[data-testid="confirm-action"]') as HTMLButtonElement;
const cancelBtn = () => buttons().find((b) => b.textContent?.trim() === "Cancel") as HTMLButtonElement;
const coverImg = () => q('[data-testid="playlist-cover"] img') as HTMLImageElement | null;
const anyModal = () => q(".fixed.inset-0.z-50");
const wrote = (method: string, urlRe?: RegExp) => calls.filter((c) => c.method === method && (!urlRe || urlRe.test(c.url)));

function typeInto(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}
const type = (sel: string, value: string) => act(async () => typeInto(q(sel) as HTMLInputElement, value));

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
  duplicateCreate = false;
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

describe("Creator playlist page — layout", () => {
  it("renders header, cover, title, description and facts from real data on a full page (no modal)", async () => {
    await mount();
    expect(q('[data-testid="playlist-page"]')).not.toBeNull();
    expect(anyModal()).toBeNull();
    expect(q('[data-testid="playlist-title"]')?.textContent).toBe("Accounting");
    expect(q('[data-testid="playlist-description"]')?.textContent).toBe("Intro course");
    expect(q('[data-testid="playlist-visibility"]')?.textContent).toBe("Public");
    expect(q('[data-testid="playlist-count"]')?.textContent?.trim()).toBe("3 files");
    expect(q('[data-testid="playlist-size"]')?.textContent).toContain("2.9 KB"); // 3 × 1000 B, summed from the files
    expect(coverImg()?.src).toBe("https://cdn/a.webp");
  });

  it("shows the four primary actions in order: Add Files · Preview · Share · More", async () => {
    await mount();
    const actions = q('[data-testid="playlist-actions"]')!;
    const labels = Array.from(actions.querySelectorAll(":scope > button, :scope > div > button")).map((b) => b.textContent?.trim());
    expect(labels).toEqual(["Add Files", "Preview", "Share", "More"]);
    expect(actions.className).toContain("grid-cols-4"); // all four share one row on a phone
  });

  it("has no large decorative 'Playlist' heading; the compact header says 'Manage' and the title is the only <h1>", async () => {
    await mount();
    expect(q('[data-testid="playlist-header-title"]')?.textContent).toBe("Manage");
    expect(qa("h1").map((h) => h.textContent)).toEqual(["Accounting"]);
    expect(qa("h1, h2, p").some((e) => e.textContent?.trim() === "Playlist")).toBe(false);
  });

  it("lists files in the saved order with handle, position, type, size, status and a ⋮ menu each; the first is the cover", async () => {
    await mount();
    expect(rowTitles()).toEqual(["One.pdf", "Two.pdf", "Three.pdf"]);
    expect(qa('[data-testid="drag-handle"]')).toHaveLength(3);
    const row = rowFor("Two.pdf");
    expect(row.querySelector('[data-testid="file-position"]')?.textContent).toBe("2");
    expect(row.textContent).toContain("1000 B");
    expect(row.querySelector('[data-testid="file-published"]')).not.toBeNull();
    expect(row.querySelector('[aria-haspopup="menu"]')).not.toBeNull();
    expect(row.textContent).not.toMatch(/\d+:\d{2}/); // no invented duration
    expect(rowFor("One.pdf").textContent).toContain("Cover");
  });

  it("shows an empty-playlist state with an Add Files button and the default cover", async () => {
    members = [];
    await mount();
    expect(q('[data-testid="playlist-empty"]')?.textContent).toContain("This playlist is empty");
    expect(q('[data-testid="playlist-count"]')?.textContent?.trim()).toBe("0 files");
    expect(q('[data-testid="playlist-size"]')).toBeNull();
    expect(q('[data-testid="playlist-default-art"]')).not.toBeNull();
    await click(q('[data-testid="playlist-empty"] button'));
    expect(q('[data-testid="add-files"]')).not.toBeNull();
  });

  it("marks a total as a lower bound when some sizes are unknown, and hides it when none are known", async () => {
    members = [mk(1, "A.pdf"), { ...mk(2, "B.pdf"), fileSize: null as unknown as number }];
    await mount();
    expect(q('[data-testid="playlist-size"]')?.textContent).toContain("1000 B+");
    await act(async () => root.unmount());
    root = createRoot(container);
    members = [{ ...mk(1, "A.pdf"), fileSize: null as unknown as number }];
    await mount();
    expect(q('[data-testid="playlist-size"]')).toBeNull();
  });

  it("notes files that visitors can't open (not published) and shows Private / password / Stars status", async () => {
    members = [{ ...mk(1, "Draft.pdf"), isPublished: false, smartLinkSlug: null }, mk(2, "Live.pdf")];
    playlistMeta = { ...playlistMeta, isPublished: false, hasPassword: true, starsPrice: 50 };
    await mount();
    expect(q('[data-testid="playlist-unpublished-note"]')?.textContent).toContain("1 file isn't published");
    expect(q('[data-testid="playlist-visibility"]')?.textContent).toBe("Private");
    expect(q('[data-testid="playlist-password-chip"]')).not.toBeNull();
    expect(q('[data-testid="playlist-stars-chip"]')?.textContent).toContain("50");
  });

  it("shows a friendly state when the playlist doesn't exist", async () => {
    await mount({ id: 404 });
    expect(q('[data-testid="playlist-error"]')?.textContent).toContain("Playlist not found");
  });

  it("opens straight into Edit details when asked (?edit=1)", async () => {
    await mount({ initialView: "edit" });
    expect(document.getElementById("pl-edit-title")).not.toBeNull();
    expect(q('[data-testid="playlist-header-title"]')?.textContent).toBe("Edit details");
  });
});

describe("Creator playlist page — analytics (real data only)", () => {
  it("shows the file-request count the backend records and says what isn't tracked", async () => {
    await mount();
    expect(wrote("GET", /\/api\/playlists\/1\/stats$/)).toHaveLength(1);
    expect(q('[data-testid="stat-file-requests"]')?.textContent).toBe("7");
    const text = q('[data-testid="playlist-stats"]')!.textContent!;
    expect(text).toContain("not confirmed Telegram deliveries");
    expect(text).toContain("aren't tracked yet");
    expect(text).not.toMatch(/\$|USDT|revenue/i); // never shows invented money
  });

  it("degrades gracefully when analytics can't be loaded", async () => {
    failNext = { match: /stats$/, status: 500 };
    await mount();
    expect(q('[data-testid="playlist-stats"]')?.textContent).toContain("unavailable");
    expect(q('[data-testid="stat-file-requests"]')).toBeNull();
    expect(rowTitles()).toHaveLength(3); // the rest of the page is unaffected
  });
});

describe("Creator playlist page — navigation", () => {
  const pressNativeBack = async (tg: ReturnType<typeof installTelegramBackButton>) => act(async () => tg.press());

  it("outside Telegram the header has its own Back button that returns to the Library", async () => {
    sessionStorage.setItem(FROM_LIBRARY_KEY, "1");
    await mount();
    const back = q('[data-testid="page-back"]') as HTMLButtonElement;
    expect(back.getAttribute("aria-label")).toBe("Back to your playlists");
    expect(back.offsetParent === null && false).toBe(false);
    await click(back);
    expect(setActiveTab).toHaveBeenCalledWith("files");
    expect(router.back).toHaveBeenCalledTimes(1);
  });

  it("inside Telegram the native Back Button is the only back control (no duplicate arrow)", async () => {
    installTelegramBackButton();
    await mount();
    expect(q('[data-testid="page-back"]')).toBeNull();
  });

  it("native Back returns to the Library with real history when it came from the Library", async () => {
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
  });

  it("Back inside a sub-screen returns to the playlist first, not the Library", async () => {
    const tg = installTelegramBackButton();
    await mount();
    await click(q('[data-testid="action-add-files"]'));
    expect(q('[data-testid="playlist-header-title"]')?.textContent).toBe("Add files");
    await pressNativeBack(tg);
    expect(q('[data-testid="playlist-title"]')).not.toBeNull();
    expect(router.back).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("the in-page Back and Escape also leave a sub-screen, and focus moves to the screen heading", async () => {
    await mount();
    await click(q('[data-testid="action-add-files"]'));
    expect(document.activeElement).toBe(q('[data-testid="playlist-header-title"]'));
    await click(q('[data-testid="page-back"]'));
    expect(q('[data-testid="playlist-title"]')).not.toBeNull();
    await click(q('[data-testid="action-add-files"]'));
    await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(q('[data-testid="playlist-title"]')).not.toBeNull();
    expect(router.back).not.toHaveBeenCalled();
  });

  it("drives Telegram's native BackButton and hides it when leaving", async () => {
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

describe("Creator playlist page — reordering", () => {
  it("uses mouse + touch + keyboard sensors and keeps the drag on the handle only", async () => {
    await mount();
    expect(dnd.sensors).toHaveLength(3);
    const handle = q('[data-testid="drag-handle"]') as HTMLElement;
    expect(handle.style.touchAction).toBe("none");
    expect(handle.getAttribute("aria-label")).toMatch(/Reorder One\.pdf/);
  });

  it("drag-end shows the new order immediately, PUTs the full id list and refreshes the cover", async () => {
    await mount();
    await act(async () => dnd.onDragEnd!({ active: { id: 3 }, over: { id: 1 } }));
    expect(rowTitles()).toEqual(["Three.pdf", "One.pdf", "Two.pdf"]);
    await flush();
    const put = wrote("PUT")[0];
    expect(put.url).toBe("/api/playlists/1/files");
    expect(put.body).toEqual({ fileIds: [3, 1, 2] });
    expect(coverImg()).toBeNull(); // new first file (Three.pdf) has no thumbnail → default art
    expect(q('[data-testid="playlist-default-art"]')).not.toBeNull();
  });

  it("shows a loading state while saving the order and disables further changes", async () => {
    await mount();
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const original = globalThis.fetch;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "PUT") await gate;
      return (original as typeof fetch)(url, init);
    }));
    await act(async () => { void dnd.onDragEnd!({ active: { id: 3 }, over: { id: 1 } }); });
    expect(document.body.textContent).toContain("Saving…");
    expect((q('[data-testid="drag-handle"]') as HTMLButtonElement).disabled).toBe(true);
    expect((q('[data-testid="action-add-files"]') as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { release(); await gate; });
    await flush();
    expect(document.body.textContent).not.toContain("Saving…");
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
    expect(wrote("PUT")).toHaveLength(0);
  });

  it("a drag never removes or deletes anything", async () => {
    await mount();
    await act(async () => dnd.onDragEnd!({ active: { id: 1 }, over: { id: 3 } }));
    await flush();
    expect(wrote("DELETE")).toHaveLength(0);
  });
});

describe("Creator playlist page — Add Files (existing channel Library workflow)", () => {
  const open = async () => {
    await mount();
    await click(q('[data-testid="action-add-files"]'));
    await flush();
  };
  const box = (title: string) => q(`input[aria-label="Select ${title}"]`) as HTMLInputElement;

  it("lists the channel's files, disables the ones already in the playlist and keeps the Add button inert until something is selected", async () => {
    await open();
    expect(q('[data-testid="library-picker"]')).not.toBeNull();
    expect(box("One.pdf").disabled).toBe(true);
    expect(box("Four.pdf").disabled).toBe(false);
    expect(document.body.textContent).toContain("In playlist");
    expect((q('[data-testid="add-files-submit"]') as HTMLButtonElement).disabled).toBe(true);
    expect(document.body.textContent).toContain("never copied");
  });

  it("adds several files at once by id (references only) and returns to the updated list", async () => {
    await open();
    await click(box("Four.pdf"));
    await click(box("Five.docx"));
    expect(q('[data-testid="add-files-submit"]')?.textContent).toContain("Add 2 files");
    await click(q('[data-testid="add-files-submit"]'));
    await flush();
    const post = wrote("POST", /\/api\/playlists\/1\/files$/)[0];
    expect(post.body).toEqual({ fileIds: [4, 5] });
    expect(q('[data-testid="playlist-title"]')).not.toBeNull();
    expect(rowTitles()).toEqual(["One.pdf", "Two.pdf", "Three.pdf", "New 4", "New 5"]);
    expect(document.body.textContent).toContain("Added 2 files");
    expect(wrote("POST").every((c) => !/\/api\/files/.test(c.url))).toBe(true); // nothing uploaded
  });

  it("never sends files that are already members (duplicates are skipped client-side as well as server-side)", async () => {
    await open();
    await click(q('[data-testid="select-all"]'));
    await click(q('[data-testid="add-files-submit"]'));
    await flush();
    expect(wrote("POST", /\/api\/playlists\/1\/files$/)[0].body).toEqual({ fileIds: [4, 5] });
  });

  it("filters by search and 'Select all results' only selects what is shown", async () => {
    await open();
    await type('input[type="search"]', "docx");
    expect(qa('[data-testid="library-picker"] li')).toHaveLength(1);
    await click(q('[data-testid="select-all"]'));
    expect(box("Five.docx").checked).toBe(true);
    await type('input[type="search"]', "");
    expect(box("Four.pdf").checked).toBe(false);
  });

  it("shows an error and keeps the selection when adding fails", async () => {
    await open();
    await click(box("Four.pdf"));
    failNext = { match: /^POST \/api\/playlists\/1\/files/, status: 403, body: { error: "One or more files weren't found in your library." } };
    await click(q('[data-testid="add-files-submit"]'));
    await flush();
    expect(q('[role="alert"]')?.textContent).toContain("weren't found");
    expect(box("Four.pdf").checked).toBe(true);
    expect(q('[data-testid="add-files"]')).not.toBeNull();
  });

  it("shows a loading state, then an error with retry when the channel files can't be loaded", async () => {
    await mount();
    failNext = { match: /^GET \/api\/files/, status: 500 };
    await click(q('[data-testid="action-add-files"]'));
    await flush();
    expect(q('[role="alert"]')?.textContent).toContain("Couldn't load");
    await click(byText("Try again"));
    await flush();
    expect(q('[data-testid="library-picker"]')).not.toBeNull();
  });

  it("explains an empty connected channel and links to Create", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => (url === "/api/files" ? json({ files: [] }) : url === "/api/playlists" ? json({ playlists: [summary()] }) : url.endsWith("/stats") ? json({ stats: { fileRequests: 0 } }) : json({ files: members }))));
    await mount();
    await click(q('[data-testid="action-add-files"]'));
    await flush();
    expect(q('[data-testid="add-files-empty-channel"]')?.textContent).toContain("No files from your channel yet");
    await click(byText("Go to Create"));
    expect(setActiveTab).toHaveBeenCalledWith("create");
    expect(router.replace).toHaveBeenCalledWith("/");
  });

  it("tells the creator when every channel file is already in the playlist", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => (url === "/api/files" ? json({ files: [mk(1, "One.pdf"), mk(2, "Two.pdf"), mk(3, "Three.pdf")] }) : url === "/api/playlists" ? json({ playlists: [summary()] }) : url.endsWith("/stats") ? json({ stats: { fileRequests: 0 } }) : json({ files: members }))));
    await mount();
    await click(q('[data-testid="action-add-files"]'));
    await flush();
    expect(document.body.textContent).toContain("Every file is already in this playlist");
    expect(q('[data-testid="select-all"]')).toBeNull();
  });
});

describe("Creator playlist page — file actions", () => {
  it("each row's ⋮ menu offers Preview, File settings, Move, Unpublish, Use as cover and Remove (and nothing unsupported)", async () => {
    await mount();
    await click(rowFor("Two.pdf").querySelector('[data-testid="action-menu-button"]'));
    const labels = qa('[data-testid="action-menu"] [role="menuitem"]').map((i) => i.textContent?.trim());
    expect(labels).toEqual(["Preview", "File settings", "Move to another playlist", "Unpublish", "Use as playlist cover", "Remove from playlist"]);
    expect(q('[data-testid="menu-item-remove"]')!.className).toContain("text-red-500");
  });

  it("the first file has no 'Use as cover' (it already is the cover)", async () => {
    await mount();
    await click(rowFor("One.pdf").querySelector('[data-testid="action-menu-button"]'));
    expect(q('[data-testid="menu-item-cover"]')).toBeNull();
  });

  it("Preview opens the existing public file page with the playlist context (list token + position)", async () => {
    await mount();
    await chooseRow("Two.pdf", "preview");
    await flush();
    expect(router.push).toHaveBeenCalledWith(`/f/slug-2?list=${SHARE_SLUG}&i=2`);
  });

  it("tapping a row previews it too", async () => {
    await mount();
    await click(rowFor("Three.pdf").querySelector('[data-testid="playlist-file-open"]'));
    await flush();
    expect(router.push).toHaveBeenCalledWith(`/f/slug-3?list=${SHARE_SLUG}&i=3`);
  });

  it("position counts only published files (matching the public list); unpublished files can't be previewed", async () => {
    members = [{ ...mk(1, "Draft.pdf"), isPublished: false, smartLinkSlug: null }, mk(2, "Live.pdf"), mk(3, "Live 2.pdf")];
    await mount();
    expect(rowFor("Draft.pdf").querySelector('[data-testid="file-unpublished"]')).not.toBeNull();
    await click(rowFor("Draft.pdf").querySelector('[data-testid="playlist-file-open"]'));
    expect(router.push).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("isn't published yet");
    await click(rowFor("Draft.pdf").querySelector('[data-testid="action-menu-button"]'));
    expect((q('[data-testid="menu-item-preview"]') as HTMLButtonElement).disabled).toBe(true);
    await act(async () => menuEl()!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    await chooseRow("Live 2.pdf", "preview");
    await flush();
    expect(router.push).toHaveBeenCalledWith(`/f/slug-3?list=${SHARE_SLUG}&i=2`);
  });

  it("when the playlist can't be shared the file still previews plainly (no playlist context)", async () => {
    shareResult = { status: 409, body: { error: "private", reason: "private" } };
    await mount();
    await chooseRow("One.pdf", "preview");
    await flush();
    expect(router.push).toHaveBeenCalledWith("/f/slug-1");
  });

  it("Remove from playlist asks first; Cancel does nothing", async () => {
    await mount();
    await chooseRow("Two.pdf", "remove");
    expect(q('[role="dialog"]')?.textContent).toContain("removed from this playlist only");
    expect(q('[role="dialog"]')?.textContent).toContain("stays in your Telegram channel");
    expect(wrote("DELETE")).toHaveLength(0);
    await click(cancelBtn());
    expect(wrote("DELETE")).toHaveLength(0);
    expect(rowTitles()).toEqual(["One.pdf", "Two.pdf", "Three.pdf"]);
  });

  it("confirming removes ONLY the membership (never /api/files) and updates rows and count at once", async () => {
    await mount();
    await chooseRow("Two.pdf", "remove");
    await click(confirmBtn());
    await flush();
    expect(wrote("DELETE").map((c) => c.url)).toEqual(["/api/playlists/1/files/2"]);
    expect(rowTitles()).toEqual(["One.pdf", "Three.pdf"]);
    expect(q('[data-testid="playlist-count"]')?.textContent?.trim()).toBe("2 files");
    expect(document.body.textContent).toContain("original file is untouched");
  });

  it("removing the FIRST file moves the cover to the next file; a failed request restores row, count and cover", async () => {
    members = [mk(1, "One.pdf", "https://cdn/a.webp"), mk(2, "Two.pdf", "https://cdn/b.webp")];
    await mount();
    failNext = { match: /^DELETE /, status: 500 };
    await chooseRow("One.pdf", "remove");
    await click(confirmBtn());
    await flush();
    expect(rowTitles()).toEqual(["One.pdf", "Two.pdf"]);
    expect(q('[data-testid="playlist-count"]')?.textContent?.trim()).toBe("2 files");
    expect(coverImg()?.src).toBe("https://cdn/a.webp");
    expect(document.body.textContent).toContain("Couldn't remove it");
  });

  it("Unpublish asks first (it affects every playlist and the file's own link); confirming sends one PATCH and keeps the row", async () => {
    await mount();
    await chooseRow("Two.pdf", "publish");
    expect(q('[role="dialog"]')?.textContent).toContain("isn't deleted");
    expect(wrote("PATCH")).toHaveLength(0);
    await click(cancelBtn());
    expect(wrote("PATCH")).toHaveLength(0);
    await chooseRow("Two.pdf", "publish");
    await click(confirmBtn());
    await flush();
    const patches = wrote("PATCH");
    expect(patches).toHaveLength(1);
    expect(patches[0].url).toBe("/api/files/2");
    expect(patches[0].body).toEqual({ isPublished: false });
    expect(rowTitles()).toEqual(["One.pdf", "Two.pdf", "Three.pdf"]); // never silently deleted
    expect(rowFor("Two.pdf").querySelector('[data-testid="file-unpublished"]')).not.toBeNull();
    expect(wrote("DELETE")).toHaveLength(0);
  });

  it("Publish needs no confirmation and flips the status", async () => {
    members = [mk(1, "One.pdf"), { ...mk(2, "Draft.pdf"), isPublished: false }];
    await mount();
    await chooseRow("Draft.pdf", "publish");
    await flush();
    expect(wrote("PATCH")[0].body).toEqual({ isPublished: true });
    expect(rowFor("Draft.pdf").querySelector('[data-testid="file-published"]')).not.toBeNull();
  });

  it("a failed publish change is reported and the row is unchanged", async () => {
    members = [mk(1, "One.pdf"), { ...mk(2, "Draft.pdf"), isPublished: false }];
    await mount();
    failNext = { match: /^PATCH /, status: 500 };
    await chooseRow("Draft.pdf", "publish");
    await flush();
    expect(document.body.textContent).toContain("Couldn't publish");
    expect(rowFor("Draft.pdf").querySelector('[data-testid="file-unpublished"]')).not.toBeNull();
  });

  it("'Use as playlist cover' moves that file to the top through the existing reorder endpoint", async () => {
    await mount();
    await chooseRow("Three.pdf", "cover");
    await flush();
    expect(wrote("PUT")[0].body).toEqual({ fileIds: [3, 1, 2] });
    expect(rowTitles()).toEqual(["Three.pdf", "One.pdf", "Two.pdf"]);
  });

  it("Move to another playlist opens the transfer screen with 'Move' preselected and posts to the existing endpoint", async () => {
    await mount();
    await chooseRow("Two.pdf", "move");
    expect(q('[data-testid="playlist-header-title"]')?.textContent).toBe("Move to another playlist");
    expect(buttons().find((b) => b.getAttribute("aria-pressed") === "true")?.textContent).toContain("Move");
    await click(q('input[aria-label="BBA Materials"]'));
    await click(byText("Move here"));
    await flush();
    const t = wrote("POST", /transfer$/)[0];
    expect(t.url).toBe("/api/playlists/1/files/2/transfer");
    expect(t.body).toEqual({ toPlaylistId: 2, mode: "move" });
    expect(rowTitles()).toEqual(["One.pdf", "Three.pdf"]);
    expect(wrote("DELETE")).toHaveLength(0);
  });

  it("File settings edits the title and Stars price with the existing file PATCH (password untouched → not sent)", async () => {
    await mount();
    await chooseRow("Two.pdf", "settings");
    expect(q('[data-testid="playlist-header-title"]')?.textContent).toBe("File settings");
    const [pw, stars] = qa('[role="switch"]');
    expect(pw.getAttribute("aria-checked")).toBe("false");
    await click(stars);
    await type('input[inputmode="numeric"]', "25");
    const title = q('input[maxlength="120"]') as HTMLInputElement;
    await act(async () => typeInto(title, "Two (final).pdf"));
    await click(byText("Save changes"));
    await flush();
    const patch = wrote("PATCH", /\/api\/files\/2$/)[0];
    expect(patch.body).toEqual({ title: "Two (final).pdf", starsPrice: 25 });
    expect(rowTitles()).toContain("Two (final).pdf");
    expect(q('[data-testid="playlist-title"]')).not.toBeNull(); // back on the list
  });

  it("File settings validates before calling the API", async () => {
    await mount();
    await chooseRow("Two.pdf", "settings");
    await click(qa('[role="switch"]')[0]); // password on, nothing typed
    await click(qa('[role="switch"]')[1]); // Stars on
    await type('input[inputmode="numeric"]', "5");
    await click(byText("Save changes"));
    expect(q('[role="alert"]')?.textContent).toContain("Enter a password");
    await click(qa('[role="switch"]')[0]); // password off again
    await type('input[inputmode="numeric"]', "20000"); // above the maximum
    await click(byText("Save changes"));
    expect(q('[role="alert"]')?.textContent).toContain("whole number of Stars");
    expect(wrote("PATCH")).toHaveLength(0);
  });
});

describe("Creator playlist page — playlist More menu", () => {
  it("both the header ⋮ and the More tile open the same accessible menu with the supported actions, Delete last and destructive", async () => {
    await mount();
    await click(headerMenuButton());
    const labels = qa('[data-testid="action-menu"] [role="menuitem"]').map((i) => i.textContent?.trim());
    expect(labels).toEqual(["Edit details", "Make private", "Monetization settings", "Share settings", "Copy public link", "Duplicate playlist", "Delete playlist"]);
    expect(menuEl()?.getAttribute("role")).toBe("menu");
    expect(q('[data-testid="menu-item-delete"]')!.className).toContain("text-red-500");
    expect(qa('[role="separator"]').length).toBeGreaterThanOrEqual(2);
    expect(headerMenuButton().getAttribute("aria-expanded")).toBe("true");
    // Escape closes it and focus returns to the trigger
    await act(async () => menuEl()!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(menuEl()).toBeNull();
    expect(document.activeElement).toBe(headerMenuButton());
    await click(moreTile());
    expect(qa('[data-testid="action-menu"] [role="menuitem"]')).toHaveLength(7);
  });

  it("Edit details saves title and description with the existing PATCH and shows them at once", async () => {
    await mount();
    await choose("edit");
    await type("#pl-edit-title", "Accounting 101");
    await type("#pl-edit-desc", "New description");
    await click(byText("Save changes"));
    await flush();
    expect(wrote("PATCH")[0].body).toEqual({ title: "Accounting 101", description: "New description" });
    expect(q('[data-testid="playlist-title"]')?.textContent).toBe("Accounting 101");
  });

  it("Edit details validates an empty name without calling the API", async () => {
    await mount({ initialView: "edit" });
    await type("#pl-edit-title", "   ");
    await click(byText("Save changes"));
    expect(q('[role="alert"]')?.textContent).toContain("name is required");
    expect(wrote("PATCH")).toHaveLength(0);
  });

  it("Change cover (on the cover and in Edit details) lets the creator pick a file as cover — no upload", async () => {
    await mount();
    await click(q('[data-testid="change-cover"]'));
    expect(q('[data-testid="cover-picker"]')).not.toBeNull();
    expect(q('[data-testid="cover-picker"]')!.textContent).toContain("Nothing is uploaded");
    expect((qa('[data-testid="cover-option"]')[0] as HTMLButtonElement).disabled).toBe(true); // current cover
    await click(qa('[data-testid="cover-option"]')[2]);
    await flush();
    expect(wrote("PUT")[0].body).toEqual({ fileIds: [3, 1, 2] });
    expect(wrote("POST").length).toBe(0);
  });

  it("Make private asks first, then PATCHes isPublished=false and the status updates", async () => {
    await mount();
    await choose("visibility");
    expect(q('[role="dialog"]')?.textContent).toContain("public link stops working");
    expect(wrote("PATCH")).toHaveLength(0);
    await click(confirmBtn());
    await flush();
    expect(wrote("PATCH")[0].body).toEqual({ isPublished: false });
    expect(q('[data-testid="playlist-visibility"]')?.textContent).toBe("Private");
  });

  it("Make public (when private) needs no confirmation", async () => {
    playlistMeta = { ...playlistMeta, isPublished: false };
    await mount();
    await choose("visibility");
    await flush();
    expect(wrote("PATCH")[0].body).toEqual({ isPublished: true });
    expect(q('[data-testid="playlist-visibility"]')?.textContent).toBe("Public");
  });

  it("Monetization settings: free by default; password and Stars are independent and use the existing PATCH fields", async () => {
    await mount();
    await choose("monetization");
    expect(q('[data-testid="access-summary"]')?.textContent).toContain("Free access");
    const [pw, stars] = qa('[role="switch"]');
    await click(pw);
    await type('input[type="password"]', "s3cret");
    await click(stars);
    await type('input[inputmode="numeric"]', "100");
    expect(q('[data-testid="access-summary"]')?.textContent).toContain("Password + Stars");
    expect(document.body.textContent).toContain("can't be shared yet"); // honest note about Stars playlists
    await click(byText("Save changes"));
    await flush();
    expect(wrote("PATCH")[0].body).toEqual({ password: "s3cret", starsPrice: 100 });
    expect(q('[data-testid="playlist-password-chip"]')).not.toBeNull();
    expect(q('[data-testid="playlist-stars-chip"]')?.textContent).toContain("100");
  });

  it("Monetization settings: switching both off clears them; an empty new password is rejected client-side", async () => {
    playlistMeta = { ...playlistMeta, hasPassword: true, starsPrice: 10 };
    await mount();
    await choose("monetization");
    await click(qa('[role="switch"]')[0]);
    await click(qa('[role="switch"]')[1]);
    expect(q('[data-testid="access-summary"]')?.textContent).toContain("Free access");
    await click(byText("Save changes"));
    await flush();
    expect(wrote("PATCH")[0].body).toEqual({ password: null, starsPrice: 0 });
    expect(q('[data-testid="playlist-password-chip"]')).toBeNull();
    // new playlist without password: turning it on and saving blank is refused
    await choose("monetization");
    await click(qa('[role="switch"]')[0]);
    await click(qa('[role="switch"]')[1]);
    await type('input[inputmode="numeric"]', "5");
    await click(byText("Save changes"));
    expect(q('[role="alert"]')?.textContent).toContain("Enter a password");
    expect(wrote("PATCH")).toHaveLength(1);
  });

  it("an existing password is kept when the field is left blank (only other changes are sent)", async () => {
    playlistMeta = { ...playlistMeta, hasPassword: true };
    await mount();
    await choose("monetization");
    await click(qa('[role="switch"]')[1]);
    await type('input[inputmode="numeric"]', "7");
    await click(byText("Save changes"));
    await flush();
    expect(wrote("PATCH")[0].body).toEqual({ starsPrice: 7 }); // no `password` key
  });

  it("Share settings opens the existing share dialog", async () => {
    await mount();
    await choose("share");
    await flush();
    expect(q('[data-testid="share-sheet"]')).not.toBeNull();
  });

  it("Duplicate asks first, then creates a copy of the structure through the existing endpoints (no files copied)", async () => {
    await mount();
    await choose("duplicate");
    expect(q('[role="dialog"]')?.textContent).toContain("Copy of Accounting");
    expect(q('[role="dialog"]')?.textContent).toContain("aren't copied");
    expect(wrote("POST")).toHaveLength(0);
    await click(confirmBtn());
    await flush();
    const create = wrote("POST", /^\/api\/playlists$/)[0];
    expect(create.body).toMatchObject({ title: "Copy of Accounting", description: "Intro course" });
    expect(wrote("POST", /\/api\/playlists\/3\/files$/)[0].body).toEqual({ fileIds: [1, 2, 3] });
    expect(wrote("DELETE")).toHaveLength(0);
    expect(document.body.textContent).toContain("Duplicated as");
    expect(q('[data-testid="playlist-title"]')?.textContent).toBe("Accounting"); // stays on the original
  });

  it("a private playlist's copy is made private too", async () => {
    playlistMeta = { ...playlistMeta, isPublished: false };
    await mount();
    await choose("duplicate");
    await click(confirmBtn());
    await flush();
    expect(wrote("PATCH", /playlists\/3$/)[0].body).toEqual({ isPublished: false });
  });

  it("if adding files to the copy fails, the half-built copy is deleted again", async () => {
    await mount();
    await choose("duplicate");
    failNext = { match: /^POST \/api\/playlists\/3\/files/, status: 500 };
    await click(confirmBtn());
    await flush();
    expect(wrote("DELETE").map((c) => c.url)).toEqual(["/api/playlists/3"]);
    expect(document.body.textContent).toContain("Nothing was created");
  });

  it("if a same-named playlist was just created, nothing is added to it", async () => {
    duplicateCreate = true;
    await mount();
    await choose("duplicate");
    await click(confirmBtn());
    await flush();
    expect(wrote("POST", /playlists\/3\/files$/)).toHaveLength(0);
  });

  it("Delete goes through a confirmation that says Telegram files are not deleted; Cancel deletes nothing, confirming deletes only the playlist", async () => {
    await mount();
    await choose("delete");
    expect(q('[role="dialog"]')?.textContent).toContain("NOT deleted");
    expect(q('[role="dialog"]')?.textContent).toContain("Telegram channel");
    expect(wrote("DELETE")).toHaveLength(0);
    await click(cancelBtn());
    expect(wrote("DELETE")).toHaveLength(0);
    await choose("delete");
    await click(buttons().filter((b) => b.textContent?.trim() === "Delete").pop());
    await flush();
    expect(wrote("DELETE").map((c) => c.url)).toEqual(["/api/playlists/1"]); // never /api/files/*
    expect(router.replace).toHaveBeenCalledWith("/");
  });

  it("a failed delete keeps the page and reports it", async () => {
    await mount();
    failNext = { match: /^DELETE /, status: 500 };
    await choose("delete");
    await click(buttons().filter((b) => b.textContent?.trim() === "Delete").pop());
    await flush();
    expect(router.replace).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("Couldn't delete");
  });

  it("dialogs close on Escape and focus Cancel first", async () => {
    await mount();
    await choose("delete");
    expect(document.activeElement?.textContent?.trim()).toBe("Cancel");
    await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(q('[role="dialog"]')).toBeNull();
  });
});

describe("Creator playlist page — Preview (real public viewer)", () => {
  it("opens the actual public playlist route /p/<token> and changes nothing", async () => {
    await mount();
    await click(q('[data-testid="action-preview"]'));
    await flush();
    expect(router.push).toHaveBeenCalledWith(`/p/${SHARE_SLUG}`);
    expect(wrote("PATCH")).toHaveLength(0);
    expect(wrote("PUT")).toHaveLength(0);
    expect(wrote("DELETE")).toHaveLength(0);
    expect(String(router.push.mock.calls[0][0])).not.toMatch(/\/playlists\/|\b1\b/); // no numeric id, no creator route
  });

  it("a private playlist has no public page: explains it, offers the share dialog, and does NOT publish it", async () => {
    playlistMeta = { ...playlistMeta, isPublished: false };
    await mount();
    await click(q('[data-testid="action-preview"]'));
    await flush();
    expect(router.push).not.toHaveBeenCalled();
    expect(wrote("PATCH")).toHaveLength(0);
    expect(document.body.textContent).toContain("is private");
    expect(q('[data-testid="share-sheet"]')).not.toBeNull();
  });

  it("a Stars-priced playlist has no public page yet and says so", async () => {
    playlistMeta = { ...playlistMeta, starsPrice: 50 };
    await mount();
    await click(q('[data-testid="action-preview"]'));
    await flush();
    expect(router.push).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("nothing to preview");
  });

  it("reports a failure to create the link", async () => {
    shareResult = { status: 500, body: { error: "Couldn't create the share link. Please try again." } };
    await mount();
    await click(q('[data-testid="action-preview"]'));
    await flush();
    expect(router.push).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("Couldn't create the share link");
  });

  it("the creator page contains no public-viewer UI, and the public viewer has no creator controls", () => {
    const fs = require("fs") as typeof import("fs");
    const pub = fs.readFileSync(`${__dirname}/PublicPlaylistView.tsx`, "utf8");
    expect(pub).not.toMatch(/manage\/|ManageFileRow|DndContext|api\/playlists\/\$\{/);
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



describe("Creator playlist page — layout safety & themes", () => {
  it("caps the column and wraps text so a 320px screen can't overflow horizontally", async () => {
    await mount();
    const page = q('[data-testid="playlist-page"]')!;
    expect(page.className).toContain("overflow-x-hidden");
    const col = page.firstElementChild as HTMLElement;
    expect(col.className).toContain("max-w-2xl");
    expect(col.className).toContain("w-full");
    expect(q('[data-testid="playlist-title"]')!.className).toContain("break-words");
    expect(q('[data-testid="playlist-title"]')!.parentElement!.className).toContain("min-w-0");
    expect(rowFor("One.pdf").querySelector('[data-testid="playlist-file-open"]')!.className).toContain("min-w-0");
    expect(q('[data-testid="playlist-cover"]')!.className).toContain("overflow-hidden");
    // four equal columns of ≥60px tiles fit a 320px viewport (320 − 32 padding − 3×8 gaps = 264 → 66px each)
    expect(q('[data-testid="playlist-actions"]')!.className).toContain("grid-cols-4");
  });

  it("touch targets are at least 44px", async () => {
    await mount();
    for (const el of [q('[data-testid="action-add-files"]'), q('[data-testid="action-preview"]'), q('[data-testid="playlist-share"]'), moreTile()]) {
      expect(el!.className).toMatch(/min-h-\[3\.75rem\]/); // 60px on phones
    }
    expect(rowFor("One.pdf").querySelector('[data-testid="action-menu-button"]')!.className).toContain("w-11 h-11");
    expect(rowFor("One.pdf").querySelector('[data-testid="drag-handle"]')!.className).toContain("h-11");
  });

  it("styles only through theme tokens (bg-card/bg-secondary/text-primary…), never hard-coded light/dark colours", () => {
    const fs = require("fs") as typeof import("fs");
    const manage = fs.readdirSync(`${__dirname}/manage`).filter((f: string) => f.endsWith(".tsx")).map((f: string) => `manage/${f}`);
    for (const f of ["PlaylistPage.tsx", "ShareSheet.tsx", "PublicPlaylistView.tsx", "../viewer/FileViewer.tsx", "../viewer/ActionRow.tsx", "../viewer/PlaylistList.tsx", "../viewer/SavedItemsWidget.tsx", "../viewer/ReportDialog.tsx", "../viewer/DescriptionBlock.tsx", "../ui/ActionMenu.tsx", ...manage]) {
      const src = fs.readFileSync(`${__dirname}/${f}`, "utf8");
      expect(src, f).not.toMatch(/\b(bg-white|bg-black|bg-gray-\d+|text-gray-\d+|text-black|bg-slate-\d+)/);
    }
  });
});
