import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { getSessionUser, isSameOriginRequest, unauthorized } from "@/lib/auth";
import { isAdminUser } from "@/lib/adminAuth";
import { rateLimit } from "@/lib/rateLimit";
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_MB } from "@/lib/thumbnails/imageProcessing";
import { MULTIPART_OVERHEAD_BYTES } from "@/lib/thumbnails/limits";
import { removeProfileImage, uploadProfileImage } from "@/lib/profile/avatarService";
import { serializeSessionUser } from "@/lib/profile/serialize";

// Node runtime (sharp is a native module); never statically cached.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const NO_STORE = { "Cache-Control": "private, no-store" };

async function freshUser(userId: number) {
  const [row] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  return row ? serializeSessionUser(row, { isAdmin: isAdminUser(row) }) : null;
}

/**
 * Upload / replace the authenticated user's CUSTOM profile picture (multipart field "file").
 * Identity comes ONLY from the session cookie — a user id / Telegram id in the request is never read.
 * The real image bytes are validated + re-encoded server-side (JPEG / PNG / WebP, not animated, ≤ 2 MB).
 * Telegram sync never touches `users.profile_image_key`, so this picture survives re-login.
 */
export async function POST(req: NextRequest) {
  if (!isSameOriginRequest(req)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403, headers: NO_STORE });
  }
  try {
    const user = await getSessionUser(req);
    if (!user) return unauthorized();

    const { allowed } = rateLimit(`avatar-upload:${user.id}`, 10, 60_000);
    if (!allowed) {
      return NextResponse.json(
        { error: "Too many uploads. Please wait a minute and try again.", code: "rate_limited" },
        { status: 429, headers: { ...NO_STORE, "Retry-After": "60" } }
      );
    }

    const declared = Number(req.headers.get("content-length") ?? "0");
    if (declared > MAX_UPLOAD_BYTES + MULTIPART_OVERHEAD_BYTES) {
      return NextResponse.json({ error: `Image must be ${MAX_UPLOAD_MB} MB or smaller.`, code: "too_large" }, { status: 413, headers: NO_STORE });
    }

    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return NextResponse.json({ error: "Invalid upload.", code: "bad_request" }, { status: 400, headers: NO_STORE });
    }
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No image provided.", code: "bad_request" }, { status: 400, headers: NO_STORE });
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json({ error: `Image must be ${MAX_UPLOAD_MB} MB or smaller.`, code: "too_large" }, { status: 413, headers: NO_STORE });
    }

    const result = await uploadProfileImage({ userId: user.id, bytes: new Uint8Array(await file.arrayBuffer()) });
    if (!result.ok) {
      const headers: Record<string, string> = { ...NO_STORE };
      if (result.retryAfter !== undefined) headers["Retry-After"] = String(Math.ceil(result.retryAfter));
      return NextResponse.json({ error: result.message, code: result.code }, { status: result.status, headers });
    }
    return NextResponse.json({ user: await freshUser(user.id) }, { status: 201, headers: NO_STORE });
  } catch (err) {
    console.error("avatar_upload_route_failed", err instanceof Error ? err.message : "unknown_error");
    return NextResponse.json({ error: "Internal server error" }, { status: 500, headers: NO_STORE });
  }
}

/**
 * Removes the authenticated user's custom picture. The Telegram photo (or, failing that, the initials avatar)
 * is shown again automatically. Idempotent: removing when there is no custom picture succeeds.
 */
export async function DELETE(req: NextRequest) {
  if (!isSameOriginRequest(req)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403, headers: NO_STORE });
  }
  try {
    const user = await getSessionUser(req);
    if (!user) return unauthorized();

    const result = await removeProfileImage({ userId: user.id });
    if (!result.ok) return NextResponse.json({ error: result.message, code: result.code }, { status: result.status, headers: NO_STORE });
    return NextResponse.json({ removed: result.removed, user: await freshUser(user.id) }, { headers: NO_STORE });
  } catch (err) {
    console.error("avatar_remove_route_failed", err instanceof Error ? err.message : "unknown_error");
    return NextResponse.json({ error: "Internal server error" }, { status: 500, headers: NO_STORE });
  }
}
