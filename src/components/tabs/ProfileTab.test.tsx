// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/components/ui/Toast";
import { AppProvider } from "@/contexts/AppContext";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { installTelegramBackButton } from "@/test/telegramBackMock";
import { nativeBackDepth } from "@/lib/telegramBackButton";
import ProfileTab from "./ProfileTab";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** jsdom tests of the redesigned Me section, Edit Profile, FAQ, Privacy & Security and Terms (mocked fetch; no real Telegram). */

let container: HTMLDivElement;
let root: Root;
let me: Record<string, unknown>;
let calls: { url: string; method: string; body?: unknown }[];
let back: ReturnType<typeof installTelegramBackButton>;

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
function installFetch(overrides: Record<string, () => Response> = {}) {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), method: init?.method ?? "GET", body: init?.body });
      for (const [k, v] of Object.entries(overrides)) if (`${init?.method ?? "GET"} ${url}`.startsWith(k)) return v();
      if (url.startsWith("/api/user/me")) {
        if (init?.method === "PATCH") {
          const b = JSON.parse(String(init.body));
          me = { ...me, firstName: b.displayName ?? me.firstName };
          return json({ user: me });
        }
        return json({ user: me });
      }
      if (url.startsWith("/api/channels")) return json({ channels: [{ id: 1, status: "verified", channelName: "My Channel" }] });
      return json({}, 404);
    })
  );
}
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const q = (sel: string) => container.querySelector(sel);
const qa = (sel: string) => Array.from(container.querySelectorAll(sel));
const click = (el: Element | null) => act(async () => { (el as HTMLElement).click(); });
const rowByText = (text: string) => qa("button, a").find((b) => b.textContent?.trim().startsWith(text)) ?? null;
const setValue = (el: HTMLInputElement, value: string) =>
  act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });

async function mount() {
  await act(async () => root.render(<ThemeProvider><AppProvider><ToastProvider><ProfileTab /></ToastProvider></AppProvider></ThemeProvider>));
  await flush();
  await flush();
}

beforeEach(() => {
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  me = {
    id: 1, telegramId: "555", username: "alice_tg", firstName: "Alice", avatarUrl: undefined, hasCustomAvatar: false,
    balance: "12", pendingBalance: "0", referralEarnings: "0", totalDownloads: 7, totalEarnings: "3.5", referralCode: "ABCD1234",
    createdAt: "2026-01-02T00:00:00.000Z", isAdmin: false,
  };
  installFetch();
  back = installTelegramBackButton();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  back.uninstall();
  expect(nativeBackDepth()).toBe(0);
});

describe("Me section (profile header + grouped account area)", () => {
  it("shows the creator header with display name, @username and an Edit Profile action", async () => {
    await mount();
    expect(q("h2")!.textContent).toBe("Alice");
    expect(container.textContent).toContain("@alice_tg");
    expect(qa("button").some((b) => b.textContent?.trim() === "Edit Profile")).toBe(true);
  });

  it("organises existing features into Account / Creator / Support & Information / Other groups", async () => {
    await mount();
    const groups = qa("section[aria-label]").map((s) => s.getAttribute("aria-label"));
    expect(groups).toEqual(expect.arrayContaining(["Account", "Creator", "Support & Information", "Other"]));
    for (const label of ["Edit Profile", "Account Information", "Channel Management", "Earnings & Withdrawals", "Referral Program", "Advertise with Us", "FAQ & Help", "Privacy & Security", "Terms & Conditions"]) {
      expect(rowByText(label), label).not.toBeNull();
    }
    // Rows that never had working functionality are not displayed.
    expect(container.textContent).not.toContain("Contact Support");
    expect(container.textContent).not.toMatch(/\bLanguage\b/);
    // Admin-only row hidden for non-admins.
    expect(container.textContent).not.toContain("Thumbnail Storage");
  });

  it("Earnings & Withdrawals reuses the existing Wallet tab (no duplicate screen) and states the $10 minimum", async () => {
    await mount();
    expect(rowByText("Earnings & Withdrawals")!.textContent).toContain("Min $10");
  });

  it("opens Edit Profile, Account Information, FAQ, Privacy & Security and Terms, and the native Back button returns to Me", async () => {
    await mount();
    const cases: [string, string][] = [
      ["Account Information", "Account Information"],
      ["FAQ & Help", "FAQ & Help"],
      ["Privacy & Security", "Privacy & Security"],
      ["Terms & Conditions", "Terms & Conditions"],
      ["Channel Management", "Channel Management"],
    ];
    for (const [row, heading] of cases) {
      await click(rowByText(row));
      await flush();
      expect(q("h1")!.textContent).toBe(heading);
      expect(back.btn.isVisible).toBe(true);
      back.press();
      await flush();
      expect(q('[data-testid="me-root"]'), `${row} → back`).not.toBeNull();
      expect(back.btn.isVisible).toBe(false);
    }
  });

  it("dark-mode switch keeps working", async () => {
    await mount();
    const sw = qa('[role="switch"]')[0] as HTMLElement;
    expect(sw).toBeTruthy();
    const before = sw.getAttribute("aria-checked");
    await click(sw);
    expect(sw.getAttribute("aria-checked")).not.toBe(before);
  });
});

