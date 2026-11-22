/**
 * Withdrawal rules shared by the server (POST /api/wallet/withdraw) and the Wallet UI.
 *
 * Money is NEVER handled as a JavaScript float here. Amounts are parsed from their decimal text into
 * integer "micro-units" (1 unit = 0.000001, matching the numeric(18,6) database columns) held in a
 * BigInt, so comparisons such as "is 9.999999 below 10?" are exact. The text that is eventually written
 * to Postgres is rebuilt from those integers (see `microToDecimalString`), and the balance arithmetic
 * itself is done by Postgres `numeric`, which is exact as well.
 *
 * This module is dependency-free so it can be imported from client components.
 */

/** Minimum withdrawal, in USD. Balances are denominated in USDT and shown at 1 USDT ≈ 1 USD in the app. */
export const MIN_WITHDRAWAL_USD = 10;
/** Same minimum as an exact decimal string (what is stored / compared). */
export const MIN_WITHDRAWAL_DECIMAL = "10.000000";
/** Number of decimal places the database stores (numeric(18,6)). */
export const AMOUNT_SCALE = 6;
/** Largest whole-number part accepted (numeric(18,6) holds 12 integer digits). */
export const MAX_INTEGER_DIGITS = 12;

const MICRO = BigInt(10) ** BigInt(AMOUNT_SCALE);
const ZERO = BigInt(0);
export const MIN_WITHDRAWAL_MICRO = BigInt(MIN_WITHDRAWAL_USD) * MICRO;

/** Currencies and networks the Wallet already offers. Anything else is rejected by the server. */
export const SUPPORTED_WITHDRAWAL_CURRENCIES = ["USDT"] as const;
export const SUPPORTED_WITHDRAWAL_NETWORKS = ["TRC20", "ERC20", "TON", "BEP20"] as const;
export const DEFAULT_WITHDRAWAL_CURRENCY = "USDT";
export const DEFAULT_WITHDRAWAL_NETWORK = "TRC20";

export const WALLET_ADDRESS_MIN = 10;
export const WALLET_ADDRESS_MAX = 128;
/** Characters that appear in TRON / Ethereum / BSC / TON addresses. No whitespace or control characters. */
const WALLET_ADDRESS_PATTERN = /^[A-Za-z0-9_\-:.=+/]+$/;

export const MIN_WITHDRAWAL_MESSAGE = `Minimum withdrawal is $${MIN_WITHDRAWAL_USD} USD (${MIN_WITHDRAWAL_USD} USDT).`;

export type AmountError = "required" | "malformed" | "not_positive" | "too_large" | "too_many_decimals";

export type ParsedAmount = { ok: true; micro: bigint } | { ok: false; reason: AmountError };

/**
 * Parses a decimal amount. Accepts a string like "10", "10.5", "10.123456" (up to 6 decimals), or a finite
 * JS number whose shortest string form is such a decimal (kept for backward compatibility with older
 * clients that posted numbers). Rejects empty values, signs, exponents, hex, separators, whitespace inside
 * the number, more than 6 decimals, NaN/Infinity, and zero.
 */
export function parseAmount(input: unknown): ParsedAmount {
  let text: string;
  if (typeof input === "number") {
    if (!Number.isFinite(input)) return { ok: false, reason: "malformed" };
    text = String(input);
  } else if (typeof input === "string") {
    text = input.trim();
  } else {
    return { ok: false, reason: input === undefined || input === null ? "required" : "malformed" };
  }
  if (text === "") return { ok: false, reason: "required" };
  if (text.length > 40) return { ok: false, reason: "malformed" };
  if (text.startsWith("-")) return { ok: false, reason: /^-\d+(\.\d+)?$/.test(text) ? "not_positive" : "malformed" };

  const match = /^(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) return { ok: false, reason: "malformed" };
  const whole = match[1].replace(/^0+(?=\d)/, "");
  const fraction = match[2] ?? "";
  if (whole.length > MAX_INTEGER_DIGITS) return { ok: false, reason: "too_large" };
  if (fraction.length > AMOUNT_SCALE) return { ok: false, reason: "too_many_decimals" };

  const micro = BigInt(whole) * MICRO + BigInt(fraction.padEnd(AMOUNT_SCALE, "0") || "0");
  if (micro <= ZERO) return { ok: false, reason: "not_positive" };
  return { ok: true, micro };
}

/** Parses a stored balance such as "50.000000" (never throws; garbage/negative → 0). */
export function parseBalanceMicro(balance: unknown): bigint {
  if (typeof balance === "number" && Number.isFinite(balance)) balance = String(balance);
  if (typeof balance !== "string") return ZERO;
  const match = /^(\d{1,18})(?:\.(\d{1,12}))?$/.exec(balance.trim());
  if (!match) return ZERO;
  const fraction = (match[2] ?? "").slice(0, AMOUNT_SCALE).padEnd(AMOUNT_SCALE, "0");
  return BigInt(match[1]) * MICRO + BigInt(fraction);
}

