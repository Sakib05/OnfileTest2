// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ProfileCard from "./ProfileCard";
import { ToastProvider } from "@/components/ui/Toast";
import type { UserProfile } from "@/contexts/AppContext";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const user: UserProfile = {
  id: 42, // internal primary key — must NEVER be displayed or copied
  telegramId: "7219198879",
  username: "sakib_tg",
  firstName: "Sakib",
  displayName: "Sakib",
  avatarUrl: "https://t.me/i/userpic/320/abc.jpg",
  balance: "0",
  pendingBalance: "0",
  referralEarnings: "0",
  totalDownloads: 12,
  totalEarnings: "99",
};

let container: HTMLDivElement;
let root: Root;
const writeText = vi.fn();
beforeEach(() => {
  writeText.mockReset();
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

const render = (props: Partial<React.ComponentProps<typeof ProfileCard>> = {}) =>
  act(async () =>
    root.render(
      <ToastProvider>
        <ProfileCard user={user} isCreator onEdit={() => {}} {...props} />
      </ToastProvider>
    )
  );
const q = (id: string) => container.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;

describe("ProfileCard", () => {
  it("shows name, Creator badge, 'ID: <telegram id>', copy and edit controls", async () => {
    await render();
    expect(q("profile-name")?.textContent).toBe("Sakib");
    expect(q("creator-badge")?.textContent).toContain("Creator");
    expect(q("profile-id")?.textContent).toBe("ID: 7219198879");
    expect(q("copy-id")).toBeTruthy();
    expect(q("edit-profile")?.getAttribute("aria-label")).toBe("Edit profile");
  });

  it("shows the Telegram id, never the internal primary key, and never the @username", async () => {
    await render();
    const text = container.textContent ?? "";
    expect(text).toContain("7219198879");
    expect(text).not.toContain("sakib_tg");
    expect(text).not.toContain("@");
    expect(text).not.toMatch(/\b42\b/);
  });

  it("has no Files / Downloads / Earned statistics", async () => {
    await render();
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/Files|Downloads|Earned/);
    expect(text).not.toContain("$99");
  });

  it("shows the Creator badge only for creators", async () => {
    await render({ isCreator: false });
    expect(q("creator-badge")).toBeNull();
  });

  it("uses the custom display name when set", async () => {
    await render({ user: { ...user, displayName: "Custom Me", displayNameCustom: "Custom Me" } });
    expect(q("profile-name")?.textContent).toBe("Custom Me");
  });

  it("copy button copies EXACTLY the Telegram id (no label, no spaces) and confirms", async () => {
    writeText.mockResolvedValue(undefined);
    await render();
    await act(async () => q("copy-id")!.click());
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith("7219198879");
    expect(q("copy-id")?.getAttribute("aria-label")).toBe("Telegram ID copied");
    expect(document.body.textContent).toContain("Telegram ID copied");
  });

  it("handles a clipboard failure gracefully (no throw, error message shown)", async () => {
    writeText.mockRejectedValue(new Error("denied"));
    (document as unknown as { execCommand: () => boolean }).execCommand = () => false;
    await render();
    await act(async () => q("copy-id")!.click());
    expect(document.body.textContent).toContain("Couldn't copy automatically");
    expect(q("copy-id")?.getAttribute("aria-label")).toBe("Copy Telegram ID");
  });

  it("pencil calls onEdit", async () => {
    const onEdit = vi.fn();
    await render({ onEdit });
    await act(async () => q("edit-profile")!.click());
    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  it("renders a stable skeleton (no id / copy / badge) while the user is loading", async () => {
    await render({ user: null, isCreator: false });
    expect(q("profile-id")).toBeNull();
    expect(q("copy-id")).toBeNull();
    expect(q("edit-profile")).toBeTruthy();
  });

  it("hides the copy button when no Telegram id is available", async () => {
    await render({ user: { ...user, telegramId: undefined } });
    expect(q("copy-id")).toBeNull();
    expect(q("profile-id")?.textContent).toBe("ID: —");
  });

  it("avatar: shows the Telegram photo (custom picture is ignored while the feature is disabled)", async () => {
    await render({ user: { ...user, customAvatarUrl: "https://cdn.example.com/b/avatar-42-x.webp" } });
    expect(container.querySelector("img")?.getAttribute("src")).toBe(user.avatarUrl);
  });

  it("avatar: falls back to initials when there is no Telegram photo, or it fails to load — never a broken image", async () => {
    await render({ user: { ...user, avatarUrl: undefined } });
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector('[role="img"]')?.textContent).toBe("S");

    await render();
    await act(async () => void container.querySelector("img")!.dispatchEvent(new Event("error")));
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector('[role="img"]')?.textContent).toBe("S");
  });

  it("does not show Files / Downloads / Earned statistics or a settings gear", async () => {
    await render();
    const text = container.textContent ?? "";
    for (const w of ["Files", "Downloads", "Earned"]) expect(text).not.toContain(w);
    expect(container.querySelector('[aria-label*="ettings"]')).toBeNull();
  });
});
