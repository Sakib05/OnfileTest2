import { describe, expect, it } from "vitest";
import { MAX_SAVED_ITEMS, normalizeEntry, parseSaved, removeSaved, savedHref, upsertSaved, withLastFile, type SavedItem } from "./savedItems";

const PL = "AbCdEfGhIjKlMnOp";

describe("parseSaved — defensive reading", () => {
  it("returns [] for missing, empty, malformed or wrongly shaped storage", () => {
    for (const raw of [null, undefined, "", "{oops", "42", "{}", '"x"', "null"]) expect(parseSaved(raw as string)).toEqual([]);
  });

  it("drops invalid entries, bad ids and duplicates but keeps good ones (newest first)", () => {
    const raw = JSON.stringify([
      { type: "file", id: "ok-1", title: "A", savedAt: 1 },
      { type: "file", id: "../../etc", title: "evil", savedAt: 5 },
      { type: "video", id: "x", title: "unknown type", savedAt: 5 },
      { type: "playlist", id: PL, title: "P", savedAt: 3, path: "javascript:alert(1)" },
      { type: "file", id: "ok-1", title: "dup", savedAt: 9 },
      null,
      "str",
    ]);
    const out = parseSaved(raw);
    expect(out.map((i) => `${i.type}:${i.id}`)).toEqual([`playlist:${PL}`, "file:ok-1"]);
    expect(out[0].path).toBe(`/p/${PL}`); // a stored path is never trusted
  });

  it("keeps only https thumbnails and sanitises titles / lastFile", () => {
    const e = normalizeEntry({ type: "playlist", id: PL, title: "  Hi\n there  ", thumbnailUrl: "javascript:x", lastFile: "bad slug!", savedAt: 1 })!;
    expect(e.title).toBe("Hi there");
    expect(e.thumbnailUrl).toBeNull();
    expect(e.lastFile).toBeNull();
    expect(normalizeEntry({ type: "file", id: "a", thumbnailUrl: "https://cdn.x/y.webp", lastFile: "b" })!.thumbnailUrl).toBe("https://cdn.x/y.webp");
    expect(normalizeEntry({ type: "file", id: "a", lastFile: "b" })!.lastFile).toBeNull(); // files have no lastFile
  });

  it("caps the list", () => {
    const raw = JSON.stringify(Array.from({ length: MAX_SAVED_ITEMS + 20 }, (_, i) => ({ type: "file", id: `f${i}`, title: "t", savedAt: i + 1 })));
    expect(parseSaved(raw)).toHaveLength(MAX_SAVED_ITEMS);
  });
});

describe("upsert / remove / withLastFile", () => {
  it("saving the same playlist twice never creates a second entry and keeps the original time", () => {
    let items: SavedItem[] = [];
    items = upsertSaved(items, { type: "playlist", id: PL, title: "P", lastFile: "a" }, 100);
    items = upsertSaved(items, { type: "playlist", id: PL, title: "P renamed", lastFile: "b" }, 200);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ title: "P renamed", lastFile: "b", savedAt: 100 });
  });

  it("a playlist and a file with the same id are different entries; invalid input is ignored", () => {
    let items: SavedItem[] = [];
    items = upsertSaved(items, { type: "playlist", id: "same-id", title: "P" }, 1);
    items = upsertSaved(items, { type: "file", id: "same-id", title: "F" }, 2);
    expect(items).toHaveLength(2);
    expect(upsertSaved(items, { type: "file", id: "bad id", title: "x" })).toBe(items);
  });

  it("removeSaved removes exactly one entry", () => {
    const items = upsertSaved(upsertSaved([], { type: "file", id: "a", title: "A" }, 1), { type: "file", id: "b", title: "B" }, 2);
    expect(removeSaved(items, "file", "a").map((i) => i.id)).toEqual(["b"]);
  });

  it("withLastFile only updates an EXISTING playlist entry (never creates one)", () => {
    expect(withLastFile([], PL, "file-1")).toEqual([]);
    const items = upsertSaved([], { type: "playlist", id: PL, title: "P", lastFile: "a" }, 1);
    expect(withLastFile(items, PL, "a")).toBe(items); // unchanged → same reference, no write
    expect(withLastFile(items, PL, "b")[0].lastFile).toBe("b");
    expect(withLastFile(items, "OtherPlaylistToken1", "b")).toBe(items);
    expect(withLastFile(items, PL, "bad slug")).toBe(items);
  });

  it("savedHref reopens the playlist at its last file, or the file page", () => {
    const [p] = upsertSaved([], { type: "playlist", id: PL, title: "P", lastFile: "f1" }, 1);
    expect(savedHref(p)).toBe(`/p/${PL}?f=f1`);
    expect(savedHref({ ...p, lastFile: null })).toBe(`/p/${PL}`);
    const [f] = upsertSaved([], { type: "file", id: "slug1", title: "F" }, 1);
    expect(savedHref(f)).toBe("/f/slug1");
  });
});