/** Exact decimal text for the database, always with 6 decimals (e.g. 12500000 → "12.500000"). */
export function microToDecimalString(micro: bigint): string {
  const negative = micro < ZERO;
  const abs = negative ? -micro : micro;
  const whole = abs / MICRO;
  const fraction = (abs % MICRO).toString().padStart(AMOUNT_SCALE, "0");
  return `${negative ? "-" : ""}${whole.toString()}.${fraction}`;
}

/** Human-readable text: at least 2 decimals, no pointless trailing zeros (12500000 → "12.50"). */
export function microToDisplay(micro: bigint): string {
  const [whole, fraction] = microToDecimalString(micro).split(".");
  const trimmed = fraction.replace(/0+$/, "").padEnd(2, "0");
  return `${whole}.${trimmed}`;
}

export type AmountCheck =
  | { ok: true; micro: bigint }
  | { ok: false; code: "invalid_amount" | "below_minimum"; message: string };

const AMOUNT_MESSAGES: Record<AmountError, string> = {
  required: "Enter the amount you want to withdraw.",
  malformed: "Enter a valid amount, for example 10 or 25.50.",
  not_positive: "The amount must be greater than zero.",
  too_large: "That amount is too large.",
  too_many_decimals: `Use at most ${AMOUNT_SCALE} decimal places.`,
};

/** Syntax + minimum check (no balance). */
export function checkAmount(input: unknown): AmountCheck {
  const parsed = parseAmount(input);
  if (!parsed.ok) return { ok: false, code: "invalid_amount", message: AMOUNT_MESSAGES[parsed.reason] };
  if (parsed.micro < MIN_WITHDRAWAL_MICRO) return { ok: false, code: "below_minimum", message: MIN_WITHDRAWAL_MESSAGE };
  return { ok: true, micro: parsed.micro };
}

/**
 * Client-side form check: returns a user-facing message, or null when the amount can be submitted.
 * The server repeats every one of these checks (and the balance check inside a transaction).
 */
export function validateWithdrawalAmountInput(amountText: string, balance: unknown): string | null {
  if (amountText.trim() === "") return null; // nothing typed yet: no error, but the submit button stays disabled
  const check = checkAmount(amountText);
  if (!check.ok) return check.message;
  if (check.micro > parseBalanceMicro(balance)) return "Insufficient balance. The amount is more than your available balance.";
  return null;
}

export interface WithdrawalRequest {
  micro: bigint;
  /** Exact decimal string with 6 decimals, ready for a numeric column. */
  amount: string;
  walletAddress: string;
  network: string;
  currency: string;
}

export type WithdrawalValidation =
  | { ok: true; value: WithdrawalRequest }
  | { ok: false; status: 400; code: string; error: string };

const bad = (code: string, error: string): WithdrawalValidation => ({ ok: false, status: 400, code, error });

/** Full server-side validation of the request body. Never trusts types. */
export function validateWithdrawalRequest(body: unknown): WithdrawalValidation {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return bad("invalid_request", "Invalid request body.");
  }
  const { amount, walletAddress, network, currency } = body as Record<string, unknown>;

  const check = checkAmount(amount);
  if (!check.ok) return bad(check.code, check.message);

  if (typeof walletAddress !== "string" || walletAddress.trim() === "") {
    return bad("invalid_address", "Amount and wallet address are required");
  }
  const address = walletAddress.trim();
  if (address.length < WALLET_ADDRESS_MIN || address.length > WALLET_ADDRESS_MAX || !WALLET_ADDRESS_PATTERN.test(address)) {
    return bad("invalid_address", "Enter a valid wallet address (no spaces or special characters).");
  }

  const cur = currency === undefined || currency === null || currency === "" ? DEFAULT_WITHDRAWAL_CURRENCY : currency;
  if (typeof cur !== "string" || !(SUPPORTED_WITHDRAWAL_CURRENCIES as readonly string[]).includes(cur)) {
    return bad("unsupported_currency", "Unsupported currency. Withdrawals are available in USDT.");
  }
  const net = network === undefined || network === null || network === "" ? DEFAULT_WITHDRAWAL_NETWORK : network;
  if (typeof net !== "string" || !(SUPPORTED_WITHDRAWAL_NETWORKS as readonly string[]).includes(net)) {
    return bad("unsupported_network", "Unsupported network. Choose TRC20, ERC20, TON or BEP20.");
  }

  return {
    ok: true,
    value: { micro: check.micro, amount: microToDecimalString(check.micro), walletAddress: address, network: net, currency: cur },
  };
}
