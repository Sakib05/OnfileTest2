import { describe, expect, it } from "vitest";
import { DISPLAY_NAME_MAX, resolveDisplayName, resolveIdentity, validateDisplayName } from "./identity";

describe("validateDisplayName", () => {
  it("trims and collapses whitespace", () => {
    expect(validateDisplayName("  Sakib   Ahmed ")).toEqual({ ok: true, value: "Sakib Ahmed" });
  });

  it("treats empty / whitespace-only as 'clear the custom name'", () => {
    expect(validateDisplayName("")).toEqual({ ok: true, value: null });
    expect(validateDisplayName("   \n\t ")).toEqual({ ok: true, value: null });
  });

  it("accepts unicode letters and emoji", () => {
    expect(validateDisplayName("Ünal 🚀 नमस्ते")).toEqual({ ok: true, value: "Ünal 🚀 नमस्ते" });
  });

  it("enforces the max length in code points (emoji count once)", () => {
    expect(validateDisplayName("a".repeat(DISPLAY_NAME_MAX)).ok).toBe(true);
    expect(validateDisplayName("🚀".repeat(DISPLAY_NAME_MAX)).ok).toBe(true);
    expect(validateDisplayName("a".repeat(DISPLAY_NAME_MAX + 1)).ok).toBe(false);
    expect(validateDisplayName("a".repeat(5000)).ok).toBe(false);
  });

  it("rejects control chars, bidi/zero-width tricks and angle brackets", () => {
    expect(validateDisplayName("bad\u0000name").ok).toBe(false);
    expect(validateDisplayName("evil\u202Eexe").ok).toBe(false);
    expect(validateDisplayName("zero\u200Bwidth").ok).toBe(false);
    expect(validateDisplayName("<b>hi</b>").ok).toBe(false);
  });

  it("rejects non-strings", () => {
    expect(validateDisplayName(42).ok).toBe(false);
    expect(validateDisplayName(null).ok).toBe(false);
    expect(validateDisplayName(undefined).ok).toBe(false);
  });
});

describe("resolveDisplayName", () => {
  it("prefers the custom name, then the Telegram name", () => {
    expect(resolveDisplayName("Custom", "Telegram")).toBe("Custom");
    expect(resolveDisplayName(null, "Telegram")).toBe("Telegram");
    expect(resolveDisplayName("  ", " Telegram ")).toBe("Telegram");
    expect(resolveDisplayName(null, null)).toBeNull();
  });
});

describe("resolveIdentity", () => {
  const base = { firstName: "Tg", displayNameCustom: null, username: "u", avatarUrl: "https://t.me/i/userpic/a.jpg", profileImageKey: null };
  const urlFor = (k: string) => `https://cdn.example/${k}`;

  it("custom picture URL is present only when a key exists", () => {
    expect(resolveIdentity(base, urlFor).customAvatarUrl).toBeNull();
    expect(resolveIdentity({ ...base, profileImageKey: "avatar-1-x.webp" }, urlFor).customAvatarUrl).toBe("https://cdn.example/avatar-1-x.webp");
  });

  it("a key with unconfigured storage degrades to 'no custom picture' (Telegram photo / initials still show)", () => {
    expect(resolveIdentity({ ...base, profileImageKey: "avatar-1-x.webp" }, () => null).customAvatarUrl).toBeNull();
  });

  it("name falls back to Telegram when the custom name is cleared", () => {
    expect(resolveIdentity({ ...base, displayNameCustom: "Mine" }, urlFor).displayName).toBe("Mine");
    expect(resolveIdentity(base, urlFor).displayName).toBe("Tg");
  });
});
