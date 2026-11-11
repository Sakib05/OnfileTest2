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

import PlaylistManager, { type PlaylistSummary } from "./PlaylistManager";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type F = { id: number; title: string; fileType: string; mimeType: null; fileSize: number; isPublished: boolean; thumbnailUrl: string | null; position: number };
const mk = (id: number, title: string, thumb: string | null = null): F => ({ id, title, fileType: "document", mimeType: null, fileSize: 1000, isPublished: true, thumbnailUrl: thumb, position: id });

const playlist: PlaylistSummary = { id: 1, title: "Accounting", description: "Intro course", totalFiles: 3, thumbnailUrl: "https://cdn/a.webp" };
const other: PlaylistSummary = { id: 2, title: "BBA Materials", description: null, totalFiles: 1, thumbnailUrl: null };

let container: HTMLDivElement;
let root: Root;
let members: F[];
let calls: { url: string; method: string; body: unknown }[];
let failNext: { match: RegExp; status: number; body?: unknown } | null;
const onPlaylistChanged = vi.fn();
const onChanged = vi.fn();
const onDeleted = vi.fn();
const onClose = vi.fn();

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });

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
    const snapshot = () => ({ files: members, playlist: { ...playlist, totalFiles: members.length, thumbnailUrl: members[0]?.thumbnailUrl ?? null } });
    if (method === "GET" && url === "/api/playlists/1/files") return json({ files: members });
    if (method === "PUT" && url === "/api/playlists/1/files") {
      members = (body.fileIds as number[]).map((id) => members.find((m) => m.id === id)!);
      return json(snapshot());
    }
    if (method === "DELETE" && /^\/api\/playlists\/1\/files\/\d+$/.test(url)) {
      const id = Number(url.split("/").pop());
      members = members.filter((m) => m.id !== id);
      return json({ success: true, ...snapshot() });
    }
    if (method === "PATCH" && url === "/api/playlists/1") return json({ playlist: { ...playlist, title: body.title, description: body.description } });
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
const rowTitles = () => Array.from(document.body.querySelectorAll('[data-testid="playlist-file-row"] p.font-semibold')).map((p) => p.textContent);
function typeInto(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

async function mount(initialView: "list" | "edit" = "list") {
  await act(async () =>
    root.render(
      <ToastProvider>
        <PlaylistManager playlist={playlist} allPlaylists={[playlist, other]} initialView={initialView} onClose={onClose} onPlaylistChanged={onPlaylistChanged} onChanged={onChanged} onDeleted={onDeleted} />
      </ToastProvider>
    )
  );
  await flush();
}

beforeEach(() => {
  members = [mk(1, "One.pdf", "https://cdn/a.webp"), mk(2, "Two.pdf"), mk(3, "Three.pdf")];
  calls = [];
  failNext = null;
  [onPlaylistChanged, onChanged, onDeleted, onClose].forEach((m) => m.mockReset());
  installFetch();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("PlaylistManager", () => {
  it("lists the files in order with a drag handle per row and marks the first as the cover", async () => {
    await mount();
    expect(rowTitles()).toEqual(["One.pdf", "Two.pdf", "Three.pdf"]);
    expect(document.body.querySelectorAll('[data-testid="drag-handle"]')).toHaveLength(3);
    const first = document.body.querySelector('[data-testid="playlist-file-row"]')!;
    expect(first.textContent).toContain("Cover");
  });

  it("uses mouse + touch + keyboard sensors (mobile drag works) and keeps removal off the drag handle", async () => {
    await mount();
    expect(dnd.sensors).toHaveLength(3);
    const handle = document.body.querySelector('[data-testid="drag-handle"]') as HTMLElement;
    expect(handle.style.touchAction).toBe("none"); // a finger can drag it without scrolling the page
    expect(handle.textContent).toBe(""); // icon only — nothing in the handle can remove a file
    expect(handle.getAttribute("aria-label")).toMatch(/Reorder One\.pdf/);
  });

  it("drag-end shows the new order immediately, PUTs the full id list and applies the refreshed cover", async () => {
    await mount();
    await act(async () => dnd.onDragEnd!({ active: { id: 3 }, over: { id: 1 } }));
    expect(rowTitles()).toEqual(["Three.pdf", "One.pdf", "Two.pdf"]);
    await flush();
    const put = calls.find((c) => c.method === "PUT")!;
    expect(put.url).toBe("/api/playlists/1/files");
    expect(put.body).toEqual({ fileIds: [3, 1, 2] });
    expect(onPlaylistChanged).toHaveBeenCalledWith(expect.objectContaining({ thumbnailUrl: null })); // new first file has no thumbnail → default
    expect(rowTitles()).toEqual(["Three.pdf", "One.pdf", "Two.pdf"]);
  });

  it("rolls the order back and shows an error when saving fails", async () => {
    await mount();
    failNext = { match: /^PUT /, status: 500, body: { error: "Couldn't save the new order. Please try again." } };
    await act(async () => dnd.onDragEnd!({ active: { id: 2 }, over: { id: 3 } }));
    await flush();
    expect(rowTitles()).toEqual(["One.pdf", "Two.pdf", "Three.pdf"]);
    expect(document.body.textContent).toContain("Couldn't save the new order");
  });

  it("on a 409 (playlist changed elsewhere) it reloads the real order", async () => {
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

  it("removes a file from the playlist via the DELETE membership endpoint only (never the file endpoint)", async () => {
    await mount();
    await act(async () => (document.body.querySelector('[aria-label="Actions for Two.pdf"]') as HTMLButtonElement).click());
    await act(async () => byText("Remove from playlist")!.click());
    await flush();
    expect(calls.filter((c) => c.method === "DELETE").map((c) => c.url)).toEqual(["/api/playlists/1/files/2"]);
    expect(calls.some((c) => /^\/api\/files\//.test(c.url))).toBe(false);
    expect(rowTitles()).toEqual(["One.pdf", "Three.pdf"]);
    expect(document.body.textContent).toContain("still in your Library");
  });

  it("clearly distinguishes 'Add to another playlist' from 'Move to another playlist'", async () => {
    await mount();
    await act(async () => (document.body.querySelector('[aria-label="Actions for One.pdf"]') as HTMLButtonElement).click());
    expect(byText("Add to another playlist")).toBeTruthy();
    expect(byText("Move to another playlist")).toBeTruthy();

    // Add: stays in the source list
    await act(async () => byText("Add to another playlist")!.click());
    expect(document.body.textContent).toContain("the file stays in this playlist");
    await act(async () => (document.body.querySelector('input[type="radio"]') as HTMLInputElement).click());
    await act(async () => byText("Add here")!.click());
    await flush();
    let t = calls.find((c) => /\/transfer$/.test(c.url))!;
    expect(t.url).toBe("/api/playlists/1/files/1/transfer");
    expect(t.body).toEqual({ toPlaylistId: 2, mode: "add" });
    expect(rowTitles()).toContain("One.pdf");
    expect(onChanged).toHaveBeenCalled();

    // Move: leaves the source list
    calls = [];
    await act(async () => (document.body.querySelector('[aria-label="Actions for One.pdf"]') as HTMLButtonElement).click());
    await act(async () => byText("Move to another playlist")!.click());
    expect(document.body.textContent).toContain("the file leaves this playlist");
    await act(async () => (document.body.querySelector('input[type="radio"]') as HTMLInputElement).click());
    await act(async () => byText("Move here")!.click());
    await flush();
    t = calls.find((c) => /\/transfer$/.test(c.url))!;
    expect(t.body).toEqual({ toPlaylistId: 2, mode: "move" });
    expect(rowTitles()).not.toContain("One.pdf");
  });

  it("edits the name and description, saves, and shows the updated info immediately", async () => {
    await mount();
    await act(async () => byText("Edit")!.click());
    const title = document.getElementById("pl-edit-title") as HTMLInputElement;
    const desc = document.getElementById("pl-edit-desc") as HTMLTextAreaElement;
    expect(title.value).toBe("Accounting");
    expect((byText("Save changes") as HTMLButtonElement).disabled).toBe(true); // nothing changed yet
    await act(async () => typeInto(title, "Accounting 101"));
    await act(async () => typeInto(desc, "Updated text"));
    await act(async () => byText("Save changes")!.click());
    await flush();
    const patch = calls.find((c) => c.method === "PATCH")!;
    expect(patch.body).toEqual({ title: "Accounting 101", description: "Updated text" });
    expect(onPlaylistChanged).toHaveBeenCalledWith(expect.objectContaining({ title: "Accounting 101", description: "Updated text" }));
  });

  it("validates an empty name without calling the API", async () => {
    await mount("edit");
    await act(async () => typeInto(document.getElementById("pl-edit-title") as HTMLInputElement, "   "));
    await act(async () => byText("Save changes")!.click());
    expect(document.body.textContent).toContain("Playlist name is required.");
    expect(calls.some((c) => c.method === "PATCH")).toBe(false);
  });

  it("adds several library files at once and disables the ones already in the playlist", async () => {
    await mount();
    await act(async () => byText("Add files from Library")!.click());
    await flush();
    const boxes = Array.from(document.body.querySelectorAll('[data-testid="library-picker"] input[type="checkbox"]')) as HTMLInputElement[];
    expect(boxes).toHaveLength(5);
    expect(boxes.slice(0, 3).every((b) => b.disabled)).toBe(true); // 1-3 are already members
    expect(document.body.textContent).toContain("In playlist");
    expect((byText("Select files to add") as HTMLButtonElement).disabled).toBe(true);
    await act(async () => boxes[3].click());
    await act(async () => boxes[4].click());
    await act(async () => byText("Add 2 files")!.click());
    await flush();
    const post = calls.find((c) => c.method === "POST" && c.url === "/api/playlists/1/files")!;
    expect(post.body).toEqual({ fileIds: [4, 5] });
    expect(rowTitles()).toEqual(["One.pdf", "Two.pdf", "Three.pdf", "New 4", "New 5"]);
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

  it("asks for confirmation before deleting and explains that the files are kept", async () => {
    await mount();
    await act(async () => byText("Delete playlist")!.click());
    expect(document.body.textContent).toContain("will NOT be deleted");
    expect(calls.some((c) => c.method === "DELETE")).toBe(false); // nothing happens until confirmed
    const confirm = buttons().filter((b) => b.textContent?.trim() === "Delete").pop()!;
    await act(async () => confirm.click());
    await flush();
    expect(calls.filter((c) => c.method === "DELETE").map((c) => c.url)).toEqual(["/api/playlists/1"]);
    expect(onDeleted).toHaveBeenCalled();
  });

  it("shows an empty-playlist message", async () => {
    members = [];
    await mount();
    expect(document.body.textContent).toContain("This playlist is empty");
  });
});
