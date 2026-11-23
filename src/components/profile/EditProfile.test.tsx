// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UserProfile } from "@/contexts/AppContext";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const refreshUser = vi.fn(async () => {});
let currentUser: UserProfile;
vi.mock("@/contexts/AppContext", () => ({ useApp: () => ({ user: currentUser, refreshUser }) }));

const api = vi.hoisted(() => ({ saveDisplayName: vi.fn(async (_name: string) => null as unknown) }));
vi.mock("@/lib/profile/displayNameClient", () => ({ saveDisplayName: api.saveDisplayName }));

import EditProfile from "./EditProfile";
import { ToastProvider } from "@/components/ui/Toast";

const base: UserProfile = {
  id: 1, telegramId: "555", username: "tg_user", firstName: "Tg", displayName: "Tg",
  avatarUrl: "https://t.me/i/userpic/320/abc.jpg",
  balance: "0", pendingBalance: "0", referralEarnings: "0", totalDownloads: 0, totalEarnings: "0",
};

let container: HTMLDivElement;
let root: Root;
const onDone = vi.fn();
beforeEach(() => {
  api.saveDisplayName.mockReset().mockResolvedValue(null);
  refreshUser.mockClear();
  onDone.mockClear();
  currentUser = base;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

const render = () => act(async () => root.render(<ToastProvider><EditProfile onDone={onDone} /></ToastProvider>));
const q = (id: string) => container.querySelector(`[data-testid="${id}"]`) as HTMLElement;
const nameInput = () => container.querySelector("#display-name") as HTMLInputElement;
const save = () => q("save-profile") as HTMLButtonElement;
const type = (value: string) =>
  act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(nameInput(), value);
    nameInput().dispatchEvent(new Event("input", { bubbles: true }));
  });

describe("Edit Profile (custom profile picture temporarily disabled)", () => {
  it("opens with the Display name and Username fields and a disabled Save", async () => {
    await render();
    expect(q("edit-profile-page")).not.toBeNull();
    expect(nameInput().value).toBe("Tg");
    expect(save().disabled).toBe(true);
  });

  it("has NO upload / change / remove picture UI, file picker, cropper or crop controls", async () => {
    await render();
    expect(container.querySelector('input[type="file"]')).toBeNull();
    expect(q("avatar-input")).toBeNull();
    expect(document.querySelector('[data-testid="avatar-cropper"]')).toBeNull();
    const buttons = Array.from(container.querySelectorAll("button")).map((b) => b.textContent ?? "");
    expect(buttons).toEqual(["Save Changes"]); // the only button
    const text = container.textContent ?? "";
    for (const word of ["Upload", "Change photo", "Remove", "Apply Crop", "Zoom", "JPEG, PNG or WebP"]) {
      expect(text).not.toContain(word);
    }
  });

  it("the username is read-only text with ONLY a lock icon — no 'Managed by Telegram' anywhere", async () => {
    await render();
    const box = q("username-readonly");
    expect(box.textContent).toBe("@tg_user");
    expect(box.querySelector("svg")).not.toBeNull(); // lock icon
    expect(box.querySelector("input")).toBeNull();
    expect(container.textContent).not.toContain("Managed by Telegram");
    expect(container.querySelectorAll("input").length).toBe(1); // only Display name is editable
  });

  it("shows the Telegram photo in the avatar (display only, not a button)", async () => {
    await render();
    const avatar = q("edit-profile-avatar");
    expect(avatar.querySelector("img")?.getAttribute("src")).toBe(base.avatarUrl);
    expect(avatar.closest("button")).toBeNull();
  });

  it("falls back to the initials avatar when there is no Telegram photo, or when it fails to load", async () => {
    currentUser = { ...base, avatarUrl: undefined };
    await render();
    expect(q("edit-profile-avatar").querySelector("img")).toBeNull();
    expect(q("edit-profile-avatar").textContent).toBe("T");

    currentUser = base;
    await act(async () => root.render(<ToastProvider><EditProfile key="again" onDone={onDone} /></ToastProvider>));
    await act(async () => void q("edit-profile-avatar").querySelector("img")!.dispatchEvent(new Event("error")));
    expect(q("edit-profile-avatar").querySelector("img")).toBeNull();
    expect(q("edit-profile-avatar").textContent).toBe("T");
  });

  it("a custom picture URL on the profile is ignored while the feature is disabled", async () => {
    currentUser = { ...base, customAvatarUrl: "https://cdn.example.com/b/avatar-1-x.webp" };
    await render();
    expect(container.querySelector("img")?.getAttribute("src")).toBe(base.avatarUrl);
  });

  it("editing the name enables Save and saves only the (normalised) display name", async () => {
    await render();
    await type("  New   Name ");
    expect(save().disabled).toBe(false);
    await act(async () => save().click());
    expect(api.saveDisplayName).toHaveBeenCalledWith("New Name");
    expect(refreshUser).toHaveBeenCalled();
    expect(onDone).toHaveBeenCalled();
  });

  it("shows the 64-character limit and counter", async () => {
    await render();
    expect(container.textContent).toContain("/64");
    await type("a".repeat(65));
    expect(save().disabled).toBe(true);
    expect(container.textContent).toContain("64 characters or fewer");
    await type("a".repeat(64));
    expect(save().disabled).toBe(false);
  });

  it("an invalid name shows an error and keeps Save disabled", async () => {
    await render();
    await type("<b>x</b>");
    expect(save().disabled).toBe(true);
    expect(nameInput().getAttribute("aria-invalid")).toBe("true");
  });

  it("clearing a custom name sends '' (revert to the Telegram name)", async () => {
    currentUser = { ...base, displayName: "Mine", displayNameCustom: "Mine" };
    await render();
    await type("");
    expect(save().disabled).toBe(false);
    await act(async () => save().click());
    expect(api.saveDisplayName).toHaveBeenCalledWith("");
  });

  it("typing the Telegram name when no custom name exists is not a change", async () => {
    await render();
    await type("Tg");
    expect(save().disabled).toBe(true);
  });

  it("loading state: Save shows 'Saving…', is disabled and submits once on a double tap", async () => {
    let resolve!: () => void;
    api.saveDisplayName.mockImplementationOnce(() => new Promise((r) => { resolve = () => r(null); }));
    await render();
    await type("Another");
    await act(async () => { save().click(); save().click(); });
    expect(save().disabled).toBe(true);
    expect(save().textContent).toContain("Saving");
    expect(nameInput().disabled).toBe(true);
    expect(api.saveDisplayName).toHaveBeenCalledTimes(1);
    await act(async () => resolve());
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("error state: shows the server message, stays on the page and Save can be retried", async () => {
    let reject!: (e: Error) => void;
    api.saveDisplayName.mockImplementationOnce(() => new Promise((_, r) => { reject = r; }));
    await render();
    await type("Another");
    await act(async () => save().click());
    await act(async () => reject(new Error("Server said no")));
    expect(q("edit-profile-error").textContent).toBe("Server said no");
    expect(onDone).not.toHaveBeenCalled();
    expect(save().disabled).toBe(false);
  });
});
