import { describe, expect, it } from "vitest";
import { FILE_KINDS, FILE_KIND_META, extensionOf, fileKindLabel, resolveFileKind } from "./fileKinds";

describe("extensionOf", () => {
  it("reads the trailing extension case-insensitively and ignores junk", () => {
    expect(extensionOf("Report v2.PDF ")).toBe("pdf");
    expect(extensionOf("archive.tar.gz")).toBe("gz");
    expect(extensionOf("no extension")).toBeNull();
    expect(extensionOf("")).toBeNull();
    expect(extensionOf(null)).toBeNull();
    expect(extensionOf("weird.extensionTooLong")).toBeNull();
  });
});

describe("resolveFileKind", () => {
  it.each([
    ["Syllabus.pdf", "document", "pdf"],
    ["Notes.docx", "document", "word"],
    ["Budget.xlsx", "document", "excel"],
    ["Data.csv", "other", "excel"],
    ["Lecture 1.pptx", "document", "powerpoint"],
    ["Cover.jpg", "image", "image"],
    ["Clip.mp4", "video", "video"],
    ["Song.mp3", "audio", "audio"],
    ["Pack.zip", "archive", "archive"],
    ["Pack.rar", "archive", "archive"],
    ["App.apk", "other", "apk"],
    ["Readme.txt", "other", "document"],
  ])("%s (%s) → %s", (title, fileType, expected) => {
    expect(resolveFileKind({ title, fileType })).toBe(expected);
  });

  it("falls back to the coarse database type when the name has no usable extension", () => {
    expect(resolveFileKind({ title: "Week 3", fileType: "video" })).toBe("video");
    expect(resolveFileKind({ title: "Week 3", fileType: "audio" })).toBe("audio");
    expect(resolveFileKind({ title: "Week 3", fileType: "document" })).toBe("document");
    expect(resolveFileKind({ title: "Week 3", fileType: "archive" })).toBe("archive");
    expect(resolveFileKind("image")).toBe("image");
  });

  it("uses the mime type when the name doesn't help", () => {
    expect(resolveFileKind({ title: "x", fileType: "other", mimeType: "application/pdf" })).toBe("pdf");
    expect(resolveFileKind({ title: "x", fileType: "document", mimeType: "application/vnd.android.package-archive" })).toBe("apk");
    expect(resolveFileKind({ title: "x", fileType: "other", mimeType: "video/webm; codecs=vp9" })).toBe("video");
    expect(resolveFileKind({ title: "x", mimeType: "image/png" })).toBe("image");
  });

  it("a vague extension doesn't override a clear creator-chosen category, a specific one does", () => {
    expect(resolveFileKind({ title: "lecture.zip", fileType: "video" })).toBe("video");
    expect(resolveFileKind({ title: "lecture.pdf", fileType: "video" })).toBe("pdf");
  });

  it("unknown / empty / garbage input falls back to 'other' and never throws", () => {
    expect(resolveFileKind(null)).toBe("other");
    expect(resolveFileKind(undefined)).toBe("other");
    expect(resolveFileKind({})).toBe("other");
    expect(resolveFileKind({ fileType: "hologram", title: "thing.xyz" })).toBe("other");
    expect(resolveFileKind({ title: "mystery.zzz", mimeType: "application/x-unknown" })).toBe("other");
  });
});

describe("metadata", () => {
  it("has metadata for every kind", () => {
    for (const k of FILE_KINDS) expect(FILE_KIND_META[k].kind).toBe(k);
  });
  it("labels", () => {
    expect(fileKindLabel({ title: "a.pdf" })).toBe("PDF");
    expect(fileKindLabel({ title: "a.pptx" })).toBe("PowerPoint");
    expect(fileKindLabel("nonsense")).toBe("File");
  });
});
