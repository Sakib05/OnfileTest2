import { describe, expect, it } from "vitest";
import { getDbbyteConfig, normalizeEnvValue } from "./config";
import { getThumbnailStorage } from "./storage";
import { validatePlaylistInput, parsePositiveId } from "../playlists";
import { validatePublishPayload } from "../publishing/validation";

describe("env normalisation (root cause class of 'Invalid or revoked API key' with a good key)", () => {
  const good = "dbk_abc123";
  it.each([
    [`"${good}"`, "double quotes"],
    [`'${good}'`, "single quotes"],
    [`${good}\n`, "trailing newline"],
    [`  ${good}  `, "surrounding spaces"],
    [`Bearer ${good}`, "Bearer prefix"],
    [`DBBYTE_API_KEY=${good}`, "NAME= prefix"],
    [`"Bearer ${good}"\r\n`, "quotes + Bearer + CRLF"],
  ])("cleans %j (%s)", (raw) => {
    expect(normalizeEnvValue(raw, "DBBYTE_API_KEY")).toBe(good);
  });

  it("builds the config from sloppy values and rejects missing ones", () => {
    const cfg = getDbbyteConfig({ DBBYTE_API_KEY: ` "${good}"\n`, DBBYTE_BUCKET: " onfile-thumbnails ", DBBYTE_CDN_BASE_URL: "https://cdn.dbbyte.com/tok/" } as unknown as NodeJS.ProcessEnv);
    expect(cfg).toEqual({ apiKey: good, bucket: "onfile-thumbnails", cdnBaseUrl: "https://cdn.dbbyte.com/tok", apiBaseUrl: "https://api.dbbyte.com" });
    expect(getDbbyteConfig({ DBBYTE_API_KEY: good } as unknown as NodeJS.ProcessEnv)).toBeNull();
  });
});

describe("storage provider selection", () => {
  const env = { DBBYTE_API_KEY: "k", DBBYTE_BUCKET: "b", DBBYTE_CDN_BASE_URL: "https://c" };
  it("defaults to dbbyte, and an unknown provider yields null (UI shows 'unavailable')", () => {
    expect(getThumbnailStorage(env as unknown as NodeJS.ProcessEnv)?.provider).toBe("dbbyte");
    expect(getThumbnailStorage({ ...env, THUMBNAIL_STORAGE_PROVIDER: "nope" } as unknown as NodeJS.ProcessEnv)).toBeNull();
    expect(getThumbnailStorage({} as unknown as NodeJS.ProcessEnv)).toBeNull();
  });
});

describe("validatePlaylistInput", () => {
  it("requires a title and trims it", () => {
    expect(validatePlaylistInput({ title: "  " })).toMatchObject({ ok: false, errors: { title: "Playlist title is required." } });
    expect(validatePlaylistInput({})).toMatchObject({ ok: false });
    expect(validatePlaylistInput(null)).toMatchObject({ ok: false });
    expect(validatePlaylistInput({ title: "  Hi  " })).toEqual({ ok: true, value: { title: "Hi", description: null, password: null, starsPrice: 0 } });
  });
  it("bounds stars, title, description and rejects wrong types", () => {
    expect(validatePlaylistInput({ title: "a", starsPrice: -1 })).toMatchObject({ ok: false });
    expect(validatePlaylistInput({ title: "a", starsPrice: 1.5 })).toMatchObject({ ok: false });
    expect(validatePlaylistInput({ title: "a", starsPrice: "12" })).toMatchObject({ ok: true, value: { starsPrice: 12 } });
    expect(validatePlaylistInput({ title: "a", starsPrice: 10_001 })).toMatchObject({ ok: false });
    expect(validatePlaylistInput({ title: "a".repeat(121) })).toMatchObject({ ok: false });
    expect(validatePlaylistInput({ title: "a", description: 5 })).toMatchObject({ ok: false });
    expect(validatePlaylistInput({ title: "a", password: 5 })).toMatchObject({ ok: false });
  });
  it("parsePositiveId only accepts positive int32 strings", () => {
    expect(parsePositiveId("12")).toBe(12);
    for (const bad of ["0", "-1", "abc", "1.5", "99999999999", "", null, undefined]) expect(parsePositiveId(bad as string)).toBeNull();
  });
});

describe("publish payload thumbnailRef", () => {
  const base = { telegramMessageLink: "https://t.me/c/1/2", title: "T", fileType: "video", monetization: "free" };
  it("accepts a well-formed ref and rejects URLs / junk", () => {
    expect(validatePublishPayload({ ...base, thumbnailRef: "a".repeat(24) })).toMatchObject({ ok: true, value: { thumbnailRef: "a".repeat(24) } });
    expect(validatePublishPayload({ ...base })).toMatchObject({ ok: true, value: { thumbnailRef: null } });
    expect(validatePublishPayload({ ...base, thumbnailRef: "https://evil.example/x.png" })).toMatchObject({ ok: false, errors: { thumbnail: expect.any(String) } });
    expect(validatePublishPayload({ ...base, thumbnailRef: 42 })).toMatchObject({ ok: false });
  });
});
