import { describe, expect, it } from "vitest";
import {
  HOME_ROW_LIMIT, LIBRARY_FILTERS, buildHomeSections, filesForFilter, filterByQuery, hasMore, matchesQuery, sortNewestFirst,
} from "./library";

const file = (id: number, fileType: string, createdAt: string, title = `File ${id}`) => ({ id, title, fileType, createdAt });
const playlist = (id: number, createdAt: string, title = `List ${id}`) => ({ id, title, createdAt });

describe("LIBRARY_FILTERS", () => {
  it("starts with Home (not All) and keeps every other category", () => {
    expect([...LIBRARY_FILTERS]).toEqual(["Home", "Video", "Document", "Audio", "Image", "Archive", "Playlist"]);
    expect(LIBRARY_FILTERS).not.toContain("All");
  });
});

describe("search helpers", () => {
  it("matches titles case-insensitively and treats blank queries as match-all", () => {
    expect(matchesQuery("Summer Holiday.MP4", "holiday")).toBe(true);
    expect(matchesQuery("Summer", "winter")).toBe(false);
    expect(matchesQuery("anything", "   ")).toBe(true);
    expect(matchesQuery(null, "x")).toBe(false);
  });
  it("filters both files and playlists by title", () => {
    expect(filterByQuery([file(1, "video", "2025-01-01", "Alpha"), file(2, "audio", "2025-01-01", "Beta")], "alp").map((f) => f.id)).toEqual([1]);
    expect(filterByQuery([playlist(1, "2025-01-01", "Course A"), playlist(2, "2025-01-01", "Misc")], "course")).toHaveLength(1);
    const same = [file(1, "video", "2025-01-01")];
    expect(filterByQuery(same, "")).toBe(same);
  });
});

describe("sortNewestFirst / filesForFilter", () => {
  it("orders newest first, is stable for equal dates and tolerates bad dates", () => {
    const items = [file(1, "video", "2025-01-01"), file(2, "video", "2025-03-01"), file(3, "video", "2025-03-01"), file(4, "video", "not-a-date")];
    expect(sortNewestFirst(items).map((f) => f.id)).toEqual([2, 3, 1, 4]);
  });
  it("keeps the existing per-category rule", () => {
    const fs = [file(1, "video", "2025-01-01"), file(2, "audio", "2025-01-01"), file(3, "other", "2025-01-01")];
    expect(filesForFilter(fs, "Video").map((f) => f.id)).toEqual([1]);
    expect(filesForFilter(fs, "Audio").map((f) => f.id)).toEqual([2]);
    expect(filesForFilter(fs, "Home")).toHaveLength(3);
    expect(filesForFilter(fs, "Playlist")).toEqual([]);
  });
});

describe("buildHomeSections", () => {
  it("returns no sections for an empty library", () => {
    expect(buildHomeSections([], [])).toEqual([]);
  });

  it("hides empty categories and orders the rest: Recently Added, Videos, Documents, Audio, Images, Archives, Playlists", () => {
    const files = [
      file(1, "audio", "2025-01-01"), file(2, "video", "2025-01-02"), file(3, "archive", "2025-01-03"),
      file(4, "document", "2025-01-04"), file(5, "image", "2025-01-05"),
    ];
    const s = buildHomeSections(files, [playlist(1, "2025-01-01")]);
    expect(s.map((x) => x.key)).toEqual(["recent", "video", "document", "audio", "image", "archive", "playlist"]);
    expect(s.map((x) => x.title)).toEqual(["Recently Added", "Videos", "Documents", "Audio", "Images", "Archives", "Playlists"]);

    const onlyVideo = buildHomeSections([file(1, "video", "2025-01-01")], []);
    expect(onlyVideo.map((x) => x.key)).toEqual(["recent", "video"]);
  });

  it("puts only relevant files in each category section and never invents or duplicates records within a section", () => {
    const files = [file(1, "video", "2025-01-01"), file(2, "audio", "2025-01-02"), file(3, "video", "2025-01-03"), file(4, "other", "2025-01-04")];
    const s = buildHomeSections(files, []);
    const videos = s.find((x) => x.key === "video")!;
    expect(videos.items.map((i) => i.id)).toEqual([3, 1]);
    const ids = s.find((x) => x.key === "recent")!.items.map((i) => i.id);
    expect(ids).toEqual([4, 3, 2, 1]);
    expect(new Set(ids).size).toBe(ids.length);
    // "other" files have no category row but are still reachable via Recently Added
    expect(s.some((x) => x.items.some((i) => i.id === 4 && x.key !== "recent"))).toBe(false);
  });

  it("caps rows at the limit, reports the full total, and offers See all only when there is more", () => {
    const many = Array.from({ length: HOME_ROW_LIMIT + 3 }, (_, i) => file(i + 1, "video", `2025-02-${String(i + 1).padStart(2, "0")}`));
    const s = buildHomeSections(many, [playlist(1, "2025-01-01")]);
    const videos = s.find((x) => x.key === "video")!;
    expect(videos.items).toHaveLength(HOME_ROW_LIMIT);
    expect(videos.total).toBe(HOME_ROW_LIMIT + 3);
    expect(videos.items[0].id).toBe(HOME_ROW_LIMIT + 3); // newest first
    expect(hasMore(videos)).toBe(true);
    expect(videos.filter).toBe("Video");
    expect(hasMore(s.find((x) => x.key === "playlist")!)).toBe(false);
    expect(s.find((x) => x.key === "recent")!.filter).toBeNull(); // expands in place
  });
});
