// @vitest-environment jsdom
/**
 * My Library → file ⋮ menu: Edit Details · Change Thumbnail · Manage Playlists · Share · Copy Link · QR · File Details · Delete.
 * Runs the real FilesTab + dialogs against a small stateful fake of the existing API (no network, no database).
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/components/ui/Toast";
import { fileShareUrl } from "@/lib/fileShare";

const router = { push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn(), refresh: vi.fn(), forward: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router }));

import FilesTab from "./FilesTab";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type FileRow = Record<string, unknown> & { id: number; title: string };
type Call = { method: string; url: string; body: unknown };

let container: HTMLDivElement;
let root: Root;
let files: FileRow[];
let playlists: { id: number; title: string; isPublished: boolean; hasPassword: boolean }[];
let members: Record<number, Set<number>>;
let calls: Call[];
let failNext: { match: RegExp; method?: string; status: number; error?: string } | null;
let clipboard: string[];

const mkFile = (id: number, title: string, extra: Record<string, unknown> = {}): FileRow => ({
  id, title, fileType: "document", description: `About ${title}`, fileSize: 2048, createdAt: new Date(2025, 0, 10).toISOString(),
  isPublished: true, smartLinkSlug: `slug-${id}`, views: 7, downloads: 3, earnings: "0.5", hasPassword: false, starsPrice: 0,
  thumbnailUrl: null, thumbnailWidth: null, thumbnailHeight: null, ...extra,
});

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function installFetch() {
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, url, body });
    if (failNext && failNext.match.test(url) && (!failNext.method || failNext.method === method)) {
      const f = failNext;
      failNext = null;
      return json({ error: f.error ?? "boom" }, f.status);
    }
    let m: RegExpMatchArray | null;
    if (method === "GET" && url === "/api/files") return json({ files });
    if (method === "GET" && url === "/api/playlists") return json({ playlists: playlists.map((p) => ({ ...p, totalFiles: members[p.id]?.size ?? 0, createdAt: new Date(2025, 0, 1).toISOString() })) });
    if ((m = url.match(/^\/api\/files\/(\d+)\/playlists$/)) && method === "GET") {
      const id = Number(m[1]);
      return json({ playlists: playlists.map((p) => ({ id: p.id, title: p.title, isPublished: p.isPublished, hasPassword: p.hasPassword, fileCount: members[p.id]?.size ?? 0, isMember: !!members[p.id]?.has(id) })) });
    }
    if ((m = url.match(/^\/api\/files\/(\d+)$/))) {
      const id = Number(m[1]);
      const f = files.find((x) => x.id === id);
      if (!f) return json({ error: "Not found" }, 404);
      if (method === "PATCH") {
        Object.assign(f, body, { updatedAt: new Date(2025, 1, 1).toISOString() });
        return json({ file: f });
      }
      if (method === "DELETE") {
        files = files.filter((x) => x.id !== id);
        for (const set of Object.values(members)) set.delete(id);
        return json({ success: true });
      }
    }
    if ((m = url.match(/^\/api\/playlists\/(\d+)\/files$/)) && method === "POST") {
      const pid = Number(m[1]);
      const set = (members[pid] ??= new Set());
      const added: number[] = [];
      const already: number[] = [];
      for (const id of body.fileIds as number[]) (set.has(id) ? already : added).push(id), set.add(id);
      return json({ added, alreadyMembers: already });
    }
    if ((m = url.match(/^\/api\/playlists\/(\d+)\/files\/(\d+)$/)) && method === "DELETE") {
      members[Number(m[1])]?.delete(Number(m[2]));
      return json({ success: true });
    }
    return json({ error: `unexpected ${method} ${url}` }, 500);
  }));
}

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const click = (el: Element | null | undefined) => act(async () => { (el as HTMLElement).dispatchEvent(new MouseEvent("click", { bubbles: true })); });
const q = (sel: string) => document.body.querySelector(sel) as HTMLElement | null;
const qa = (sel: string) => Array.from(document.body.querySelectorAll(sel)) as HTMLElement[];
const byLabel = (l: string) => q(`[aria-label="${l}"]`);
const menuItem = (label: string) => qa('[role="menuitem"]').find((b) => b.textContent?.startsWith(label))!;
const buttonByText = (t: string) => qa("button").find((b) => b.textContent?.trim() === t || b.textContent?.includes(t))!;

async function typeInto(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function mount() {
  installFetch();
  await act(async () => root.render(<ToastProvider><FilesTab /></ToastProvider>));
  await flush();
}
async function openMenu(title: string, item: string) {
  await click(byLabel(`More actions for ${title}`));
  await click(menuItem(item));
  await flush();
}
const writes = (method: string, re: RegExp) => calls.filter((c) => c.method === method && re.test(c.url));
const toastText = () => document.body.textContent ?? "";

beforeEach(() => {
  Object.values(router).forEach((r) => r.mockReset());
  files = [mkFile(1, "Report.pdf"), mkFile(2, "Secret draft", { isPublished: false, smartLinkSlug: "slug-2", hasPassword: true })];
  playlists = [
    { id: 10, title: "Course", isPublished: true, hasPassword: false },
    { id: 11, title: "Hidden list", isPublished: false, hasPassword: false },
  ];
  members = { 10: new Set([1]), 11: new Set() };
  calls = [];
  failNext = null;
  clipboard = [];
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn(async (t: string) => { clipboard.push(t); }) } });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("Edit Details", () => {
  it("validates, then PATCHes ONLY title + description (never the published state) and updates the card", async () => {
    await mount();
    await openMenu("Report.pdf", "Edit Details");
    const title = q("#edit-file-title") as HTMLInputElement;
    const desc = q("#edit-file-description") as HTMLTextAreaElement;
    expect(title.value).toBe("Report.pdf");
    expect(desc.value).toBe("About Report.pdf");
    expect((buttonByText("Save changes") as HTMLButtonElement).disabled).toBe(true); // nothing changed yet

    await typeInto(title, "   ");
    await typeInto(desc, "x");
    await act(async () => (q('[data-testid="edit-details-form"]') as HTMLFormElement).dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(q("#edit-file-title-err")?.textContent).toBe("Title is required.");
    expect(writes("PATCH", /api\/files/)).toHaveLength(0);

    await typeInto(title, "Annual Report");
    await typeInto(desc, "Fresh description");
    await click(buttonByText("Save changes"));
    await flush();
    const patches = writes("PATCH", /^\/api\/files\/1$/);
    expect(patches).toHaveLength(1);
    expect(patches[0].body).toEqual({ title: "Annual Report", description: "Fresh description" });
    expect(Object.keys(patches[0].body as object)).not.toContain("isPublished");
    expect(q('[role="dialog"]')).toBeNull(); // closed
    expect(toastText()).toContain("Details saved");
    expect(byLabel("More actions for Annual Report")).not.toBeNull(); // card shows the new title
    expect(files[0].isPublished).toBe(true);
  });

  it("rejects an over-long description before any request, and Cancel closes without saving", async () => {
    await mount();
    await openMenu("Report.pdf", "Edit Details");
    await typeInto(q("#edit-file-description") as HTMLTextAreaElement, "a".repeat(1001));
    expect(q("#edit-file-description-err")?.textContent).toContain("1000 characters");
    await click(buttonByText("Cancel"));
    expect(q('[role="dialog"]')).toBeNull();
    expect(writes("PATCH", /api\/files/)).toHaveLength(0);
  });

  it("shows a server error and keeps the dialog (and the unsaved text) open", async () => {
    await mount();
    await openMenu("Report.pdf", "Edit Details");
    await typeInto(q("#edit-file-title") as HTMLInputElement, "New");
    failNext = { match: /^\/api\/files\/1$/, method: "PATCH", status: 500, error: "Could not save" };
    await click(buttonByText("Save changes"));
    await flush();
    expect(q('[data-testid="edit-details-error"]')?.textContent).toBe("Could not save");
    expect((q("#edit-file-title") as HTMLInputElement).value).toBe("New");
    expect(byLabel("More actions for Report.pdf")).not.toBeNull(); // title unchanged in the library
  });
});

describe("Change Thumbnail", () => {
  class FakeXHR {
    static instances: FakeXHR[] = [];
    upload: { onprogress?: unknown; onload?: () => void } = {};
    responseType = "";
    timeout = 0;
    status = 0;
    response: unknown = null;
    onload?: () => void;
    onerror?: () => void;
    ontimeout?: () => void;
    method = "";
    url = "";
    sent: FormData | null = null;
    open(method: string, url: string) { this.method = method; this.url = url; FakeXHR.instances.push(this); }
    send(form: FormData) {
      this.sent = form;
      this.status = 201;
      // the real endpoint persists the thumbnail, so the Library's follow-up refetch returns it
      const row = files.find((f) => f.id === Number(this.url.match(/files\/(\d+)\//)![1]))!;
      Object.assign(row, { thumbnailUrl: "https://cdn.example/new-thumb.webp", thumbnailWidth: 640, thumbnailHeight: 360 });
      this.response = { thumbnail: { url: "https://cdn.example/new-thumb.webp", width: 640, height: 360 } };
      setTimeout(() => { this.upload.onload?.(); this.onload?.(); }, 0);
    }
  }

  it("works for a file with no thumbnail: preview, Replace → POST /api/files/:id/thumbnail → the card shows the new image", async () => {
    FakeXHR.instances = [];
    vi.stubGlobal("XMLHttpRequest", FakeXHR);
    (URL as unknown as { createObjectURL: () => string }).createObjectURL = () => "blob:preview";
    (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = () => {};
    await mount();
    expect(container.querySelector("img")).toBeNull();
    await openMenu("Report.pdf", "Change Thumbnail");
    expect(q('[role="dialog"]')?.textContent).toContain("Change Thumbnail");
    expect(buttonByText("Choose an image")).toBeTruthy();

    const input = q('input[type="file"]') as HTMLInputElement;
    const png = new File([new Uint8Array(100)], "cover.png", { type: "image/png" });
    Object.defineProperty(input, "files", { configurable: true, value: [png] });
    await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
    expect(q('img[alt="Selected thumbnail preview"]')).not.toBeNull(); // preview before saving

    await click(buttonByText("Upload thumbnail"));
    await flush();
    expect(FakeXHR.instances).toHaveLength(1);
    expect(FakeXHR.instances[0].method).toBe("POST");
    expect(FakeXHR.instances[0].url).toBe("/api/files/1/thumbnail");
    expect(toastText()).toContain("Thumbnail saved");
    expect(Array.from(container.querySelectorAll("img")).some((i) => i.getAttribute("src") === "https://cdn.example/new-thumb.webp")).toBe(true);
    await click(buttonByText("Done"));
    expect(q('[role="dialog"]')).toBeNull();
  });

  it("rejects a non-image / oversized pick client-side and sends nothing", async () => {
    FakeXHR.instances = [];
    vi.stubGlobal("XMLHttpRequest", FakeXHR);
    await mount();
    await openMenu("Report.pdf", "Change Thumbnail");
    const input = q('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(input, "files", { configurable: true, value: [new File(["x"], "a.gif", { type: "image/gif" })] });
    await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
    expect(q('[role="alert"]')?.textContent).toContain("JPEG, PNG or WebP");
    expect(FakeXHR.instances).toHaveLength(0);
  });
});

describe("Manage Playlists", () => {
  it("shows every playlist with its membership, adds and removes through the existing endpoints, never twice", async () => {
    await mount();
    await openMenu("Report.pdf", "Manage Playlists");
    const rows = qa('[data-testid="playlist-toggle"]');
    expect(rows.map((r) => r.getAttribute("data-member"))).toEqual(["true", "false"]);
    expect(rows[1].textContent).toContain("Private"); // private playlist is labelled
    expect(q('[data-testid="playlist-membership-summary"]')?.textContent).toBe("In 1 playlist");

    await click(rows[1]); // add to "Hidden list"
    await flush();
    const posts = writes("POST", /^\/api\/playlists\/11\/files$/);
    expect(posts).toHaveLength(1);
    expect(posts[0].body).toEqual({ fileIds: [1] });
    expect(members[11].has(1)).toBe(true);
    expect(qa('[data-testid="playlist-toggle"]')[1].getAttribute("data-member")).toBe("true");
    expect(q('[data-testid="playlist-membership-summary"]')?.textContent).toBe("In 2 playlists");

    await click(qa('[data-testid="playlist-toggle"]')[0]); // remove from "Course"
    await flush();
    expect(writes("DELETE", /^\/api\/playlists\/10\/files\/1$/)).toHaveLength(1);
    expect(members[10].has(1)).toBe(false);
    expect(qa('[data-testid="playlist-toggle"]')[0].getAttribute("data-member")).toBe("false");
    // the file itself is untouched
    expect(files.map((f) => f.id)).toEqual([1, 2]);
    expect(writes("DELETE", /^\/api\/files\//)).toHaveLength(0);
  });

  it("a duplicate add (server says already a member) is reported, not counted twice", async () => {
    await mount();
    await openMenu("Report.pdf", "Manage Playlists");
    members[11].add(1); // changed elsewhere meanwhile
    await click(qa('[data-testid="playlist-toggle"]')[1]);
    await flush();
    expect(toastText()).toContain("Already in “Hidden list”");
    expect(members[11].size).toBe(1);
    expect(qa('[data-testid="playlist-toggle"]')[1].textContent).toContain("0 files"); // count not incremented
  });

  it("reports a failed change and leaves the row as it was; shows an empty state without playlists", async () => {
    await mount();
    await openMenu("Report.pdf", "Manage Playlists");
    failNext = { match: /playlists\/11\/files$/, method: "POST", status: 500, error: "Couldn't add the files." };
    await click(qa('[data-testid="playlist-toggle"]')[1]);
    await flush();
    expect(toastText()).toContain("Couldn't add the files.");
    expect(qa('[data-testid="playlist-toggle"]')[1].getAttribute("data-member")).toBe("false");
    await click(buttonByText("Done"));

    playlists = [];
    await openMenu("Report.pdf", "Manage Playlists");
    expect(q('[data-testid="manage-playlists-empty"]')).not.toBeNull();
  });
});

describe("Share · Copy Link · QR (public smart link only)", () => {
  const url = () => `${window.location.origin}/f/slug-1`;

  it("Copy Link copies exactly <origin>/f/<slug> and confirms", async () => {
    await mount();
    await openMenu("Report.pdf", "Copy Link");
    expect(clipboard).toEqual([url()]);
    expect(clipboard[0]).not.toMatch(/t\.me|telegram|password/i);
    expect(toastText()).toContain("Link copied to clipboard");
  });

  it("Copy Link reports a clipboard failure instead of claiming success", async () => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn(async () => { throw new Error("denied"); }) } });
    document.execCommand = vi.fn(() => false) as never;
    await mount();
    await openMenu("Report.pdf", "Copy Link");
    expect(toastText()).toContain("Couldn't copy the link");
  });

  it("Share shows the same URL (read-only), Copy link, and Telegram's native share dialog URL", async () => {
    const open = vi.fn();
    vi.stubGlobal("open", open);
    await mount();
    await openMenu("Report.pdf", "Share");
    expect((q('[data-testid="share-file-url"]') as HTMLInputElement).value).toBe(url());
    await click(q('[data-testid="share-file-copy"]'));
    expect(clipboard).toEqual([url()]);
    await click(q('[data-testid="share-file-telegram"]'));
    expect(open).toHaveBeenCalledTimes(1);
    const target = String(open.mock.calls[0][0]);
    expect(target.startsWith("https://t.me/share/url?")).toBe(true);
    expect(new URL(target).searchParams.get("url")).toBe(url());
  });

  it("QR dialog shows the title, encodes exactly the share URL, offers Download + Copy link", async () => {
    await mount();
    await openMenu("Report.pdf", "Generate QR Code");
    expect(q('[data-testid="qr-title"]')?.textContent).toBe("Report.pdf");
    expect(q('[data-testid="qr-svg"]')?.getAttribute("data-qr-url")).toBe(url());
    expect(q('[data-testid="qr-url"]')?.textContent).toBe(url());
    expect(q('[data-testid="qr-svg"] path')?.getAttribute("d")?.length).toBeGreaterThan(200);
    expect(q('[data-testid="qr-download"]')).not.toBeNull();
    await click(q('[data-testid="qr-copy"]'));
    expect(clipboard).toEqual([url()]);
  });

  it("a PRIVATE (unpublished) file gets no link anywhere: dimmed menu items explain why, Share/QR show a notice, nothing is copied", async () => {
    await mount();
    await click(byLabel("More actions for Secret draft"));
    for (const label of ["Share", "Copy Link", "Generate QR Code"]) {
      expect(menuItem(label).getAttribute("data-unavailable")).toBe("true");
      expect(menuItem(label).textContent).toContain("Private");
    }
    expect(menuItem("Edit Details").getAttribute("data-unavailable")).toBeNull();

    await click(menuItem("Copy Link"));
    expect(clipboard).toEqual([]);
    expect(toastText()).toContain("private");

    await openMenu("Secret draft", "Share");
    expect(q('[data-testid="share-file-blocked"]')).not.toBeNull();
    expect(q('[data-testid="share-file-url"]')).toBeNull();
    await click(q('[aria-label="Close"]'));

    await openMenu("Secret draft", "Generate QR Code");
    expect(q('[data-testid="qr-blocked"]')).not.toBeNull();
    expect(q('[data-testid="qr-svg"]')).toBeNull();
  });

  it("fileShareUrl never builds a link for unpublished or slug-less files", () => {
    expect(fileShareUrl("https://x.test", { isPublished: false, smartLinkSlug: "a" })).toBeNull();
    expect(fileShareUrl("https://x.test", { isPublished: true, smartLinkSlug: "" })).toBeNull();
    expect(fileShareUrl("https://x.test/", { isPublished: true, smartLinkSlug: "a b" })).toBe("https://x.test/f/a%20b");
  });
});

describe("File Details", () => {
  it("shows real stored values and playlist membership — no ids, Telegram links or password", async () => {
    await mount();
    await openMenu("Report.pdf", "File Details");
    const d = q('[data-testid="file-details"]')!;
    expect(q('[data-testid="details-title"]')?.textContent).toBe("Report.pdf");
    expect(q('[data-testid="details-category"]')?.textContent).toBe("Document");
    expect(q('[data-testid="details-size"]')?.textContent).toBe("2.0 KB");
    expect(q('[data-testid="details-status"]')?.textContent).toBe("Published");
    expect(q('[data-testid="details-access"]')?.textContent).toBe("Free, no password");
    expect(q('[data-testid="details-thumbnail"]')?.textContent).toBe("None (default artwork)");
    expect(q('[data-testid="details-uploaded"]')?.textContent).toMatch(/2025/);
    expect(q('[data-testid="details-playlists"]')?.textContent).toBe("Course");
    expect(d.textContent).toContain("About Report.pdf");
    expect(d.textContent).not.toMatch(/undefined|null|NaN|t\.me|slug-1/);
  });

  it("labels a private, password-protected file with a custom thumbnail and no playlist honestly", async () => {
    files[1] = { ...files[1], thumbnailUrl: "https://cdn.example/t.webp", thumbnailWidth: 1280, thumbnailHeight: 720, fileSize: null };
    await mount();
    await openMenu("Secret draft", "File Details");
    expect(q('[data-testid="details-status"]')?.textContent).toBe("Private (not published)");
    expect(q('[data-testid="details-access"]')?.textContent).toBe("Password protected");
    expect(q('[data-testid="details-thumbnail"]')?.textContent).toBe("Custom · 1280×720");
    expect(q('[data-testid="details-size"]')?.textContent).toBe("Not recorded");
    expect(q('[data-testid="details-playlists"]')?.textContent).toBe("Not in any playlist");
  });

  it("tapping a card opens the same details dialog", async () => {
    await mount();
    await click(byLabel("Open details for Report.pdf"));
    expect(q('[data-testid="file-details"]')).not.toBeNull();
  });
});

describe("Delete File", () => {
  it("asks first, names the playlists that lose it and says Telegram is untouched; Cancel deletes nothing", async () => {
    await mount();
    await openMenu("Report.pdf", "Delete File");
    const dlg = q('[data-testid="delete-file-dialog"]')!;
    expect(q('[data-testid="delete-file-title"]')?.textContent).toContain("Report.pdf");
    expect(q('[data-testid="delete-file-playlists"]')?.textContent).toContain("“Course”");
    expect(dlg.textContent).toContain("The original file in your Telegram channel is NOT deleted");
    await click(buttonByText("Cancel"));
    expect(q('[data-testid="delete-file-dialog"]')).toBeNull();
    expect(writes("DELETE", /.*/)).toHaveLength(0);
    expect(files).toHaveLength(2);
  });

  it("confirming deletes only that file through DELETE /api/files/:id, updates the Library and never calls Telegram", async () => {
    await mount();
    await openMenu("Report.pdf", "Delete File");
    await click(q('[data-testid="delete-file-confirm"]'));
    await flush();
    const deletes = writes("DELETE", /.*/);
    expect(deletes.map((d) => d.url)).toEqual(["/api/files/1"]);
    expect(files.map((f) => f.id)).toEqual([2]); // unrelated file kept
    expect(byLabel("More actions for Report.pdf")).toBeNull();
    expect(byLabel("More actions for Secret draft")).not.toBeNull();
    expect(toastText()).toContain("File deleted from your Library");
    expect(q('[role="dialog"]')).toBeNull();
    expect(calls.some((c) => /telegram|t\.me|api\.telegram/i.test(c.url))).toBe(false);
  });

  it("a failed delete keeps the file and the dialog and explains", async () => {
    await mount();
    await openMenu("Report.pdf", "Delete File");
    failNext = { match: /^\/api\/files\/1$/, method: "DELETE", status: 500, error: "Internal server error" };
    await click(q('[data-testid="delete-file-confirm"]'));
    await flush();
    expect(q('[data-testid="delete-file-error"]')?.textContent).toContain("Internal server error");
    expect(byLabel("More actions for Report.pdf")).not.toBeNull();
    expect(files).toHaveLength(2);
  });
});

describe("Menu behaviour", () => {
  it("is a scrollable, viewport-bounded menu with 44px+ items, closes on Escape and supports arrow keys", async () => {
    await mount();
    await click(byLabel("More actions for Report.pdf"));
    const menu = q('[role="menu"]')!;
    expect(menu.className).toContain("overflow-y-auto");
    expect(menu.style.maxHeight).not.toBe("");
    const items = qa('[role="menuitem"]');
    expect(items).toHaveLength(8);
    items[0].focus();
    await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
    expect(document.activeElement).toBe(items[1]);
    await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(q('[role="menu"]')).toBeNull();
  });

  it("playlist menus are unchanged", async () => {
    await mount();
    await click(byLabel("More actions for playlist Course"));
    expect(qa('[role="menuitem"]').map((m) => m.textContent)).toEqual(["View posts", "Edit", "Delete"]);
  });
});
