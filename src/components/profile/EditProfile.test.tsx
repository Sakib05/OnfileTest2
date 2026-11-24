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
  saveDisplayName: vi.fn(async () => null),
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
  api.saveDisplayName.mockReset().mockImplementation(async () => null);
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

describe("Edit Profile (display name only)", () => {
  it("Save is disabled when nothing changed", async () => {
    await render();
    expect(save().disabled).toBe(true);
  });

  it("username is read-only text with a lock icon and no 'Managed by Telegram' label", async () => {
    await render();
    const box = q("username-readonly");
    expect(box.textContent).toContain("@tg_user");
    expect(box.textContent).not.toContain("Managed by Telegram");
    expect(box.querySelector("[data-testid='username-lock']")).toBeTruthy();
    expect(box.querySelector("input")).toBeNull();
    expect(container.querySelectorAll("input[type=text], input:not([type])").length).toBe(1); // only Display name
  });

  it("exposes no picture upload / change / remove / crop controls", async () => {
    await render();
    expect(container.querySelector("input[type=file]")).toBeNull();
    expect(container.textContent).not.toMatch(/upload photo|change photo|remove|discard|crop/i);
    expect(document.querySelector('[data-testid="avatar-cropper"]')).toBeNull();
  });

  it("shows the Telegram photo, and initials when there is none", async () => {
    await render();
    expect(container.querySelector("img")?.getAttribute("src")).toBe(base.avatarUrl);
    currentUser = { ...base, avatarUrl: undefined };
    await act(async () => root.unmount());
    root = createRoot(container);
    await render();
    expect(container.querySelector("img")).toBeNull();
  });

  it("editing the name enables Save and PATCHes only the display name", async () => {
    await render();
    await type("  New   Name ");
    expect(save().disabled).toBe(false);
    await act(async () => save().click());
    expect(api.saveDisplayName).toHaveBeenCalledWith("New Name");
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

  it("a failed save shows the server error and can be retried", async () => {
    api.saveDisplayName.mockRejectedValueOnce(new Error("Server said no"));
    await render();
    await type("Another");
    await act(async () => save().click());
    expect(q("edit-profile-error").textContent).toContain("Server said no");
    expect(onDone).not.toHaveBeenCalled();
    expect(save().disabled).toBe(false);
    await act(async () => save().click());
    expect(onDone).toHaveBeenCalled();
  });

  it("double-tapping Save submits once", async () => {
    let resolve!: () => void;
    api.saveDisplayName.mockImplementationOnce(() => new Promise<null>((r) => { resolve = () => r(null); }));
    await render();
    await type("Double");
    await act(async () => { save().click(); save().click(); });
    expect(api.saveDisplayName).toHaveBeenCalledTimes(1);
    expect(save().textContent).toContain("Saving");
    await act(async () => resolve());
  });
});
