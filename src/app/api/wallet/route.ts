import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { transactions, withdrawals, users } from "@/db/schema";
import { eq, desc } from "drizzle-orm";

export async function GET(req: NextRequest) {
  try {
    const userId = req.cookies.get("onfile_user_id")?.value;
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const uid = parseInt(userId);

    const txs = await db
      .select()
      .from(transactions)
      .where(eq(transactions.userId, uid))
      .orderBy(desc(transactions.createdAt))
      .limit(50);

    const wds = await db
      .select()
      .from(withdrawals)
      .where(eq(withdrawals.userId, uid))
      .orderBy(desc(withdrawals.createdAt))
      .limit(20);

    return NextResponse.json({ transactions: txs, withdrawals: wds });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
