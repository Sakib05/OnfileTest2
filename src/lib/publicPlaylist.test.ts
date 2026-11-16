import { describe, expect, it } from "vitest";
import { hashAccessPassword } from "./password";
import { generateShareSlug, lockFor, makeUnlockToken, publicOrigin, unlockCookieName, verifyUnlockToken } from "./publicPlaylist";
import { isValidShareSlug } from "./playlistSharing";

type Row = Parameters<typeof lockFor>[0];
const row = (over: Partial<Row> = {}) => ({ id: 7, userId: 1, title: "t", password: null, starsPrice: 0, isPublished: true, shareSlug: "x", ...over }) as Row;

describe("share tokens", () => {
  it("are random, URL-safe, valid and unique", () => {
    const set = new Set(Array.from({ length: 500 }, generateShareSlug));
    expect(set.size).toBe(500);
    for (const s of set) expect(isValidShareSlug(s)).toBe(true);
  });
});

describe("lockFor", () => {
  it("open for plain playlists", () => expect(lockFor(row(), { isOwner: false, unlocked: false })).toBeNull());
  it("password: locked for strangers, open for the unlocked browser and the owner", () => {
    const r = row({ password: hashAccessPassword("pw") });
    expect(lockFor(r, { isOwner: false, unlocked: false })).toBe("password");
    expect(lockFor(r, { isOwner: false, unlocked: true })).toBeNull();
    expect(lockFor(r, { isOwner: true, unlocked: false })).toBeNull();
  });
  it("Stars price: always locked (no payment backend) — even for an unlocked browser or the owner", () => {
    const r = row({ starsPrice: 10, password: hashAccessPassword("pw") });
    expect(lockFor(r, { isOwner: false, unlocked: true })).toBe("stars");
    expect(lockFor(r, { isOwner: true, unlocked: true })).toBe("stars");
  });
});

describe("unlock cookie token", () => {
  const pw = hashAccessPassword("secret");
  it("verifies only the token derived from this playlist's stored hash", () => {
    const r = row({ password: pw });
    const t = makeUnlockToken(r);
    expect(verifyUnlockToken(r, t)).toBe(true);
    expect(verifyUnlockToken(r, "00" + t.slice(2))).toBe(false);
    expect(verifyUnlockToken(r, "")).toBe(false);
    expect(verifyUnlockToken(r, undefined)).toBe(false);
    expect(verifyUnlockToken(r, "not-hex")).toBe(false);
    expect(verifyUnlockToken(row({ id: 8, password: pw }), t)).toBe(false); // other playlist
    expect(verifyUnlockToken(row({ password: hashAccessPassword("secret") }), t)).toBe(false); // password changed → new salt/hash
    expect(verifyUnlockToken(row({ password: null }), t)).toBe(false); // a playlist without a password never "unlocks"
  });
  it("has a cookie name derived from the token", () => expect(unlockCookieName("abc")).toBe("onfile_pl_abc"));
});

describe("publicOrigin", () => {
  const mk = (h: Record<string, string>) => new Request("http://internal:3000/x", { headers: h });
  it("uses forwarded host/proto, else host", () => {
    delete process.env.NEXT_PUBLIC_APP_URL;
    expect(publicOrigin(mk({ "x-forwarded-host": "onfile-app.vercel.app", "x-forwarded-proto": "https" }))).toBe("https://onfile-app.vercel.app");
    expect(publicOrigin(mk({ host: "localhost:3000" }))).toBe("http://localhost:3000");
  });
  it("prefers a configured https NEXT_PUBLIC_APP_URL", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://app.example.com/";
    expect(publicOrigin(mk({ host: "evil.test" }))).toBe("https://app.example.com");
    delete process.env.NEXT_PUBLIC_APP_URL;
  });
});
