import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getSessionUser, isSameOriginRequest } from "@/lib/auth";

/**
 * Returns the profile of the currently authenticated creator, derived
 * strictly from the server-side session (see src/lib/auth.ts). This route
 * NEVER creates a user record — opening the Mini App, or calling this
 * endpoint without a valid session, simply returns `{ user: null }`. The
 * only place a `users` row is ever created is after a Telegram identity AND
 * a Telegram channel have both been verified (see /api/channels).
 */
export async function GET(req: NextRequest) {
  try {
    const user = await getSessionUser(req);
    if (!user) {
      return NextResponse.json({ user: null }, { status: 200 });
    }

    return NextResponse.json({
      user: {
        id: user.id,
        telegramId: user.telegramId ?? undefined,
        username: user.username ?? undefined,
        firstName: user.firstName ?? undefined,
        lastName: user.lastName ?? undefined,
        avatarUrl: user.avatarUrl ?? undefined,
        balance: user.balance ?? "0",
        pendingBalance: user.pendingBalance ?? "0",
        referralEarnings: user.referralEarnings ?? "0",
        totalDownloads: user.totalDownloads ?? 0,
        totalEarnings: user.totalEarnings ?? "0",
        referralCode: user.referralCode ?? undefined,
        darkMode: user.darkMode ?? false,
        language: user.language ?? "en",
      },
    });
  } catch (err) {
    console.error("user_me_failed", err instanceof Error ? err.message : "unknown_error");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

const PATCHABLE_FIELDS = ["username", "firstName", "lastName", "language", "darkMode"] as const;
type PatchableField = (typeof PATCHABLE_FIELDS)[number];

function isValidPatchBody(body: unknown): body is Partial<Record<PatchableField, unknown>> {
  return !!body && typeof body === "object" && !Array.isArray(body);
}

/**
 * Updates a small set of self-service profile fields for the authenticated
 * creator. Requires a valid session (never a client-supplied user id) and a
 * same-origin request (defense in depth against CSRF on this
 * cookie-authenticated, state-changing endpoint).
 */
export async function PATCH(req: NextRequest) {
  if (!isSameOriginRequest(req)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }

  const user = await getSessionUser(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (!isValidPatchBody(body)) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};

  if ("username" in body) {
    if (typeof body.username !== "string" || body.username.length > 128) {
      return NextResponse.json({ error: "Invalid username" }, { status: 400 });
    }
    updates.username = body.username.trim() || null;
  }
  if ("firstName" in body) {
    if (typeof body.firstName !== "string" || body.firstName.length > 128) {
      return NextResponse.json({ error: "Invalid firstName" }, { status: 400 });
    }
    updates.firstName = body.firstName.trim() || null;
  }
  if ("lastName" in body) {
    if (typeof body.lastName !== "string" || body.lastName.length > 128) {
      return NextResponse.json({ error: "Invalid lastName" }, { status: 400 });
    }
    updates.lastName = body.lastName.trim() || null;
  }
  if ("language" in body) {
    if (typeof body.language !== "string" || body.language.length > 10) {
      return NextResponse.json({ error: "Invalid language" }, { status: 400 });
    }
    updates.language = body.language;
  }
  if ("darkMode" in body) {
    if (typeof body.darkMode !== "boolean") {
      return NextResponse.json({ error: "Invalid darkMode" }, { status: 400 });
    }
    updates.darkMode = body.darkMode;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  try {
    const [updated] = await db
      .update(users)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(users.id, user.id))
      .returning();

    return NextResponse.json({
      user: {
        id: updated.id,
        telegramId: updated.telegramId ?? undefined,
        username: updated.username ?? undefined,
        firstName: updated.firstName ?? undefined,
        lastName: updated.lastName ?? undefined,
        avatarUrl: updated.avatarUrl ?? undefined,
        balance: updated.balance ?? "0",
        pendingBalance: updated.pendingBalance ?? "0",
        referralEarnings: updated.referralEarnings ?? "0",
        totalDownloads: updated.totalDownloads ?? 0,
        totalEarnings: updated.totalEarnings ?? "0",
        referralCode: updated.referralCode ?? undefined,
        darkMode: updated.darkMode ?? false,
        language: updated.language ?? "en",
      },
    });
  } catch (err) {
    console.error("user_me_patch_failed", err instanceof Error ? err.message : "unknown_error");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
