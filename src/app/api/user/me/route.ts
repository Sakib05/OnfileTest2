import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getSessionUser, isSameOriginRequest } from "@/lib/auth";
import { validateDisplayName } from "@/lib/profile";
import { serializeUser } from "@/lib/userSerializer";

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

    return NextResponse.json({ user: serializeUser(user, { includeAdmin: true }) });
  } catch (err) {
    console.error("user_me_failed", err instanceof Error ? err.message : "unknown_error");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

function isValidPatchBody(body: unknown): body is Record<string, unknown> {
  return !!body && typeof body === "object" && !Array.isArray(body);
}

/**
 * Updates the small set of self-service profile fields for the authenticated creator: Display Name, language and
 * dark mode. Requires a valid session (never a client-supplied user id) and a same-origin request (defense in depth
 * against CSRF on this cookie-authenticated, state-changing endpoint).
 *
 * What this endpoint can NEVER change: the Telegram username, the Telegram id, balances, referral data or any other
 * column — those keys are not read at all. A request that tries to set `username` is rejected explicitly.
 *
 * Display Name is stored in the existing `first_name` column (the name every Onfile screen already shows) and the
 * creator's `display_name_custom` flag is set so the Telegram login sync stops overwriting it. Accepted as
 * `displayName` (preferred) or `firstName` (legacy alias).
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

  if ("username" in body || "telegramId" in body) {
    return NextResponse.json(
      { error: "Your Telegram username can't be changed in Onfile. It follows your Telegram account.", code: "username_read_only" },
      { status: 400 }
    );
  }

  const updates: Partial<typeof users.$inferInsert> = {};

  if ("displayName" in body || "firstName" in body) {
    const check = validateDisplayName("displayName" in body ? body.displayName : body.firstName);
    if (!check.ok) {
      return NextResponse.json({ error: check.error, code: "invalid_display_name" }, { status: 400 });
    }
    updates.firstName = check.value;
    updates.lastName = null; // the Display Name is the whole visible name
    updates.displayNameCustom = true;
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

    return NextResponse.json({ user: serializeUser(updated) });
  } catch (err) {
    console.error("user_me_patch_failed", err instanceof Error ? err.message : "unknown_error");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
