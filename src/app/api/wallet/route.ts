import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { transactions, withdrawals } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { getSessionUser, unauthorized } from "@/lib/auth";

export async function GET(req: NextRequest) {
  try {
    const user = await getSessionUser(req);
    if (!user) return unauthorized();

    const txs = await db
      .select()
      .from(transactions)
      .where(eq(transactions.userId, user.id))
      .orderBy(desc(transactions.createdAt))
      .limit(50);

    const wds = await db
      .select()
      .from(withdrawals)
      .where(eq(withdrawals.userId, user.id))
      .orderBy(desc(withdrawals.createdAt))
      .limit(20);

    return NextResponse.json({ transactions: txs, withdrawals: wds });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
