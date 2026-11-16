// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { buildShareUrl, isValidShareSlug, itemHref, neighbours, parseListParam, recallPosition, rememberPosition, sharePath, telegramShareUrl, type PublicPlaylistItem } from "./playlistSharing";

const item = (position: number, slug = `file-${position}`): PublicPlaylistItem => ({ position, slug, title: `T${position}`, fileType: "video", mimeType: null, fileSize: null, thumbnailUrl: null, hasPassword: false, starsPrice: 0 });

describe("share URLs", () => {
  it("builds the public URL from the origin and token (no double slash, token encoded)", () => {
    expect(buildShareUrl("https://onfile-app.vercel.app", "AbCdEfGhIjKlMnOp")).toBe("https://onfile-app.vercel.app/p/AbCdEfGhIjKlMnOp");
    expect(buildShareUrl("https://onfile-app.vercel.app/", "AbCdEfGhIjKlMnOp")).toBe("https://onfile-app.vercel.app/p/AbCdEfGhIjKlMnOp");
    expect(sharePath("a b")).toBe("/p/a%20b");
  });

  it("Telegram share URL carries the exact playlist URL and text, correctly encoded", () => {
    const u = new URL(telegramShareUrl("https://x.test/p/AbCdEfGhIjKlMnOp", "Check out “Mix & Match”"));
    expect(u.origin + u.pathname).toBe("https://t.me/share/url");
    expect(u.searchParams.get("url")).toBe("https://x.test/p/AbCdEfGhIjKlMnOp");
    expect(u.searchParams.get("text")).toBe("Check out “Mix & Match”");
    expect(telegramShareUrl("https://x.test/p/a")).not.toContain("text=");
    expect(telegramShareUrl("https://x.test/p/a", "a b")).toContain("text=a%20b");
  });

  it("validates tokens strictly (numeric ids and junk never qualify)", () => {
    expect(isValidShareSlug("AbCdEfGhIjKlMnOp")).toBe(true);
    for (const bad of ["123", "short", "has space 123456789", "../../etc/passwd1234", "x".repeat(33), "", undefined, null, 42]) expect(isValidShareSlug(bad)).toBe(false);
    expect(parseListParam("AbCdEfGhIjKlMnOp")).toBe("AbCdEfGhIjKlMnOp");
    expect(parseListParam(["AbCdEfGhIjKlMnOp", "x"])).toBe("AbCdEfGhIjKlMnOp");
    expect(parseListParam("42")).toBeNull();
    expect(parseListParam(undefined)).toBeNull();
  });

  it("item links go to the existing file page carrying the playlist context", () => {
    expect(itemHref("my-file", "AbCdEfGhIjKlMnOp", 3)).toBe("/f/my-file?list=AbCdEfGhIjKlMnOp&i=3");
  });
});

describe("neighbours (sequential navigation)", () => {
  const items = [item(1), item(2), item(3)];
  it("finds position by file slug and links to the saved-order neighbours", () => {
    const n = neighbours(items, "file-2")!;
    expect(n).toMatchObject({ position: 2, total: 3 });
    expect(n.previous?.slug).toBe("file-1");
    expect(n.next?.slug).toBe("file-3");
  });
  it("has no previous on the first item and no next on the last; unknown file → null", () => {
    expect(neighbours(items, "file-1")!.previous).toBeNull();
    expect(neighbours(items, "file-3")!.next).toBeNull();
    expect(neighbours(items, "other")).toBeNull();
  });
});

describe("continue-where-you-left-off memory", () => {
  it("stores and recalls a position per playlist, ignoring junk", () => {
    localStorage.clear();
    expect(recallPosition("AbCdEfGhIjKlMnOp")).toBeNull();
    rememberPosition("AbCdEfGhIjKlMnOp", 4);
    expect(recallPosition("AbCdEfGhIjKlMnOp")).toBe(4);
    localStorage.setItem("onfile_pl_last_zzzzzzzzzzzzzzzz", "abc");
    expect(recallPosition("zzzzzzzzzzzzzzzz")).toBeNull();
  });
});
