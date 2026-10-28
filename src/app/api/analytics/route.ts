import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { analytics, files } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { getSessionUser, unauthorized } from "@/lib/auth";

export async function GET(req: NextRequest) {
  try {
    const user = await getSessionUser(req);
    if (!user) return unauthorized();

    const uid = user.id;
    const { searchParams } = new URL(req.url);
    const days = parseInt(searchParams.get("days") || "7");
    const since = new Date();
    since.setDate(since.getDate() - days);

    // Get daily analytics aggregated, scoped to the authenticated user's files.
    const dailyData = await db
      .select({
        date: sql<string>`DATE(${analytics.createdAt})`.as("date"),
        views: sql<number>`COUNT(*) FILTER (WHERE ${analytics.eventType} = 'view')`.as("views"),
        downloads: sql<number>`COUNT(*) FILTER (WHERE ${analytics.eventType} = 'download')`.as("downloads"),
      })
      .from(analytics)
      .where(
        sql`${analytics.createdAt} >= ${since} AND ${analytics.fileId} IN (
          SELECT id FROM files WHERE user_id = ${uid}
        )`
      )
      .groupBy(sql`DATE(${analytics.createdAt})`)
      .orderBy(sql`DATE(${analytics.createdAt})`);

    // Build a full date range array
    const dateMap = new Map(dailyData.map((d) => [d.date, d]));
    const result = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().split("T")[0];
      const entry = dateMap.get(key);
      result.push({
        date: key,
        label: d.toLocaleDateString("en", { month: "short", day: "numeric" }),
        views: Number(entry?.views ?? 0),
        downloads: Number(entry?.downloads ?? 0),
        earnings: Number(entry?.downloads ?? 0) * 0.05,
      });
    }

    // Totals
    const totalFiles = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(files)
      .where(eq(files.userId, uid));

    return NextResponse.json({
      chart: result,
      totalFiles: Number(totalFiles[0]?.count ?? 0),
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * Records a view/download analytics event. Reachable by anonymous public
 * visitors (e.g. the smart-link page), so it intentionally does not require
 * a session — but it only ever writes an anonymized event row, never
 * identity or account data.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const fileId = typeof body.fileId === "number" ? body.fileId : undefined;
    const playlistId = typeof body.playlistId === "number" ? body.playlistId : undefined;
    const eventType = typeof body.eventType === "string" ? body.eventType.slice(0, 32) : undefined;
    if (!eventType || (!fileId && !playlistId)) {
      return NextResponse.json({ error: "fileId or playlistId, and eventType are required" }, { status: 400 });
    }
    await db.insert(analytics).values({
      fileId,
      playlistId,
      eventType,
      ipHash: typeof body.ipHash === "string" ? body.ipHash.slice(0, 64) : undefined,
    });
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
