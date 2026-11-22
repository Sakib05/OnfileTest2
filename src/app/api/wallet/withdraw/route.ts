import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { withdrawals, users, transactions } from "@/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { getSessionUser, isSameOriginRequest, unauthorized } from "@/lib/auth";
import { getClientIp, rateLimit } from "@/lib/rateLimit";
import { notifyUser } from "@/lib/notifications";
import { microToDisplay, validateWithdrawalRequest } from "@/lib/withdrawals";

/** Advisory-lock namespace: serialises withdrawal requests of ONE user across all server instances. */
const WITHDRAW_LOCK_NAMESPACE = 7011;

const NO_STORE = { "Cache-Control": "private, no-store" } as const;

/**
 * POST /api/wallet/withdraw
 *
 * Rules enforced HERE (the UI check is only a convenience):
 *   - amount: exact decimal text → integer micro-units (no floats); must be > 0, ≤ 6 decimals and ≥ $10 USD.
 *   - currency/network: only the ones the Wallet offers (USDT; TRC20, ERC20, TON, BEP20).
 *   - everything below runs in ONE database transaction, so the balance deduction, the withdrawal row and the
 *     ledger row either all happen or none do. A rejected request never touches the balance.
 *   - a per-user advisory lock serialises concurrent requests, and the deduction is a single conditional
 *     UPDATE (`... WHERE balance >= amount`), so two simultaneous requests can never spend the same funds
 *     or drive the balance below zero.
 *   - an identical request repeated within 60 s (see the `interval '60 seconds'` below; double tap / client retry) is answered 409 and does nothing.
 */
export async function POST(req: NextRequest) {
  if (!isSameOriginRequest(req)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403, headers: NO_STORE });
  }

  const ip = getClientIp(req);
  const { allowed } = rateLimit(`withdraw:${ip}`, 10, 60_000);
  if (!allowed) {
    return NextResponse.json({ error: "Too many requests. Please try again shortly." }, { status: 429, headers: NO_STORE });
  }

  try {
    const user = await getSessionUser(req);
    if (!user) return unauthorized();
    const uid = user.id;

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid request body.", code: "invalid_request" }, { status: 400, headers: NO_STORE });
    }

    const validation = validateWithdrawalRequest(body);
    if (!validation.ok) {
      return NextResponse.json({ error: validation.error, code: validation.code }, { status: validation.status, headers: NO_STORE });
    }
    const { amount, micro, walletAddress, network, currency } = validation.value;

    const outcome = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${WITHDRAW_LOCK_NAMESPACE}, ${uid})`);

      const [duplicate] = await tx
        .select({ id: withdrawals.id })
        .from(withdrawals)
        .where(
          and(
            eq(withdrawals.userId, uid),
            sql`${withdrawals.amount} = ${amount}::numeric`,
            eq(withdrawals.walletAddress, walletAddress),
            eq(withdrawals.network, network),
            eq(withdrawals.currency, currency),
            sql`${withdrawals.createdAt} > now() - interval '60 seconds'`
          )
        )
        .limit(1);
      if (duplicate) return { kind: "duplicate" as const };

      // Atomic check-and-deduct: matches no row (and changes nothing) unless the balance covers the amount.
      const deducted = await tx
        .update(users)
        .set({
          balance: sql`COALESCE(${users.balance}, 0) - ${amount}::numeric`,
          pendingBalance: sql`COALESCE(${users.pendingBalance}, 0) + ${amount}::numeric`,
          updatedAt: new Date(),
        })
        .where(and(eq(users.id, uid), sql`COALESCE(${users.balance}, 0) >= ${amount}::numeric`))
        .returning({ id: users.id });
      if (deducted.length === 0) return { kind: "insufficient" as const };

      const [withdrawal] = await tx
        .insert(withdrawals)
        .values({ userId: uid, amount, currency, walletAddress, network, status: "pending" })
        .returning();

      await tx.insert(transactions).values({
        userId: uid,
        type: "withdrawal",
        amount,
        currency,
        status: "pending",
        description: `Withdrawal request to ${walletAddress.slice(0, 8)}...`,
        referenceId: String(withdrawal.id),
      });

      return { kind: "created" as const, withdrawal };
    });

    if (outcome.kind === "duplicate") {
      return NextResponse.json(
        {
          error: "This withdrawal request was already submitted. Check your withdrawal history before trying again.",
          code: "duplicate_request",
        },
        { status: 409, headers: NO_STORE }
      );
    }
    if (outcome.kind === "insufficient") {
      return NextResponse.json({ error: "Insufficient balance", code: "insufficient_balance" }, { status: 400, headers: NO_STORE });
    }

    const { withdrawal } = outcome;
    // Genuine backend event: a withdrawal request was recorded for this account (never throws).
    await notifyUser({
      userId: uid,
      type: "withdrawal_requested",
      title: "Withdrawal requested",
      body: `Your withdrawal request of ${microToDisplay(micro)} ${currency} was received and is pending review.`,
      destination: { type: "wallet" },
      dedupeKey: `withdrawal_requested:${withdrawal.id}`,
    });

    return NextResponse.json({ withdrawal }, { status: 201, headers: NO_STORE });
  } catch (err) {
    console.error("withdraw_failed", err instanceof Error ? err.message : "unknown");
    return NextResponse.json({ error: "Internal server error" }, { status: 500, headers: NO_STORE });
  }
}
