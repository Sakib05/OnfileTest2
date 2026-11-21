/**
 * Exact money helpers (browser + server safe, no imports).
 *
 * Onfile stores balances as Postgres `numeric(18, 6)` and treats 1 USDT as 1 USD (the Wallet shows
 * "≈ $X USD" at a 1:1 rate). To avoid floating-point drift every amount is converted to an INTEGER number of
 * micro-units (1 unit = 10^-6) by parsing the decimal STRING itself — never by multiplying a float. Integer
 * parts are capped at 9 digits so micro-units stay below Number.MAX_SAFE_INTEGER (9.0e15).
 */

export const MONEY_SCALE = 6;
const MICRO = 1_000_000;

/** Minimum amount a creator may withdraw, in USD (== USDT at the app's 1:1 rate). Single source of truth. */
export const MIN_WITHDRAWAL_USD = 10;
export const MIN_WITHDRAWAL_MICRO = MIN_WITHDRAWAL_USD * MICRO;
/** User-facing validation message (shown by the UI and returned by the API). */
export const MIN_WITHDRAWAL_MESSAGE = `Minimum withdrawal amount is $${MIN_WITHDRAWAL_USD}.`;

const DECIMAL_RE = /^(\d{1,9})(?:\.(\d{1,6}))?$/;

/**
 * Parses a decimal string (or a plain finite number) into integer micro-units.
 * Returns null for anything that is not a plain non-negative decimal with at most 6 fractional digits
 * (so "1e3", "-1", "NaN", "Infinity", "0x10", "1,5" and 7+ decimals are all rejected).
 */
export function parseMoneyToMicro(input: unknown): number | null {
  let text: string;
  if (typeof input === "number") {
    if (!Number.isFinite(input) || input < 0) return null;
    text = /e/i.test(String(input)) ? input.toFixed(MONEY_SCALE) : String(input);
  } else if (typeof input === "string") {
    text = input.trim();
  } else {
    return null;
  }
  const m = DECIMAL_RE.exec(text);
  if (!m) return null;
  const whole = Number(m[1]);
  const frac = Number((m[2] ?? "").padEnd(MONEY_SCALE, "0"));
  return whole * MICRO + frac;
}

/** Integer micro-units → exact decimal string with 6 fractional digits (matches numeric(18,6)). */
export function microToDecimalString(micro: number): string {
  const whole = Math.floor(micro / MICRO);
  const frac = micro - whole * MICRO;
  return `${whole}.${String(frac).padStart(MONEY_SCALE, "0")}`;
}

export type WithdrawalAmountCheck =
  | { ok: true; micro: number; decimal: string }
  | { ok: false; code: "invalid_amount" | "below_minimum"; message: string };

/** Pure amount validation shared by the API route and the Wallet UI. */
export function checkWithdrawalAmount(input: unknown): WithdrawalAmountCheck {
  const micro = parseMoneyToMicro(input);
  if (micro === null || micro <= 0) {
    return { ok: false, code: "invalid_amount", message: "Enter a valid amount (up to 6 decimal places)." };
  }
  if (micro < MIN_WITHDRAWAL_MICRO) {
    return { ok: false, code: "below_minimum", message: MIN_WITHDRAWAL_MESSAGE };
  }
  return { ok: true, micro, decimal: microToDecimalString(micro) };
}
