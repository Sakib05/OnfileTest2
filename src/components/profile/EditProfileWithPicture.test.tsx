// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UserProfile } from "@/contexts/AppContext";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// This (disabled) screen is tested as it behaves when the custom picture feature is switched back on.
vi.mock("@/lib/profile/featureFlags", () => ({ CUSTOM_PROFILE_PICTURE_ENABLED: true }));

const refreshUser = vi.fn(async () => {});
let currentUser: UserProfile;
vi.mock("@/contexts/AppContext", () => ({ useApp: () => ({ user: currentUser, refreshUser }) }));

const api = vi.hoisted(() => ({
  uploadAvatar: vi.fn(async () => null),
  removeAvatar: vi.fn(async () => null),
  saveDisplayName: vi.fn(async () => null),
}));
// Decoding/exporting need a real browser; the cropper UI itself is exercised for real below.
const img = vi.hoisted(() => ({
  loadCropImage: vi.fn(),
  exportCrop: vi.fn(),
}));
vi.mock("@/lib/profile/avatarImage", async () => {
  const actual = await vi.importActual<typeof import("@/lib/profile/avatarImage")>("@/lib/profile/avatarImage");
  return { ...actual, ...img };
});
vi.mock("@/lib/profile/avatarClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/profile/avatarClient")>("@/lib/profile/avatarClient");
  return { ...actual, ...api };
});

import EditProfile from "./EditProfileWithPicture";
import { AvatarError } from "@/lib/profile/avatarErrors";
import { ToastProvider } from "@/components/ui/Toast";

const base: UserProfile = {
  id: 1, telegramId: "555", username: "tg_user", firstName: "Tg", displayName: "Tg",
  avatarUrl: "https://t.me/i/userpic/320/abc.jpg",
  balance: "0", pendingBalance: "0", referralEarnings: "0", totalDownloads: 0, totalEarnings: "0",
};

