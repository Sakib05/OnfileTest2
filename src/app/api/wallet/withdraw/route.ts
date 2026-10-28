import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { withdrawals, users, transactions } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { getSessionUser, isSameOriginRequest, unauthorized } from "@/lib/auth";
import { getClientIp, rateLimit } from "@/lib/rateLimit";

export async function POST(req: NextRequest) {
  if (!isSameOriginRequest(req)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }

  const ip = getClientIp(req);
  const { allowed } = rateLimit(`withdraw:${ip}`, 10, 60_000);
  if (!allowed) {
    return NextResponse.json({ error: "Too many requests. Please try again shortly." }, { status: 429 });
  }

  try {
    const user = await getSessionUser(req);
    if (!user) return unauthorized();

    const uid = user.id;
    const body = await req.json();
    const { amount, walletAddress, network, currency } = body;

    if (!amount || !walletAddress) {
      return NextResponse.json({ error: "Amount and wallet address are required" }, { status: 400 });
    }

    const amountNum = parseFloat(amount);
    if (!Number.isFinite(amountNum) || amountNum < 1) {
      return NextResponse.json({ error: "Minimum withdrawal is 1 USDT" }, { status: 400 });
    }

    // Check balance
    const [dbUser] = await db.select().from(users).where(eq(users.id, uid));
    if (!dbUser || parseFloat(dbUser.balance ?? "0") < amountNum) {
      return NextResponse.json({ error: "Insufficient balance" }, { status: 400 });
    }

    // Deduct balance and create withdrawal
    await db
      .update(users)
      .set({
        balance: sql`balance - ${amountNum}`,
        pendingBalance: sql`pending_balance + ${amountNum}`,
        updatedAt: new Date(),
      })
      .where(eq(users.id, uid));

    const [withdrawal] = await db
      .insert(withdrawals)
      .values({
        userId: uid,
        amount: amountNum.toString(),
        currency: currency || "USDT",
        walletAddress,
        network: network || "TRC20",
        status: "pending",
      })
      .returning();

    await db.insert(transactions).values({
      userId: uid,
      type: "withdrawal",
      amount: amountNum.toString(),
      currency: currency || "USDT",
      status: "pending",
      description: `Withdrawal request to ${String(walletAddress).slice(0, 8)}...`,
      referenceId: String(withdrawal.id),
    });

    return NextResponse.json({ withdrawal }, { status: 201 });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
