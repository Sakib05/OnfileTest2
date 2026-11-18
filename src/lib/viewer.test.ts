import { describe, expect, it } from "vitest";
import { fileShareUrl, isLongDescription, parseFileParam, playlistSummary, resolveSelected, selectionUrl, typeAndSize } from "./viewer";
import type { PublicPlaylistItem } from "./playlistSharing";

const it_ = (slug: string, fileType: string | null = "audio"): PublicPlaylistItem => ({ position: 1, slug, title: slug, fileType, mimeType: null, fileSize: null, thumbnailUrl: null, hasPassword: false, starsPrice: 0 });

describe("viewer helpers", () => {
  it("parseFileParam accepts only well-formed slugs", () => {
    expect(parseFileParam("?f=abc_DEF-123")).toBe("abc_DEF-123");
    expect(parseFileParam("?f=")).toBeNull();
    expect(parseFileParam("?f=<script>")).toBeNull();
    expect(parseFileParam("?f=" + "a".repeat(65))).toBeNull();
    expect(parseFileParam("")).toBeNull();
  });

  it("resolveSelected honours the URL only for real items, else the first one", () => {
    const items = [it_("a"), it_("b")];
    expect(resolveSelected(items, "b")!.slug).toBe("b");
    expect(resolveSelected(items, "zzz")!.slug).toBe("a");
    expect(resolveSelected(items, null)!.slug).toBe("a");
    expect(resolveSelected([], "a")).toBeNull();
  });

  it("selectionUrl keeps the existing playlist route", () => {
    expect(selectionUrl("TOKEN1234567890AB", "my-file")).toBe("/p/TOKEN1234567890AB?f=my-file");
  });

  it("playlistSummary: 'Playlist • 13 audio' and friends", () => {
    expect(playlistSummary(Array.from({ length: 13 }, () => it_("x", "audio")))).toBe("Playlist • 13 audio");
    expect(playlistSummary([it_("x", "video"), it_("y", "video")])).toBe("Playlist • 2 video");
    expect(playlistSummary([it_("x", "document"), it_("y", "document")])).toBe("Playlist • 2 documents");
    expect(playlistSummary([it_("x", "document")])).toBe("Playlist • 1 document");
    expect(playlistSummary([it_("x", "audio"), it_("y", "video")])).toBe("Playlist • 2 files");
    expect(playlistSummary([it_("x", null), it_("y", "other")])).toBe("Playlist • 2 files");
  });

  it("fileShareUrl is the existing public /f/<slug> link", () => {
    expect(fileShareUrl("https://onfile-app.vercel.app/", "abc")).toBe("https://onfile-app.vercel.app/f/abc");
  });

  it("typeAndSize shows size only when known", () => {
    expect(typeAndSize({ title: "a.pdf", fileType: "document", fileSize: 2048 })).toBe("PDF · 2.0 KB");
    expect(typeAndSize({ title: "song", fileType: "audio", fileSize: null })).toBe("Audio");
  });

  it("isLongDescription", () => {
    expect(isLongDescription("short")).toBe(false);
    expect(isLongDescription("x".repeat(200))).toBe(true);
    expect(isLongDescription("a\nb\nc")).toBe(true);
  });
});
