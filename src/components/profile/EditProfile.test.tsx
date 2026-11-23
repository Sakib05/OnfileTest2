// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UserProfile } from "@/contexts/AppContext";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const refreshUser = vi.fn(async () => {});
let currentUser: UserProfile;
vi.mock("@/contexts/AppContext", () => ({ useApp: () => ({ user: currentUser, refreshUser }) }));

const api = vi.hoisted(() => ({
  uploadAvatar: vi.fn(async () => null),
  removeAvatar: vi.fn(async () => null),
  saveDisplayName: vi.fn(async () => null),
  cropToSquareAvatar: vi.fn(async (f: File) => f),
}));
vi.mock("@/lib/profile/avatarClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/profile/avatarClient")>("@/lib/profile/avatarClient");
  return { ...actual, ...api };
});

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
  Object.values(api).forEach((m) => m.mockClear());
  refreshUser.mockClear();
  onDone.mockClear();
  URL.createObjectURL = vi.fn(() => "blob:test/1");
  URL.revokeObjectURL = vi.fn();
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
const pick = (file: File) =>
  act(async () => {
    const input = q("avatar-input") as HTMLInputElement;
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
const btn = (label: string) => Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.includes(label)) as HTMLButtonElement | undefined;

describe("Edit Profile", () => {
  it("Save is disabled when nothing changed", async () => {
    await render();
    expect(save().disabled).toBe(true);
  });

  it("username is read-only text 'Managed by Telegram' — not an input", async () => {
    await render();
    const box = q("username-readonly");
    expect(box.textContent).toContain("@tg_user");
    expect(box.textContent).toContain("Managed by Telegram");
    expect(box.querySelector("input")).toBeNull();
    expect(container.querySelectorAll("input[type=text], input:not([type])").length).toBe(1); // only Display name
  });

  it("editing the name enables Save and PATCHes only the display name", async () => {
    await render();
    await type("  New   Name ");
    expect(save().disabled).toBe(false);
    await act(async () => save().click());
    expect(api.saveDisplayName).toHaveBeenCalledWith("New Name");
    expect(api.uploadAvatar).not.toHaveBeenCalled();
    expect(api.removeAvatar).not.toHaveBeenCalled();
    expect(refreshUser).toHaveBeenCalled();
    expect(onDone).toHaveBeenCalled();
  });

  it("an invalid name shows an error and keeps Save disabled", async () => {
    await render();
    await type("a".repeat(65));
    expect(save().disabled).toBe(true);
    expect(container.textContent).toContain("64 characters or fewer");
    await type("<b>x</b>");
    expect(save().disabled).toBe(true);
  });

  it("clearing a custom name sends '' (revert to the Telegram name)", async () => {
    currentUser = { ...base, displayName: "Mine", displayNameCustom: "Mine" };
    await render();
    await type("");
    await act(async () => save().click());
    expect(api.saveDisplayName).toHaveBeenCalledWith("");
  });

  it("typing the Telegram name when no custom name exists is not a change", async () => {
    await render();
    await type("Tg");
    expect(save().disabled).toBe(true);
  });

  it("choosing a picture stages a preview, enables Save, and uploads on save", async () => {
    await render();
    await pick(new File([new Uint8Array([1, 2, 3])], "me.png", { type: "image/png" }));
    expect(api.cropToSquareAvatar).toHaveBeenCalled();
    expect(container.querySelector("img")?.getAttribute("src")).toBe("blob:test/1");
    expect(save().disabled).toBe(false);
    expect(api.uploadAvatar).not.toHaveBeenCalled(); // nothing is written before Save
    await act(async () => save().click());
    expect(api.uploadAvatar).toHaveBeenCalledTimes(1);
    expect(api.saveDisplayName).not.toHaveBeenCalled();
    expect(onDone).toHaveBeenCalled();
  });

  it("rejects non-image files before doing anything", async () => {
    await render();
    await pick(new File(["x"], "evil.exe", { type: "application/octet-stream" }));
    expect(q("edit-profile-error").textContent).toContain("Only JPEG, PNG or WebP");
    expect(api.cropToSquareAvatar).not.toHaveBeenCalled();
    expect(save().disabled).toBe(true);
  });

  it("removing an existing custom picture shows the Telegram photo and calls DELETE on save", async () => {
    currentUser = { ...base, customAvatarUrl: "https://cdn.example.com/b/avatar-1-x.webp" };
    await render();
    expect(container.querySelector("img")?.getAttribute("src")).toBe("https://cdn.example.com/b/avatar-1-x.webp");
    await act(async () => btn("Remove")!.click());
    expect(container.querySelector("img")?.getAttribute("src")).toBe(base.avatarUrl); // fallback preview
    expect(save().disabled).toBe(false);
    await act(async () => save().click());
    expect(api.removeAvatar).toHaveBeenCalledTimes(1);
  });

  it("shows an error and stays on the page when saving fails; no duplicate submissions", async () => {
    let reject!: (e: Error) => void;
    api.saveDisplayName.mockImplementationOnce(() => new Promise((_, r) => { reject = r; }));
    await render();
    await type("Another");
    await act(async () => { save().click(); save().click(); }); // double tap
    expect(save().disabled).toBe(true);
    expect(save().textContent).toContain("Saving");
    expect(api.saveDisplayName).toHaveBeenCalledTimes(1);
    await act(async () => reject(new Error("Server said no")));
    expect(q("edit-profile-error").textContent).toBe("Server said no");
    expect(onDone).not.toHaveBeenCalled();
    expect(save().disabled).toBe(false);
  });
});
