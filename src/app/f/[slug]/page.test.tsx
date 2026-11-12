// @vitest-environment jsdom
import React, { Suspense, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SmartLinkPage from "./page";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));

let container: HTMLDivElement;
let root: Root;

const FILE = {
  id: 7, title: "Quarterly Report", description: "All the numbers.", fileType: "document", mimeType: "application/pdf",
  fileSize: 123456, // present in the API payload but must never be displayed
  hasPassword: false, starsPrice: 0, views: 12, downloads: 3, slug: "abc", thumbnailUrl: null, thumbnailWidth: null, thumbnailHeight: null,
};
const CREATOR = { firstName: "Ada", username: "ada", avatarUrl: null };

type Post = (body: { password: string }) => { status: number; body: unknown };
let posts: { password: string }[];

function mockServer(file: Record<string, unknown>, post: Post, getStatus = 200) {
  posts = [];
  vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
    if (init?.method === "POST" && String(url).startsWith("/api/link/")) {
      const body = JSON.parse(init.body as string);
      posts.push(body);
      const r = post(body);
      return Promise.resolve(new Response(JSON.stringify(r.body), { status: r.status }));
    }
    if (getStatus !== 200) return Promise.resolve(new Response(JSON.stringify({ error: "x" }), { status: getStatus }));
    return Promise.resolve(new Response(JSON.stringify({ file, creator: CREATOR }), { status: 200 }));
  }));
}
const okPost: Post = () => ({ status: 200, body: { success: true, telegramMessageLink: "https://t.me/c/1/2" } });

async function mount() {
  const params = Object.assign(Promise.resolve({ slug: "abc" }), { status: "fulfilled", value: { slug: "abc" } }) as Promise<{ slug: string }>;
  await act(async () => root.render(<Suspense fallback={null}><SmartLinkPage params={params} /></Suspense>));
  await act(async () => { await Promise.resolve(); });
}
const click = (el: Element | null | undefined) => act(async () => { (el as HTMLElement).dispatchEvent(new MouseEvent("click", { bubbles: true })); });
const btn = (text: string) => Array.from(container.querySelectorAll("button, a")).find((b) => b.textContent?.includes(text)) as HTMLElement | undefined;
// React schedules each 1s countdown timer only after the previous tick has rendered,
// so advance one second at a time (a single big jump would count only one tick).
const tick = async (ms: number) => { for (let i = 0; i < ms / 1000; i++) await act(async () => { await vi.advanceTimersByTimeAsync(1000); }); };
async function type(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: false });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("Download / Get File page — presentation", () => {
  it("shows brand header, hero artwork, title, type, stats, creator and description — and no file size", async () => {
    mockServer(FILE, okPost);
    await mount();
    expect(container.textContent).toContain("Onfile");
    expect(container.querySelector('[data-testid="file-hero"]')).not.toBeNull();
    expect(container.querySelector("h1")?.textContent).toBe("Quarterly Report");
    expect(container.textContent).toContain("12 views");
    expect(container.textContent).toContain("3 downloads");
    expect(container.textContent).toContain("Ada");
    expect(container.textContent).toContain("All the numbers.");
    expect(container.textContent).not.toMatch(/Unknown size|\bKB\b|\bMB\b|120\.6/);
    // no fabricated claims
    expect(container.textContent).not.toContain("Verified");
  });

  it("falls back to FileTypeArt (no broken image) when there is no thumbnail, and uses the thumbnail when there is one", async () => {
    mockServer(FILE, okPost);
    await mount();
    expect(container.querySelector('[data-testid="file-hero"] [data-testid="file-type-art"]')).not.toBeNull();
    expect(container.querySelector("img")).toBeNull();

    await act(async () => root.unmount());
    root = createRoot(container);
    mockServer({ ...FILE, thumbnailUrl: "https://cdn.example/t.jpg", thumbnailWidth: 1280, thumbnailHeight: 720 }, okPost);
    await mount();
    const hero = container.querySelector('[data-testid="file-hero"]') as HTMLElement;
    expect(hero.querySelector("img")?.className).toContain("object-cover");
    expect(hero.style.aspectRatio).toBeTruthy();
  });

  it("shows a not-found state for 404 and a retryable error state for server failures", async () => {
    mockServer(FILE, okPost, 404);
    await mount();
    expect(container.textContent).toContain("File not found");

    await act(async () => root.unmount());
    root = createRoot(container);
    mockServer(FILE, okPost, 500);
    await mount();
    expect(container.textContent).toContain("Couldn’t load this file");
    expect(btn("Try again")).toBeTruthy();
  });
});

