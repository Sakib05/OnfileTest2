import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { referrals, users } from "@/db/schema";
import { eq, desc, sql } from "drizzle-orm";
import { getSessionUser, unauthorized } from "@/lib/auth";

export async function GET(req: NextRequest) {
  try {
    const user = await getSessionUser(req);
    if (!user) return unauthorized();

    const uid = user.id;

    const refs = await db
      .select({
        id: referrals.id,
        commissionEarned: referrals.commissionEarned,
        createdAt: referrals.createdAt,
        refereeUsername: users.username,
        refereeFirstName: users.firstName,
        refereeCreatedAt: users.createdAt,
      })
      .from(referrals)
      .leftJoin(users, eq(referrals.refereeId, users.id))
      .where(eq(referrals.referrerId, uid))
      .orderBy(desc(referrals.createdAt))
      .limit(50);

    const [totals] = await db
      .select({
        totalCommission: sql<string>`COALESCE(SUM(commission_earned), 0)`,
        totalReferrals: sql<number>`COUNT(*)`,
      })
      .from(referrals)
      .where(eq(referrals.referrerId, uid));

    return NextResponse.json({ referrals: refs, totals });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
