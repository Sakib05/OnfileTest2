import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";

export async function GET(req: NextRequest) {
  try {
    // In TMA, read from cookie/session. For demo, use first user or create demo user.
    const userId = req.cookies.get("onfile_user_id")?.value;

    if (!userId) {
      // Create a demo/guest user for web visitors
      const code = nanoid(8).toUpperCase();
      const [newUser] = await db
        .insert(users)
        .values({
          username: "creator_demo",
          firstName: "Alex",
          lastName: "Creator",
          referralCode: code,
          balance: "48.2500",
          pendingBalance: "12.5000",
          referralEarnings: "5.3200",
          totalDownloads: 1847,
          totalEarnings: "127.4500",
        })
        .returning();

      const res = NextResponse.json({ user: newUser });
      res.cookies.set("onfile_user_id", String(newUser.id), {
        maxAge: 60 * 60 * 24 * 30,
        path: "/",
        httpOnly: true,
      });
      return res;
    }

    const [user] = await db.select().from(users).where(eq(users.id, parseInt(userId)));
    if (!user) {
      const res = NextResponse.json({ user: null }, { status: 404 });
      res.cookies.delete("onfile_user_id");
      return res;
    }

    return NextResponse.json({ user });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const userId = req.cookies.get("onfile_user_id")?.value;
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const allowed = ["username", "firstName", "lastName", "language", "darkMode"];
    const updates: Record<string, unknown> = {};
    for (const key of allowed) {
      if (key in body) updates[key as keyof typeof updates] = body[key];
    }

    const [updated] = await db
      .update(users)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(users.id, parseInt(userId)))
      .returning();

    return NextResponse.json({ user: updated });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