describe("Download page — advertisement flow (server still decides)", () => {
  it("requires the full countdown before 'Get file' exists; nothing is requested from the server until then", async () => {
    mockServer(FILE, okPost);
    await mount();
    expect(btn("Get file")).toBeUndefined();
    await click(btn("Watch ad to get file"));
    expect(posts).toHaveLength(0);
    expect((btn("Please wait") as HTMLButtonElement).disabled).toBe(true);
    expect(container.querySelector('[role="progressbar"]')).not.toBeNull();

    await tick(5000);
    expect(btn("Get file")).toBeUndefined();
    expect(container.textContent).toContain("5s");
    expect(posts).toHaveLength(0);

    await tick(5000);
    expect(btn("Get file")).toBeDefined();
    expect(posts).toHaveLength(0); // the ad finishing alone grants nothing
  });

  it("unlocks only from the server's successful answer, and a double tap sends one request", async () => {
    mockServer(FILE, okPost);
    await mount();
    await click(btn("Watch ad to get file"));
    await tick(10_000);
    const get = btn("Get file")!;
    await act(async () => {
      get.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      get.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(posts).toHaveLength(1);
    expect(container.textContent).toContain("Your file is ready");
    const link = btn("Open in Telegram") as HTMLAnchorElement;
    expect(link.href).toBe("https://t.me/c/1/2");
    expect(link.rel).toContain("noopener");
  });

  it("shows an error and stays locked when the server refuses; the user can retry", async () => {
    let n = 0;
    mockServer(FILE, () => (++n === 1 ? { status: 500, body: { error: "boom" } } : okPost({ password: "" })));
    await mount();
    await click(btn("Watch ad to get file"));
    await tick(10_000);
    await click(btn("Get file"));
    expect(container.querySelector('[role="alert"]')?.textContent).toMatch(/Something went wrong/);
    expect(container.textContent).not.toContain("Your file is ready");
    expect((btn("Get file") as HTMLButtonElement).disabled).toBe(false);
    await click(btn("Get file"));
    expect(container.textContent).toContain("Your file is ready");
  });

  it("never renders a javascript: link from the server as the Telegram target", async () => {
    mockServer(FILE, () => ({ status: 200, body: { success: true, telegramMessageLink: "javascript:alert(1)" } }));
    await mount();
    await click(btn("Watch ad to get file"));
    await tick(10_000);
    await click(btn("Get file"));
    expect(container.textContent).toContain("Your file is ready");
    expect(container.querySelector('a[href^="javascript"]')).toBeNull();
  });
});

describe("Download page — password & Stars", () => {
  const PW = { ...FILE, hasPassword: true };

  it("password files offer only the password (no ad); a wrong password is rejected by the server and shows an error", async () => {
    mockServer(PW, ({ password }) => (password === "secret" ? okPost({ password }) : { status: 403, body: { error: "Wrong password" } }));
    await mount();
    expect(btn("Watch ad")).toBeUndefined();
    const input = container.querySelector("#file-password") as HTMLInputElement;
    expect((btn("Unlock file") as HTMLButtonElement).disabled).toBe(true); // empty → disabled
    await type(input, "nope");
    await click(btn("Unlock file"));
    expect(posts).toEqual([{ password: "nope" }]);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Incorrect password");
    expect(container.textContent).not.toContain("Your file is ready");

    await type(input, "secret");
    await click(btn("Unlock file"));
    expect(posts).toHaveLength(2);
    expect(container.textContent).toContain("Your file is ready");
  });

  it("the password field can be revealed and submitted with Enter (form submit)", async () => {
    mockServer(PW, okPost);
    await mount();
    const input = container.querySelector("#file-password") as HTMLInputElement;
    expect(input.type).toBe("password");
    await click(container.querySelector('[aria-label="Show password"]'));
    expect(input.type).toBe("text");
    await type(input, "x");
    await act(async () => { container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    expect(posts).toHaveLength(1);
  });

  it("Stars: shown alongside the ad, never unlocks by clicking, and is honestly disabled", async () => {
    mockServer({ ...FILE, starsPrice: 100 }, okPost);
    await mount();
    const tabs = Array.from(container.querySelectorAll('[role="tab"]')).map((t) => t.textContent);
    expect(tabs).toEqual(["Watch ad", "Stars"]);
    await click(Array.from(container.querySelectorAll('[role="tab"]')).find((t) => t.textContent === "Stars"));
    const pay = btn("Pay 100 Stars") as HTMLButtonElement;
    expect(pay.disabled).toBe(true);
    await click(pay);
    expect(posts).toHaveLength(0);
    expect(container.textContent).toContain("isn’t available yet");
  });
});

describe("Download page — report", () => {
  it("opens the report dialog from the header and surfaces submit failures", async () => {
    mockServer(FILE, okPost);
    await mount();
    await click(container.querySelector('[aria-label="Report this file"]'));
    expect(document.body.textContent).toContain("Report File");
    const f = fetch as unknown as ReturnType<typeof vi.fn>;
    f.mockImplementationOnce(() => Promise.resolve(new Response("{}", { status: 500 })));
    await act(async () => { document.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    expect(document.body.textContent).toContain("couldn’t submit your report");
  });
});
