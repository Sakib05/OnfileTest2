import { describe, expect, it } from "vitest";
import { DEFAULT_AVATAR_CHAR, getAvatarInitial, sanitizeAvatarUrl } from "./avatar";

describe("sanitizeAvatarUrl", () => {
  it("accepts Telegram https photo URLs", () => {
    expect(sanitizeAvatarUrl("https://t.me/i/userpic/320/abc.jpg")).toBe("https://t.me/i/userpic/320/abc.jpg");
    expect(sanitizeAvatarUrl("https://cdn4.telegram-cdn.org/file/abc.jpg")).toBe("https://cdn4.telegram-cdn.org/file/abc.jpg");
  });

  it("rejects missing, malformed, non-https and non-Telegram URLs", () => {
    expect(sanitizeAvatarUrl(undefined)).toBeNull();
    expect(sanitizeAvatarUrl(null)).toBeNull();
    expect(sanitizeAvatarUrl("")).toBeNull();
    expect(sanitizeAvatarUrl("not a url")).toBeNull();
    expect(sanitizeAvatarUrl("http://t.me/i/userpic/320/abc.jpg")).toBeNull();
    expect(sanitizeAvatarUrl("javascript:alert(1)")).toBeNull();
    expect(sanitizeAvatarUrl("data:image/png;base64,AAAA")).toBeNull();
    expect(sanitizeAvatarUrl("https://evil.example.com/t.me/a.jpg")).toBeNull();
    expect(sanitizeAvatarUrl("https://nott.me/a.jpg")).toBeNull();
  });
});

describe("getAvatarInitial", () => {
  it("prefers the first character of the first name", () => {
    expect(getAvatarInitial("sakib", "someone")).toBe("S");
  });

  it("falls back to the username when there is no first name", () => {
    expect(getAvatarInitial("", "@onfile_user")).toBe("O");
    expect(getAvatarInitial(undefined, "zed")).toBe("Z");
    expect(getAvatarInitial("   ", "zed")).toBe("Z");
  });

  it("uses a neutral default when nothing is available", () => {
    expect(getAvatarInitial(null, null)).toBe(DEFAULT_AVATAR_CHAR);
    expect(getAvatarInitial("", "@")).toBe(DEFAULT_AVATAR_CHAR);
  });

  it("does not split emoji / non-BMP characters", () => {
    expect(getAvatarInitial("😀 Smile", null)).toBe("😀");
  });
});

import { sanitizeCustomAvatarUrl } from "./avatar";

describe("sanitizeCustomAvatarUrl", () => {
  it("accepts https storage URLs and local blob previews", () => {
    expect(sanitizeCustomAvatarUrl("https://cdn.dbbyte.com/tok/bucket/avatar-1-ab.webp")).toBe("https://cdn.dbbyte.com/tok/bucket/avatar-1-ab.webp");
    expect(sanitizeCustomAvatarUrl("blob:https://onfile-app.vercel.app/1234")).toBe("blob:https://onfile-app.vercel.app/1234");
  });

  it("rejects missing, malformed, http, javascript: and data: URLs", () => {
    expect(sanitizeCustomAvatarUrl(undefined)).toBeNull();
    expect(sanitizeCustomAvatarUrl("")).toBeNull();
    expect(sanitizeCustomAvatarUrl("nope")).toBeNull();
    expect(sanitizeCustomAvatarUrl("http://cdn.example/a.webp")).toBeNull();
    expect(sanitizeCustomAvatarUrl("javascript:alert(1)")).toBeNull();
    expect(sanitizeCustomAvatarUrl("data:image/png;base64,AAAA")).toBeNull();
  });
});
