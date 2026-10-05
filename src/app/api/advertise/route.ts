import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { adCampaigns } from "@/db/schema";
import { desc } from "drizzle-orm";

export async function GET() {
  try {
    const campaigns = await db
      .select()
      .from(adCampaigns)
      .orderBy(desc(adCampaigns.createdAt))
      .limit(20);
    return NextResponse.json({ campaigns });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { advertiserName, advertiserEmail, network, campaignName, budget, targetUrl, message } = body;

    if (!advertiserName || !advertiserEmail) {
      return NextResponse.json({ error: "Name and email are required" }, { status: 400 });
    }

    const [campaign] = await db
      .insert(adCampaigns)
      .values({
        advertiserName,
        advertiserEmail,
        network,
        campaignName,
        budget: budget ? String(budget) : null,
        targetUrl,
        message,
        status: "pending",
      })
      .returning();

    return NextResponse.json({ campaign }, { status: 201 });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
