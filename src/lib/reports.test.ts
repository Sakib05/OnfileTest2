import { describe, expect, it } from "vitest";
import { REPORT_DETAILS_MAX, cleanReportDetails, parseReportBody } from "./reports";

describe("parseReportBody", () => {
  it("accepts a file or playlist target with a known reason", () => {
    expect(parseReportBody({ target: "file", slug: "abc", reason: "spam" })).toMatchObject({ target: "file", fileSlug: "abc", playlistSlug: null, reason: "spam", details: null, honeypot: false });
    expect(parseReportBody({ target: "playlist", slug: "AbCdEfGhIjKlMnOp", reason: "inappropriate", details: " hi " })).toMatchObject({ target: "playlist", playlistSlug: "AbCdEfGhIjKlMnOp", fileSlug: null, details: "hi" });
  });

  it("rejects bad shapes, targets, reasons and slugs (numeric ids are not accepted)", () => {
    for (const body of [null, "x", {}, { target: "user", slug: "a", reason: "spam" }, { target: "file", slug: "a", reason: "nsfw" }, { target: "file", slug: "a b", reason: "spam" }, { target: "file", slug: 12, reason: "spam" }, { target: "file", fileId: 12, reason: "spam" }, { target: "file", slug: "", reason: "spam" }])
      expect(parseReportBody(body)).toBeNull();
  });

  it("flags the honeypot and cleans details", () => {
    expect(parseReportBody({ target: "file", slug: "a", reason: "other", website: "http://spam" })!.honeypot).toBe(true);
    expect(cleanReportDetails("a\u0000b\u0007c\nd")).toBe("abc\nd");
    expect(cleanReportDetails("   ")).toBeNull();
    expect(cleanReportDetails(5)).toBeNull();
    expect(cleanReportDetails("x".repeat(REPORT_DETAILS_MAX + 50))).toHaveLength(REPORT_DETAILS_MAX);
  });
});
