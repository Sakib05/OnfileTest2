import { describe, expect, it } from "vitest";
import {
  MIN_WITHDRAWAL_MICRO,
  checkAmount,
  microToDecimalString,
  microToDisplay,
  parseAmount,
  parseBalanceMicro,
  validateWithdrawalAmountInput,
  validateWithdrawalRequest,
} from "./withdrawals";

const ADDRESS = "TXyz1234567890abcdef";

describe("minimum withdrawal ($10 USD)", () => {
  it("rejects amounts below $10 with the minimum message", () => {
    for (const amount of ["9.99", "9.999999", "0.000001", "1", "5", 9.5, "0.5"]) {
      const r = checkAmount(amount);
      expect(r.ok, String(amount)).toBe(false);
      if (!r.ok) {
        expect(r.code).toBe("below_minimum");
        expect(r.message).toContain("$10 USD");
      }
    }
  });

  it("accepts exactly $10, including equivalent spellings", () => {
    for (const amount of ["10", "10.0", "10.000000", " 10 ", "010", 10]) {
      const r = checkAmount(amount);
      expect(r.ok, String(amount)).toBe(true);
      if (r.ok) expect(r.micro).toBe(MIN_WITHDRAWAL_MICRO);
    }
  });

  it("accepts amounts above $10", () => {
    for (const amount of ["10.000001", "10.01", "25.5", "1000", 12.5]) {
      expect(checkAmount(amount).ok, String(amount)).toBe(true);
    }
  });

  it("uses exact decimal arithmetic (no float rounding at the boundary)", () => {
    // 9.999999999999999 would round to 10 as a float; here it has too many decimals and is rejected, not rounded up.
    expect(parseAmount("9.999999999999999")).toEqual({ ok: false, reason: "too_many_decimals" });
    expect(checkAmount("9.999999").ok).toBe(false);
    expect(checkAmount("10.000000").ok).toBe(true);
    expect(microToDecimalString(parseAmountMicro("0.1") + parseAmountMicro("0.2"))).toBe("0.300000");
  });
});

function parseAmountMicro(text: string): bigint {
  const r = parseAmount(text);
  if (!r.ok) throw new Error("unexpected");
  return r.micro;
}

describe("invalid amounts", () => {
  const cases: Array<[unknown, string]> = [
    ["", "required"],
    ["   ", "required"],
    [undefined, "required"],
    [null, "required"],
    ["0", "not_positive"],
    ["0.000000", "not_positive"],
    ["-5", "not_positive"],
    ["-0.01", "not_positive"],
    ["abc", "malformed"],
    ["1e3", "malformed"],
    ["0x10", "malformed"],
    ["10,5", "malformed"],
    ["1 000", "malformed"],
    [".5", "malformed"],
    ["10.", "malformed"],
    ["+10", "malformed"],
    ["--10", "malformed"],
    ["10.1234567", "too_many_decimals"],
    ["1".repeat(13), "too_large"],
    [NaN, "malformed"],
    [Infinity, "malformed"],
    [-Infinity, "malformed"],
    [1e21, "malformed"],
    [{ a: 1 }, "malformed"],
    [[10], "malformed"],
    [true, "malformed"],
  ];
  it.each(cases)("rejects %j as %s", (input, reason) => {
    const r = parseAmount(input);
    expect(r).toEqual({ ok: false, reason });
    expect(checkAmount(input).ok).toBe(false);
  });
});

describe("balance handling", () => {
  it("parses stored numeric balances exactly", () => {
    expect(parseBalanceMicro("50.000000")).toBe(parseAmountMicro("50"));
    expect(parseBalanceMicro("0")).toBe(BigInt(0));
    expect(parseBalanceMicro(null)).toBe(BigInt(0));
    expect(parseBalanceMicro("garbage")).toBe(BigInt(0));
    expect(parseBalanceMicro("-3")).toBe(BigInt(0));
  });

  it("client check reports insufficient balance, below-minimum and OK", () => {
    expect(validateWithdrawalAmountInput("", "50")).toBeNull();
    expect(validateWithdrawalAmountInput("9", "50")).toContain("$10 USD");
    expect(validateWithdrawalAmountInput("60", "50")).toContain("Insufficient");
    expect(validateWithdrawalAmountInput("50", "50.000000")).toBeNull();
    expect(validateWithdrawalAmountInput("50.000001", "50.000000")).toContain("Insufficient");
    expect(validateWithdrawalAmountInput("10", "9.999999")).toContain("Insufficient");
  });

  it("formats micro-units for storage and for display", () => {
    expect(microToDecimalString(parseAmountMicro("12.5"))).toBe("12.500000");
    expect(microToDisplay(parseAmountMicro("12.5"))).toBe("12.50");
    expect(microToDisplay(parseAmountMicro("10"))).toBe("10.00");
    expect(microToDisplay(parseAmountMicro("10.123456"))).toBe("10.123456");
  });
});

describe("validateWithdrawalRequest", () => {
  const ok = { amount: "10", walletAddress: ADDRESS, network: "TRC20", currency: "USDT" };

  it("accepts a valid request and normalises it", () => {
    const r = validateWithdrawalRequest({ ...ok, walletAddress: `  ${ADDRESS}  ` });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toMatchObject({ amount: "10.000000", walletAddress: ADDRESS, network: "TRC20", currency: "USDT" });
  });

  it("keeps the existing defaults when network/currency are omitted", () => {
    const r = validateWithdrawalRequest({ amount: "10", walletAddress: ADDRESS });
    expect(r.ok && r.value.network).toBe("TRC20");
    expect(r.ok && r.value.currency).toBe("USDT");
  });

  it("keeps every existing network", () => {
    for (const network of ["TRC20", "ERC20", "TON", "BEP20"]) {
      expect(validateWithdrawalRequest({ ...ok, network }).ok, network).toBe(true);
    }
  });

  it.each([
    [{ ...ok, amount: "9.99" }, "below_minimum"],
    [{ ...ok, amount: "0" }, "invalid_amount"],
    [{ ...ok, amount: "-10" }, "invalid_amount"],
    [{ ...ok, amount: "ten" }, "invalid_amount"],
    [{ ...ok, walletAddress: "" }, "invalid_address"],
    [{ ...ok, walletAddress: "short" }, "invalid_address"],
    [{ ...ok, walletAddress: "has space in address 123" }, "invalid_address"],
    [{ ...ok, walletAddress: "x".repeat(200) }, "invalid_address"],
    [{ ...ok, walletAddress: 12345678901234 }, "invalid_address"],
    [{ ...ok, currency: "BTC" }, "unsupported_currency"],
    [{ ...ok, currency: { $ne: 1 } }, "unsupported_currency"],
    [{ ...ok, network: "SOLANA" }, "unsupported_network"],
    [null, "invalid_request"],
    [[], "invalid_request"],
    ["10", "invalid_request"],
  ])("rejects %j with %s", (body, code) => {
    const r = validateWithdrawalRequest(body);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(400);
      expect(r.code).toBe(code);
    }
  });
});
