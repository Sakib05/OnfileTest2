import { and, eq, gt, sql } from "drizzle-orm";
import { db } from "@/db";
import { transactions, users, withdrawals } from "@/db/schema";
import { checkWithdrawalAmount } from "@/lib/money";
import { notifyUser } from "@/lib/notifications";

/**
 * Server-side withdrawal request. Everything that protects creator funds lives here, so it cannot be bypassed by
 * calling the API directly:
 *   - the amount is parsed from its decimal string (no floats) and must be >= the $10 minimum;
 *   - the balance is checked AND debited by ONE conditional UPDATE (`balance >= amount`), inside a DB transaction
 *     together with the withdrawal + transaction rows — a failed/invalid request can never leave a deduction behind;
 *   - the UPDATE row-locks the user, so concurrent requests serialize and can never overdraw the balance;
 *   - an identical pending request (same amount + address) in the last minute is rejected as a duplicate.
 */

export const SUPPORTED_WITHDRAWAL_CURRENCY = "USDT";
export const SUPPORTED_WITHDRAWAL_NETWORKS = ["TRC20", "ERC20", "TON", "BEP20"] as const;
export const DUPLICATE_WINDOW_MS = 60_000;

export interface WithdrawalInput {
  amount: unknown;
  walletAddress: unknown;
  network?: unknown;
  currency?: unknown;
}

export type WithdrawalResult =
  | { ok: true; withdrawal: typeof withdrawals.$inferSelect }
  | { ok: false; status: number; code: string; error: string };

const fail = (status: number, code: string, error: string): WithdrawalResult => ({ ok: false, status, code, error });

class RollbackSignal extends Error {
  constructor(public result: WithdrawalResult) {
    super(result.ok ? "ok" : result.code);
  }
}

export async function createWithdrawalRequest(userId: number, input: WithdrawalInput): Promise<WithdrawalResult> {
  const address = typeof input.walletAddress === "string" ? input.walletAddress.trim() : "";
  if (input.amount === undefined || input.amount === null || input.amount === "" || !address) {
    return fail(400, "missing_fields", "Amount and wallet address are required");
  }

  const amount = checkWithdrawalAmount(input.amount);
  if (!amount.ok) return fail(400, amount.code, amount.message);

  if (address.length < 8 || address.length > 128 || /\s/.test(address)) {
    return fail(400, "invalid_address", "Enter a valid wallet address.");
  }
  const currency = input.currency === undefined || input.currency === "" ? SUPPORTED_WITHDRAWAL_CURRENCY : input.currency;
  if (currency !== SUPPORTED_WITHDRAWAL_CURRENCY) {
    return fail(400, "unsupported_currency", `Only ${SUPPORTED_WITHDRAWAL_CURRENCY} withdrawals are supported.`);
  }
  const network = input.network === undefined || input.network === "" ? "TRC20" : input.network;
  if (typeof network !== "string" || !(SUPPORTED_WITHDRAWAL_NETWORKS as readonly string[]).includes(network)) {
    return fail(400, "unsupported_network", "Choose a supported network.");
  }

  let created: typeof withdrawals.$inferSelect;
  try {
    created = await db.transaction(async (tx) => {
      // Atomic check-and-debit. coalesce() guards NULL columns; the WHERE clause is the balance check.
      const debited = await tx
        .update(users)
        .set({
          balance: sql`coalesce(${users.balance}, 0) - ${amount.decimal}::numeric`,
          pendingBalance: sql`coalesce(${users.pendingBalance}, 0) + ${amount.decimal}::numeric`,
          updatedAt: new Date(),
        })
        .where(and(eq(users.id, userId), sql`coalesce(${users.balance}, 0) >= ${amount.decimal}::numeric`))
        .returning({ id: users.id });
      if (debited.length === 0) throw new RollbackSignal(fail(400, "insufficient_balance", "Insufficient balance"));

      // The UPDATE above holds the user's row lock until commit, so this check is race-free per user.
      const [dup] = await tx
        .select({ id: withdrawals.id })
        .from(withdrawals)
        .where(
          and(
            eq(withdrawals.userId, userId),
            eq(withdrawals.status, "pending"),
            eq(withdrawals.walletAddress, address),
            sql`${withdrawals.amount} = ${amount.decimal}::numeric`,
            gt(withdrawals.createdAt, new Date(Date.now() - DUPLICATE_WINDOW_MS))
          )
        )
        .limit(1);
      if (dup) {
        throw new RollbackSignal(fail(409, "duplicate_request", "An identical withdrawal request was just submitted."));
      }

      const [withdrawal] = await tx
        .insert(withdrawals)
        .values({ userId, amount: amount.decimal, currency, walletAddress: address, network, status: "pending" })
        .returning();

      await tx.insert(transactions).values({
        userId,
        type: "withdrawal",
        amount: amount.decimal,
        currency,
        status: "pending",
        description: `Withdrawal request to ${address.slice(0, 8)}...`,
        referenceId: String(withdrawal.id),
      });
      return withdrawal;
    });
  } catch (err) {
    if (err instanceof RollbackSignal) return err.result;
    throw err;
  }

  // Genuine backend event; a notification failure must never undo or hide a recorded request.
  try {
    await notifyUser({
      userId,
      type: "withdrawal_requested",
      title: "Withdrawal requested",
      body: `Your withdrawal request of ${Number(amount.decimal).toFixed(2)} ${currency} was received and is pending review.`,
      destination: { type: "wallet" },
      dedupeKey: `withdrawal_requested:${created.id}`,
    });
  } catch (err) {
    console.error("withdrawal_notify_failed", err instanceof Error ? err.message : "unknown_error");
  }

  return { ok: true, withdrawal: created };
}
