import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { reports } from "@/db/schema";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { fileId, reason, description } = body;

    if (!fileId || !reason) {
      return NextResponse.json({ error: "fileId and reason are required" }, { status: 400 });
    }

    const ip = req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip") ?? "unknown";

    const [report] = await db
      .insert(reports)
      .values({
        fileId: parseInt(fileId),
        reason,
        description,
        reporterIp: ip.slice(0, 64),
        status: "pending",
      })
      .returning();

    return NextResponse.json({ report }, { status: 201 });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
