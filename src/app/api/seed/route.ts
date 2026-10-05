import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { files, analytics, transactions, referrals, users, playlists } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";

export async function POST(req: NextRequest) {
  try {
    const userId = req.cookies.get("onfile_user_id")?.value;
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const uid = parseInt(userId);

    // Create sample playlists
    const [pl1, pl2] = await db
      .insert(playlists)
      .values([
        {
          userId: uid,
          title: "Premium Video Course",
          description: "Complete Next.js mastery course",
          starsPrice: 50,
          isPublished: true,
          totalFiles: 12,
          totalViews: 847,
          totalDownloads: 312,
        },
        {
          userId: uid,
          title: "Design Assets Pack",
          description: "Figma templates and UI kits",
          password: "design2024",
          isPublished: true,
          totalFiles: 8,
          totalViews: 523,
          totalDownloads: 198,
        },
      ])
      .returning();

    // Create sample files
    const fileData = [
      {
        userId: uid,
        playlistId: pl1.id,
        title: "Next.js Full Course - Episode 1",
        description: "Introduction to Next.js 14 App Router",
        category: "Education",
        fileType: "video" as const,
        fileSize: 524288000,
        mimeType: "video/mp4",
        telegramMessageLink: "https://t.me/c/1234567890/1",
        starsPrice: 5,
        smartLinkSlug: nanoid(10),
        isPublished: true,
        views: 342,
        downloads: 128,
        earnings: "6.40",
      },
      {
        userId: uid,
        playlistId: pl1.id,
        title: "Next.js Full Course - Episode 2",
        description: "Server Components Deep Dive",
        category: "Education",
        fileType: "video" as const,
        fileSize: 612000000,
        mimeType: "video/mp4",
        telegramMessageLink: "https://t.me/c/1234567890/2",
        starsPrice: 5,
        smartLinkSlug: nanoid(10),
        isPublished: true,
        views: 287,
        downloads: 94,
        earnings: "4.70",
      },
      {
        userId: uid,
        playlistId: pl2.id,
        title: "Premium UI Kit - Figma",
        description: "500+ components for modern apps",
        category: "Design",
        fileType: "document" as const,
        fileSize: 45000000,
        mimeType: "application/octet-stream",
        telegramMessageLink: "https://t.me/c/1234567890/3",
        password: "design2024",
        smartLinkSlug: nanoid(10),
        isPublished: true,
        views: 523,
        downloads: 198,
        earnings: "9.90",
      },
      {
        userId: uid,
        title: "Background Music Pack Vol. 1",
        description: "Royalty-free ambient tracks",
        category: "Music",
        fileType: "audio" as const,
        fileSize: 128000000,
        mimeType: "audio/mp3",
        telegramMessageLink: "https://t.me/c/1234567890/4",
        starsPrice: 15,
        smartLinkSlug: nanoid(10),
        isPublished: true,
        views: 156,
        downloads: 67,
        earnings: "3.35",
      },
      {
        userId: uid,
        title: "E-Book: Mastering TypeScript",
        description: "Advanced TypeScript patterns and tips",
        category: "Books",
        fileType: "document" as const,
        fileSize: 8500000,
        mimeType: "application/pdf",
        telegramMessageLink: "https://t.me/c/1234567890/5",
        starsPrice: 10,
        smartLinkSlug: nanoid(10),
        isPublished: true,
        views: 432,
        downloads: 189,
        earnings: "9.45",
      },
      {
        userId: uid,
        title: "4K Stock Footage - Nature",
        description: "Cinematic drone footage collection",
        category: "Stock",
        fileType: "video" as const,
        fileSize: 2100000000,
        mimeType: "video/mp4",
        telegramMessageLink: "https://t.me/c/1234567890/6",
        starsPrice: 25,
        smartLinkSlug: nanoid(10),
        isPublished: true,
        views: 98,
        downloads: 41,
        earnings: "2.05",
      },
    ];

    await db.insert(files).values(fileData);

    // Create analytics data for past 30 days
    const analyticsData = [];
    const fileIds = await db
      .select({ id: files.id })
      .from(files)
      .where(eq(files.userId, uid));

    for (let i = 29; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const numEvents = Math.floor(Math.random() * 30) + 5;
      for (let j = 0; j < numEvents; j++) {
        const fid = fileIds[Math.floor(Math.random() * fileIds.length)];
        analyticsData.push({
          fileId: fid?.id ?? null,
          userId: uid,
          eventType: Math.random() > 0.3 ? "view" : "download",
          createdAt: new Date(date.getTime() + Math.random() * 86400000),
        });
      }
    }

    if (analyticsData.length > 0) {
      await db.insert(analytics).values(analyticsData);
    }

    // Create sample transactions
    await db.insert(transactions).values([
      {
        userId: uid,
        type: "earning",
        amount: "15.50",
        currency: "USDT",
        status: "available",
        description: "Star payments from Next.js Course",
      },
      {
        userId: uid,
        type: "earning",
        amount: "8.25",
        currency: "USDT",
        status: "available",
        description: "Ad revenue - week of Dec 1",
      },
      {
        userId: uid,
        type: "referral",
        amount: "2.40",
        currency: "USDT",
        status: "available",
        description: "5% commission from @creator_xyz",
      },
      {
        userId: uid,
        type: "withdrawal",
        amount: "30.00",
        currency: "USDT",
        status: "completed",
        description: "Withdrawal to TXxxxxxxx...",
      },
      {
        userId: uid,
        type: "earning",
        amount: "12.00",
        currency: "USDT",
        status: "pending",
        description: "Telegram Stars - Premium UI Kit",
      },
    ]);

    // Sample referrals - create dummy referred users first
    const [refUser1, refUser2] = await db
      .insert(users)
      .values([
        { username: "designer_pro", firstName: "Sam", referralCode: nanoid(8) },
        { username: "dev_studio", firstName: "Jordan", referralCode: nanoid(8) },
      ])
      .returning();

    await db.insert(referrals).values([
      { referrerId: uid, refereeId: refUser1.id, commissionEarned: "2.40" },
      { referrerId: uid, refereeId: refUser2.id, commissionEarned: "2.92" },
    ]);

    return NextResponse.json({ success: true, message: "Demo data seeded!" });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Seed failed: " + String(err) }, { status: 500 });
  }
}
