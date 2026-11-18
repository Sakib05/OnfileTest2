import { describe, expect, it } from "vitest";
import { PLAYLIST_TITLE_MAX } from "@/lib/playlists";
import { ADD_FILES_CHUNK, chunkIds, duplicateTitle, moveToFront, previewBlock, summariseFiles } from "./playlistManage";

describe("summariseFiles", () => {
  it("sums only known sizes and counts unpublished files", () => {
    const s = summariseFiles([
      { fileSize: 1000, isPublished: true, smartLinkSlug: "a" },
      { fileSize: 500, isPublished: false, smartLinkSlug: "b" },
      { fileSize: null, isPublished: true, smartLinkSlug: null },
    ]);
    expect(s).toEqual({ count: 3, knownBytes: 1500, partial: true, unpublished: 2 });
  });
  it("is not partial when every size is known, and never invents a total", () => {
    expect(summariseFiles([{ fileSize: 10, isPublished: true, smartLinkSlug: "a" }]).partial).toBe(false);
    expect(summariseFiles([{ fileSize: null, isPublished: true, smartLinkSlug: "a" }])).toMatchObject({ knownBytes: 0, partial: false });
    expect(summariseFiles([])).toEqual({ count: 0, knownBytes: 0, partial: false, unpublished: 0 });
  });
});

describe("duplicateTitle", () => {
  it("prefixes and respects the server's title limit", () => {
    expect(duplicateTitle("Business")).toBe("Copy of Business");
    const long = duplicateTitle("x".repeat(PLAYLIST_TITLE_MAX));
    expect(long.length).toBeLessThanOrEqual(PLAYLIST_TITLE_MAX);
    expect(long.startsWith("Copy of ")).toBe(true);
  });
});

describe("chunkIds", () => {
  it("splits in order into request-sized chunks", () => {
    const ids = Array.from({ length: ADD_FILES_CHUNK * 2 + 5 }, (_, i) => i + 1);
    const chunks = chunkIds(ids);
    expect(chunks.map((c) => c.length)).toEqual([ADD_FILES_CHUNK, ADD_FILES_CHUNK, 5]);
    expect(chunks.flat()).toEqual(ids);
    expect(chunkIds([])).toEqual([]);
  });
});

describe("moveToFront", () => {
  const list = [{ id: 1 }, { id: 2 }, { id: 3 }];
  it("moves one item to the front and keeps the rest in order", () => {
    expect(moveToFront(list, 3).map((f) => f.id)).toEqual([3, 1, 2]);
  });
  it("returns the same array when nothing changes (already first / unknown id)", () => {
    expect(moveToFront(list, 1)).toBe(list);
    expect(moveToFront(list, 99)).toBe(list);
  });
});

describe("previewBlock", () => {
  it("private playlists and Stars-priced playlists have no public page", () => {
    expect(previewBlock({ isPublished: false })).toBe("private");
    expect(previewBlock({ isPublished: true, starsPrice: 10 })).toBe("paid");
    expect(previewBlock({ isPublished: true, starsPrice: 0 })).toBeNull();
    expect(previewBlock({ isPublished: true })).toBeNull();
  });
});