let container: HTMLDivElement;
let root: Root;
const onDone = vi.fn();
const croppedFile = () => new File([new Uint8Array([1, 2, 3])], "avatar.webp", { type: "image/webp" });
const fakeCropImage = () => {
  const canvas = document.createElement("canvas");
  canvas.width = 1200;
  canvas.height = 800;
  return { canvas, width: 1200, height: 800, originalWidth: 4000, originalHeight: 2667, format: "jpeg", decoder: "test", release: vi.fn() };
};
beforeEach(() => {
  Object.values(api).forEach((m) => m.mockClear());
  img.loadCropImage.mockReset().mockImplementation(async () => fakeCropImage());
  img.exportCrop.mockReset().mockImplementation(async () => croppedFile());
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation((() => ({ fillRect: vi.fn(), drawImage: vi.fn() })) as never);
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
  vi.restoreAllMocks();
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

  it("username is read-only text with only a lock icon — not an input", async () => {
    await render();
    const box = q("username-readonly");
    expect(box.textContent).toContain("@tg_user");
    expect(box.textContent).not.toContain("Managed by Telegram");
    expect(box.querySelector("svg")).not.toBeNull();
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

  const crop = (id: string) => act(async () => void (document.querySelector(`[data-testid="${id}"]`) as HTMLButtonElement).click());
  const cropper = () => document.querySelector('[data-testid="avatar-cropper"]');

  it("choosing a picture opens the crop editor; nothing is staged or uploaded yet", async () => {
    await render();
    await pick(new File([new Uint8Array([1, 2, 3])], "me.png", { type: "image/png" }));
    expect(img.loadCropImage).toHaveBeenCalledTimes(1);
    expect(cropper()).not.toBeNull();
    expect(save().disabled).toBe(true); // no crop applied yet
    expect(api.uploadAvatar).not.toHaveBeenCalled();
  });

  it("Apply Crop stages the cropped preview and enables Save — the upload happens only on Save", async () => {
    await render();
    await pick(new File([new Uint8Array([1, 2, 3])], "me.png", { type: "image/png" }));
    await crop("crop-apply");
    expect(cropper()).toBeNull();
    expect(img.exportCrop).toHaveBeenCalledTimes(1);
    expect(container.querySelector("img")?.getAttribute("src")).toBe("blob:test/1");
    expect(save().disabled).toBe(false);
    expect(api.uploadAvatar).not.toHaveBeenCalled(); // nothing is written before Save
    await act(async () => save().click());
    expect(api.uploadAvatar).toHaveBeenCalledTimes(1);
    expect((api.uploadAvatar.mock.calls[0] as unknown as [File])[0].type).toBe("image/webp");
    expect(api.saveDisplayName).not.toHaveBeenCalled();
    expect(onDone).toHaveBeenCalled();
  });

  it("Cancel in the crop editor discards it: no preview, Save stays disabled, working canvas released", async () => {
    await render();
    const released = fakeCropImage();
    img.loadCropImage.mockResolvedValueOnce(released);
    await pick(new File([new Uint8Array([1, 2, 3])], "me.png", { type: "image/png" }));
    await crop("crop-cancel");
    expect(cropper()).toBeNull();
    expect(released.release).toHaveBeenCalled();
    expect(container.querySelector("img")?.getAttribute("src")).toBe(base.avatarUrl);
    expect(save().disabled).toBe(true);
    expect(api.uploadAvatar).not.toHaveBeenCalled();
  });

  it("replacing an existing custom picture uploads the new crop (no separate delete call)", async () => {
    currentUser = { ...base, customAvatarUrl: "https://cdn.example.com/b/avatar-1-old.webp" };
    await render();
    await pick(new File([new Uint8Array([1])], "new.jpg", { type: "image/jpeg" }));
    await crop("crop-apply");
    await act(async () => save().click());
    expect(api.uploadAvatar).toHaveBeenCalledTimes(1);
    expect(api.removeAvatar).not.toHaveBeenCalled();
  });

  it("an unsupported / unreadable photo shows its specific reason and never opens the editor", async () => {
    img.loadCropImage.mockRejectedValueOnce(new AvatarError("heic_unsupported"));
    await render();
    await pick(new File([new Uint8Array([1])], "IMG_1.jpg", { type: "image/jpeg" }));
    expect(cropper()).toBeNull();
    expect(q("edit-profile-error").textContent).toMatch(/HEIC/);
    expect(q("edit-profile-error").textContent).not.toMatch(/corrupt/i);

    img.loadCropImage.mockRejectedValueOnce(new AvatarError("decode_failed"));
    await pick(new File([new Uint8Array([1])], "big.jpg", { type: "image/jpeg" }));
    expect(q("edit-profile-error").textContent).toMatch(/too large to process|couldn't open/i);
  });

  it("a failed upload keeps the staged crop + the saved picture, explains the cause, and Save can be retried", async () => {
    currentUser = { ...base, customAvatarUrl: "https://cdn.example.com/b/avatar-1-old.webp" };
    api.uploadAvatar.mockRejectedValueOnce(new AvatarError("storage_failed"));
    await render();
    await pick(new File([new Uint8Array([1])], "new.jpg", { type: "image/jpeg" }));
    await crop("crop-apply");
    await act(async () => save().click());
    expect(q("edit-profile-error").textContent).toMatch(/storage.*unchanged/i);
    expect(onDone).not.toHaveBeenCalled();
    expect(save().disabled).toBe(false); // can retry
    await act(async () => btn("Discard")!.click()); // discarding falls back to the SAVED picture
    expect(container.querySelector("img")?.getAttribute("src")).toBe("https://cdn.example.com/b/avatar-1-old.webp");
    // retry path
    await pick(new File([new Uint8Array([1])], "new.jpg", { type: "image/jpeg" }));
    await crop("crop-apply");
    await act(async () => save().click());
    expect(api.uploadAvatar).toHaveBeenCalledTimes(2);
    expect(onDone).toHaveBeenCalled();
  });

  it("network failure while saving shows the connection message", async () => {
    api.uploadAvatar.mockRejectedValueOnce(new AvatarError("network"));
    await render();
    await pick(new File([new Uint8Array([1])], "new.jpg", { type: "image/jpeg" }));
    await crop("crop-apply");
    await act(async () => save().click());
    expect(q("edit-profile-error").textContent).toMatch(/connection/i);
  });

  it("double-tapping Save uploads once", async () => {
    let resolve!: () => void;
    api.uploadAvatar.mockImplementationOnce(() => new Promise<null>((r) => { resolve = () => r(null); }));
    await render();
    await pick(new File([new Uint8Array([1])], "new.jpg", { type: "image/jpeg" }));
    await crop("crop-apply");
    await act(async () => { save().click(); save().click(); });
    expect(api.uploadAvatar).toHaveBeenCalledTimes(1);
    expect(save().textContent).toContain("Saving");
    await act(async () => resolve());
  });

  it("rejects non-image files before doing anything", async () => {
    await render();
    await pick(new File(["x"], "evil.pdf", { type: "application/pdf" }));
    expect(q("edit-profile-error").textContent).toContain("isn't supported");
    expect(img.loadCropImage).not.toHaveBeenCalled();
    expect(cropper()).toBeNull();
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
