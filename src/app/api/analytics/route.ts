import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { analytics, files } from "@/db/schema";
import { eq, gte, sql, desc } from "drizzle-orm";

export async function GET(req: NextRequest) {
  try {
    const userId = req.cookies.get("onfile_user_id")?.value;
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const days = parseInt(searchParams.get("days") || "7");
    const since = new Date();
    since.setDate(since.getDate() - days);

    // Get daily analytics aggregated
    const dailyData = await db
      .select({
        date: sql<string>`DATE(${analytics.createdAt})`.as("date"),
        views: sql<number>`COUNT(*) FILTER (WHERE ${analytics.eventType} = 'view')`.as("views"),
        downloads: sql<number>`COUNT(*) FILTER (WHERE ${analytics.eventType} = 'download')`.as("downloads"),
      })
      .from(analytics)
      .where(
        sql`${analytics.createdAt} >= ${since} AND ${analytics.fileId} IN (
          SELECT id FROM files WHERE user_id = ${parseInt(userId)}
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
      .where(eq(files.userId, parseInt(userId)));

    return NextResponse.json({
      chart: result,
      totalFiles: Number(totalFiles[0]?.count ?? 0),
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    await db.insert(analytics).values({
      fileId: body.fileId,
      playlistId: body.playlistId,
      eventType: body.eventType,
      ipHash: body.ipHash,
    });
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