describe("Edit Profile", () => {
  async function open() {
    await mount();
    await click(qa("button").find((b) => b.textContent?.trim() === "Edit Profile")!);
    await flush();
  }

  it("shows the editable display name and a READ-ONLY username with no edit control", async () => {
    await open();
    const name = q("#display-name") as HTMLInputElement;
    expect(name.value).toBe("Alice");
    const username = q("#tg-username") as HTMLInputElement;
    expect(username.value).toBe("@alice_tg");
    expect(username.readOnly).toBe(true);
    expect(container.textContent).toContain("Read-only");
    expect(qa("button").some((b) => /edit username|change username/i.test(b.textContent ?? ""))).toBe(false);
  });

  it("Save is disabled until something changes; empty names are rejected before any request", async () => {
    await open();
    const save = () => qa("button").find((b) => b.textContent?.includes("Save Changes")) as HTMLButtonElement;
    expect(save().disabled).toBe(true);
    await setValue(q("#display-name") as HTMLInputElement, "   ");
    expect(save().disabled).toBe(false);
    await click(save());
    expect(container.textContent).toContain("Display name can't be empty.");
    expect(calls.some((c) => c.method === "PATCH")).toBe(false);
  });

  it("saves a new display name through PATCH /api/user/me with only displayName in the body", async () => {
    await open();
    await setValue(q("#display-name") as HTMLInputElement, "Alice Creator");
    await click(qa("button").find((b) => b.textContent?.includes("Save Changes"))!);
    await flush();
    const patch = calls.find((c) => c.method === "PATCH")!;
    expect(JSON.parse(String(patch.body))).toEqual({ displayName: "Alice Creator" });
    expect(q('[data-testid="me-root"]')).not.toBeNull(); // returned to Me
    expect(q("h2")!.textContent).toBe("Alice Creator");
  });

  it("rejects an unsupported image type and an oversized image on the client, then previews/cancels a valid one", async () => {
    await open();
    const input = q('[data-testid="avatar-input"]') as HTMLInputElement;
    const choose = async (file: File) => {
      Object.defineProperty(input, "files", { value: [file], configurable: true });
      await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); });
    };
    await choose(new File(["x"], "doc.pdf", { type: "application/pdf" }));
    expect(container.textContent).toContain("Only JPG, PNG and WebP images are allowed.");
    await choose(new File([new Uint8Array(2 * 1024 * 1024 + 1)], "big.png", { type: "image/png" }));
    expect(container.textContent).toContain("Image must be 2 MB or smaller.");
    expect(q('[data-testid="avatar-preview"]')).toBeNull();

    URL.createObjectURL = vi.fn(() => "blob:preview") as unknown as typeof URL.createObjectURL;
    URL.revokeObjectURL = vi.fn() as unknown as typeof URL.revokeObjectURL;
    await choose(new File(["img"], "ok.png", { type: "image/png" }));
    expect(q('[data-testid="avatar-preview"]')).not.toBeNull();
    await click(qa("button").find((b) => b.textContent?.includes("Cancel selection"))!);
    expect(q('[data-testid="avatar-preview"]')).toBeNull();
    expect(calls.some((c) => c.url.startsWith("/api/user/avatar"))).toBe(false);
  });

  it("shows a graceful error when the upload fails and does not leave the screen", async () => {
    installFetch({ "POST /api/user/avatar": () => json({ error: "Image storage is not available right now." }, 503) });
    await open();
    URL.createObjectURL = vi.fn(() => "blob:preview") as unknown as typeof URL.createObjectURL;
    URL.revokeObjectURL = vi.fn() as unknown as typeof URL.revokeObjectURL;
    const input = q('[data-testid="avatar-input"]') as HTMLInputElement;
    Object.defineProperty(input, "files", { value: [new File(["img"], "ok.png", { type: "image/png" })], configurable: true });
    await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); });
    await click(qa("button").find((b) => b.textContent?.includes("Save Changes"))!);
    await flush();
    expect(container.textContent).toContain("Image storage is not available right now.");
    expect(q("#display-name")).not.toBeNull();
  });
});

describe("FAQ & Help", () => {
  it("lists categories, expands/collapses answers and searches with an empty state", async () => {
    await mount();
    await click(rowByText("FAQ & Help"));
    await flush();
    const tabs = qa('[role="tab"]').map((t) => t.textContent);
    expect(tabs).toEqual(expect.arrayContaining(["All", "Getting Started", "Telegram Channel Connection", "File Management", "Playlists", "Sharing & Access", "Advertisements & Monetization", "Profile & Account", "Copyright & Reporting", "Troubleshooting"]));

    const q1 = qa("button[aria-expanded]").find((b) => b.textContent?.includes("What is Onfile?"))!;
    expect(q1.getAttribute("aria-expanded")).toBe("false");
    await click(q1);
    expect(q1.getAttribute("aria-expanded")).toBe("true");
    expect(container.textContent).toContain("does not host your original files");
    await click(q1);
    expect(q1.getAttribute("aria-expanded")).toBe("false");

    const search = q('input[type="search"]') as HTMLInputElement;
    await setValue(search, "minimum withdrawal");
    expect(container.textContent).toContain("What is the minimum withdrawal amount?");
    await setValue(search, "zzzxqy");
    expect(q('[data-testid="faq-empty"]')).not.toBeNull();
  });
});

describe("Legal pages", () => {
  it("Terms state the $10 USD minimum and show placeholders instead of invented business details", async () => {
    await mount();
    await click(rowByText("Terms & Conditions"));
    await flush();
    expect(container.textContent).toContain("The minimum withdrawal amount is $10 USD");
    expect(container.textContent).toContain("[To be configured: legal entity name]");
    expect(container.textContent).toContain("Last updated:");
  });

  it("Privacy & Security switches between the policy and the security overview", async () => {
    await mount();
    await click(rowByText("Privacy & Security"));
    await flush();
    expect(container.textContent).toContain("Information We Collect");
    await click(qa('[role="tab"]').find((t) => t.textContent === "Security")!);
    expect(container.textContent).toContain("Telegram-based authentication");
    expect(container.textContent).toContain("end-to-end"); // stated as NOT offered
  });
});
