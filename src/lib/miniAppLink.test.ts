import { describe, expect, it } from "vitest";
import {
  buildFileStartParam,
  buildMiniAppFileLink,
  buildShareFileLink,
  buildWebFileLink,
  parseFileStartParam,
} from "./miniAppLink";

describe("file start param", () => {
  it("round-trips a nanoid-style slug", () => {
    const param = buildFileStartParam("aB3_-xYz09");
    expect(param).toBe("f_aB3_-xYz09");
    expect(parseFileStartParam(param)).toBe("aB3_-xYz09");
  });

  it("rejects unsafe or foreign values", () => {
    expect(parseFileStartParam(undefined)).toBeNull();
    expect(parseFileStartParam("")).toBeNull();
    expect(parseFileStartParam("ref_123")).toBeNull();
    expect(parseFileStartParam("f_")).toBeNull();
    expect(parseFileStartParam("f_../admin")).toBeNull();
    expect(parseFileStartParam("f_a/b")).toBeNull();
    expect(parseFileStartParam("f_a?x=1")).toBeNull();
    expect(parseFileStartParam("f_https://evil.example")).toBeNull();
    expect(parseFileStartParam("f_" + "a".repeat(65))).toBeNull();
    expect(buildFileStartParam("bad slug")).toBeNull();
  });
});

describe("buildMiniAppFileLink", () => {
  it("builds a direct-link Mini App URL when bot and short name are known", () => {
    expect(buildMiniAppFileLink({ botUsername: "OnfileBot", appShortName: "app" }, "AbCdEfGhIj")).toBe(
      "https://t.me/OnfileBot/app?startapp=f_AbCdEfGhIj"
    );
    expect(buildMiniAppFileLink({ botUsername: "@OnfileBot", appShortName: "/app/" }, "x1")).toBe(
      "https://t.me/OnfileBot/app?startapp=f_x1"
    );
  });

  it("returns null when it cannot be built safely", () => {
    expect(buildMiniAppFileLink(null, "abc")).toBeNull();
    expect(buildMiniAppFileLink({ botUsername: "OnfileBot" }, "abc")).toBeNull();
    expect(buildMiniAppFileLink({ appShortName: "app" }, "abc")).toBeNull();
    expect(buildMiniAppFileLink({ botUsername: "OnfileBot", appShortName: "a/b" }, "abc")).toBeNull();
    expect(buildMiniAppFileLink({ botUsername: "OnfileBot", appShortName: "app" }, "a b")).toBeNull();
  });
});

describe("share links", () => {
  it("builds the web URL without a double slash", () => {
    expect(buildWebFileLink("https://onfile-app.vercel.app/", "abc")).toBe("https://onfile-app.vercel.app/f/abc");
  });

  it("falls back to the web URL when no Mini App link is available", () => {
    expect(buildShareFileLink("https://x.app", { botUsername: "OnfileBot" }, "abc")).toBe("https://x.app/f/abc");
  });

  it("prefers the Mini App link when configured", () => {
    expect(buildShareFileLink("https://x.app", { botUsername: "OnfileBot", appShortName: "app" }, "abc")).toBe(
      "https://t.me/OnfileBot/app?startapp=f_abc"
    );
  });
});
