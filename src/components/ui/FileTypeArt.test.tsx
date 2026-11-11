// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import FileTypeArt from "./FileTypeArt";
import FileThumb from "./FileThumb";
import PlaylistThumb from "./PlaylistThumb";
import { FILE_KINDS } from "@/lib/fileKinds";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});
const render = (el: React.ReactElement) => act(async () => root.render(el));

// Emoji ranges + symbols that the old placeholders used.
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u;

describe("FileTypeArt", () => {
  it.each(FILE_KINDS)("renders branded SVG artwork for '%s' (no emoji, no external assets)", async (kind) => {
    await render(<FileTypeArt kind={kind} />);
    const tile = container.querySelector('[data-testid="file-type-art"]')!;
    expect(tile.getAttribute("data-kind")).toBe(kind);
    const svg = tile.querySelector("svg")!;
    expect(svg).toBeTruthy();
    expect(svg.querySelectorAll("path, rect, circle").length).toBeGreaterThan(1);
    expect(tile.textContent ?? "").not.toMatch(EMOJI);
    expect(svg.innerHTML).not.toMatch(/https?:|<image|href=/); // fully self-contained
    expect(tile.getAttribute("aria-hidden")).toBe("true"); // decorative unless labelled
  });

  it("detects the kind from the file name / mime and exposes it for assistive tech when labelled", async () => {
    await render(<FileTypeArt fileType="document" title="Budget 2026.xlsx" label="Excel spreadsheet" />);
    const tile = container.querySelector('[data-testid="file-type-art"]')!;
    expect(tile.getAttribute("data-kind")).toBe("excel");
    expect(tile.getAttribute("role")).toBe("img");
    expect(tile.getAttribute("aria-label")).toBe("Excel spreadsheet");
    await render(<FileTypeArt fileType="other" mimeType="application/pdf" />);
    expect(container.querySelector('[data-testid="file-type-art"]')!.getAttribute("data-kind")).toBe("pdf");
  });

  it("unknown or missing types fall back to the neutral 'other' artwork", async () => {
    await render(<FileTypeArt fileType="hologram" title="thing.xyz" />);
    expect(container.querySelector('[data-testid="file-type-art"]')!.getAttribute("data-kind")).toBe("other");
    await render(<FileTypeArt />);
    expect(container.querySelector('[data-testid="file-type-art"]')!.getAttribute("data-kind")).toBe("other");
  });

  it("fills its parent so it works at any size / aspect ratio (mobile list, grid, detail)", async () => {
    await render(<FileTypeArt kind="pdf" />);
    expect(container.querySelector('[data-testid="file-type-art"]')!.className).toMatch(/absolute inset-0/);
  });
});

describe("FileThumb", () => {
  it("shows the artwork when there is no thumbnail", async () => {
    await render(<FileThumb url={null} fileType="video" />);
    expect(container.querySelector('[data-kind="video"]')).toBeTruthy();
    expect(container.querySelector("img")).toBeNull();
  });

  it("shows the creator's thumbnail when present, and falls back to the artwork if it fails to load", async () => {
    await render(<FileThumb url="https://cdn.example/x.webp" fileType="document" title="a.pdf" />);
    const img = container.querySelector("img")!;
    expect(img.getAttribute("src")).toBe("https://cdn.example/x.webp");
    await act(async () => img.dispatchEvent(new Event("error")));
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector('[data-kind="pdf"]')).toBeTruthy();
  });
});

describe("PlaylistThumb", () => {
  it("shows the default playlist image for an empty playlist / missing thumbnail / broken image", async () => {
    await render(<PlaylistThumb url={null} />);
    expect(container.querySelector('[data-testid="playlist-default-art"]')).toBeTruthy();
    await render(<PlaylistThumb url="https://cdn.example/first.webp" />);
    expect(container.querySelector("img")!.getAttribute("src")).toBe("https://cdn.example/first.webp");
    await act(async () => container.querySelector("img")!.dispatchEvent(new Event("error")));
    expect(container.querySelector('[data-testid="playlist-default-art"]')).toBeTruthy();
  });
});

describe("theme support + no leftover emoji placeholders", () => {
  const css = fs.readFileSync(path.join(process.cwd(), "src/app/globals.css"), "utf8");

  it("styles every kind in light and has a dark-theme adjustment", () => {
    for (const k of FILE_KINDS.filter((x) => x !== "other")) expect(css).toContain(`.ft-tile[data-kind="${k}"]`);
    expect(css).toMatch(/\.dark \.ft-tile/);
    expect(css).toMatch(/\.dark \.pl-tile/);
  });

  it("the old emoji helper is gone from the code base", () => {
    const utils = fs.readFileSync(path.join(process.cwd(), "src/lib/utils.ts"), "utf8");
    expect(utils).not.toContain("getFileTypeIcon");
    for (const f of ["src/components/tabs/FilesTab.tsx", "src/components/ui/FileThumb.tsx", "src/components/publish/PreviewStep.tsx"]) {
      const src = fs.readFileSync(path.join(process.cwd(), f), "utf8");
      expect(src).not.toMatch(/[🎬🎵📄🖼📦📁]/u);
      expect(src).not.toContain("getFileTypeIcon");
    }
  });
});
