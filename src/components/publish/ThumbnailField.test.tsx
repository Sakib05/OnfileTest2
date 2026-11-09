// @vitest-environment jsdom
import React, { act, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ThumbnailField from "./ThumbnailField";
import { ThumbnailUploadError, type StagedThumbnail, type ThumbnailStorageService } from "@/lib/publishing/thumbnailStorage";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let current: StagedThumbnail | null = null;
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

function Harness({ service }: { service: ThumbnailStorageService }) {
  const [v, setV] = useState<StagedThumbnail | null>(null);
  useEffect(() => {
    current = v;
  }, [v]);
  return <ThumbnailField value={v} onChange={setV} service={service} />;
}
const file = (type = "image/png", size = 1000, name = "a.png") => new File([new Uint8Array(size)], name, { type });
async function pick(f: File) {
  const input = container.querySelector("#thumb-input") as HTMLInputElement;
  Object.defineProperty(input, "files", { value: [f], configurable: true });
  await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); });
  await flush();
}
const buttonByText = (t: string) => Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.includes(t)) as HTMLButtonElement | undefined;

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => "blob:preview");
  URL.revokeObjectURL = vi.fn();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  current = null;
});

describe("ThumbnailField", () => {
  it("rejects unsupported types and files over 5 MB without calling the service", async () => {
    const service: ThumbnailStorageService = { available: true, upload: vi.fn(), remove: vi.fn() };
    await act(async () => root.render(<Harness service={service} />));
    await pick(file("image/gif", 100, "a.gif"));
    expect(container.textContent).toContain("Unsupported file");
    await pick(file("image/png", 5 * 1024 * 1024 + 1));
    expect(container.textContent).toContain("Maximum size is 5 MB");
    expect(service.upload).not.toHaveBeenCalled();
    expect(current).toBeNull();
  });

  it("uploads, reports success and stores the ref + stable URL", async () => {
    const upload = vi.fn().mockImplementation(async (_f: File, o?: { onProgress?: (n: number) => void }) => {
      o?.onProgress?.(60);
      return { ref: "a".repeat(24), previewUrl: "https://cdn.example/t.webp" };
    });
    await act(async () => root.render(<Harness service={{ available: true, upload, remove: vi.fn() }} />));
    await pick(file());
    expect(current).toEqual({ ref: "a".repeat(24), previewUrl: "https://cdn.example/t.webp" });
    expect(container.textContent).toContain("Thumbnail uploaded");
    expect(container.querySelector("img")?.getAttribute("src")).toBe("https://cdn.example/t.webp");
  });

  it("shows the failure, keeps the picked file, and Retry succeeds", async () => {
    const upload = vi.fn()
      .mockRejectedValueOnce(new ThumbnailUploadError("Thumbnail storage is not available right now.", 503))
      .mockResolvedValueOnce({ ref: "b".repeat(24), previewUrl: "https://cdn.example/b.webp" });
    await act(async () => root.render(<Harness service={{ available: true, upload, remove: vi.fn() }} />));
    await pick(file());
    expect(container.textContent).toContain("Thumbnail storage is not available right now.");
    expect(current).toBeNull();
    await act(async () => buttonByText("Retry upload")!.click());
    await flush();
    expect(upload).toHaveBeenCalledTimes(2);
    expect(current?.ref).toBe("b".repeat(24));
    expect(container.textContent).not.toContain("not available right now");
  });

  it("replace discards the previous staged image; remove clears the thumbnail", async () => {
    const upload = vi.fn()
      .mockResolvedValueOnce({ ref: "1".repeat(24), previewUrl: "https://cdn.example/1.webp" })
      .mockResolvedValueOnce({ ref: "2".repeat(24), previewUrl: "https://cdn.example/2.webp" });
    const remove = vi.fn().mockResolvedValue(undefined);
    await act(async () => root.render(<Harness service={{ available: true, upload, remove }} />));
    await pick(file());
    await pick(file("image/jpeg", 500, "b.jpg"));
    expect(current?.ref).toBe("2".repeat(24));
    expect(remove).toHaveBeenCalledWith("1".repeat(24));
    await act(async () => buttonByText("Remove Thumbnail")!.click());
    await flush();
    expect(remove).toHaveBeenCalledWith("2".repeat(24));
    expect(current).toBeNull();
    expect(container.textContent).toContain("Upload Thumbnail"); // back to the default state
  });
});
