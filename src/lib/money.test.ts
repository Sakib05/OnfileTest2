import { describe, expect, it } from "vitest";
import {
  checkWithdrawalAmount,
  microToDecimalString,
  MIN_WITHDRAWAL_MESSAGE,
  MIN_WITHDRAWAL_MICRO,
  parseMoneyToMicro,
} from "./money";

describe("minimum withdrawal constant", () => {
  it("is exactly $10 with the documented message", () => {
    expect(MIN_WITHDRAWAL_MICRO).toBe(10_000_000);
    expect(MIN_WITHDRAWAL_MESSAGE).toBe("Minimum withdrawal amount is $10.");
  });
});

describe("parseMoneyToMicro (no floating point)", () => {
  it("parses exact decimals", () => {
    expect(parseMoneyToMicro("10")).toBe(10_000_000);
    expect(parseMoneyToMicro("10.01")).toBe(10_010_000);
    expect(parseMoneyToMicro("9.99")).toBe(9_990_000);
    expect(parseMoneyToMicro("0.000001")).toBe(1);
    expect(parseMoneyToMicro(" 12.5 ")).toBe(12_500_000);
    expect(parseMoneyToMicro(10.01)).toBe(10_010_000);
    expect(parseMoneyToMicro(0.1 + 0.2)).toBeNull(); // 0.30000000000000004 has > 6 decimals → rejected, not rounded
  });
  it("rejects anything that is not a plain non-negative decimal", () => {
    for (const bad of ["", "abc", "-1", "1e3", "1,5", "0x10", "NaN", "Infinity", "1.0000001", ".5", "5.", "1 000", null, undefined, {}, [], true, NaN, Infinity, -5, "9999999999"]) {
      expect(parseMoneyToMicro(bad)).toBeNull();
    }
  });
});

describe("microToDecimalString", () => {
  it("round-trips with numeric(18,6) formatting", () => {
    expect(microToDecimalString(10_000_000)).toBe("10.000000");
    expect(microToDecimalString(10_010_000)).toBe("10.010000");
    expect(microToDecimalString(1)).toBe("0.000001");
    expect(microToDecimalString(parseMoneyToMicro("123456.654321")!)).toBe("123456.654321");
  });
});

describe("checkWithdrawalAmount — the $10 minimum", () => {
  it("rejects $9.99 and anything just below $10", () => {
    for (const v of ["9.99", 9.99, "9.999999", "0.01", "1", 5]) {
      const r = checkWithdrawalAmount(v);
      expect(r).toMatchObject({ ok: false, code: "below_minimum", message: "Minimum withdrawal amount is $10." });
    }
  });
  it("accepts $10.00 and $10.01", () => {
    expect(checkWithdrawalAmount("10")).toMatchObject({ ok: true, decimal: "10.000000" });
    expect(checkWithdrawalAmount("10.00")).toMatchObject({ ok: true, decimal: "10.000000" });
    expect(checkWithdrawalAmount(10.01)).toMatchObject({ ok: true, decimal: "10.010000" });
  });
  it("rejects malformed and non-positive amounts as invalid", () => {
    for (const v of ["abc", "0", "-10", "1e2", "", undefined, null, "10.1234567"]) {
      expect(checkWithdrawalAmount(v)).toMatchObject({ ok: false, code: "invalid_amount" });
    }
  });
});
