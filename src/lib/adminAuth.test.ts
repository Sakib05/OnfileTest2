import { describe, expect, it } from "vitest";
import { isAdminUser, parseAdminIds } from "./adminAuth";

const env = (v?: string) => ({ ADMIN_TELEGRAM_IDS: v } as unknown as NodeJS.ProcessEnv);
describe("admin gate", () => {
  it("parses a comma-separated list", () => {
    expect(parseAdminIds(env(" 1, 22 ,,333 "))).toEqual(["1", "22", "333"]);
    expect(parseAdminIds(env(undefined))).toEqual([]);
  });
  it("only listed telegram ids are admins; default is nobody", () => {
    expect(isAdminUser({ telegramId: "22" }, env("1,22"))).toBe(true);
    expect(isAdminUser({ telegramId: "23" }, env("1,22"))).toBe(false);
    expect(isAdminUser({ telegramId: null }, env("1,22"))).toBe(false);
    expect(isAdminUser(null, env("1,22"))).toBe(false);
    expect(isAdminUser({ telegramId: "1" }, env(undefined))).toBe(false);
  });
});
