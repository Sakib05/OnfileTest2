import { NextRequest, NextResponse } from "next/server";
import { getSessionUser, isSameOriginRequest, unauthorized } from "@/lib/auth";
import { rateLimit } from "@/lib/rateLimit";
import { MULTIPART_OVERHEAD_BYTES } from "@/lib/thumbnails/limits";
import { PROFILE_IMAGE_MAX_BYTES, PROFILE_IMAGE_MAX_LABEL } from "@/lib/profile";
import { removeProfileImage, setProfileImage } from "@/lib/profileImage";

// Node runtime (sharp is a native module); never statically cached.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const NO_STORE = { "Cache-Control": "private, no-store" };

/**
 * Upload / replace the authenticated creator's profile picture. multipart field "file".
 * Identity comes ONLY from the session cookie. Validation (size, magic bytes, full decode, animation, pixel limit) is
 * done here on the server regardless of anything the browser checked.
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
    if (declared > PROFILE_IMAGE_MAX_BYTES + MULTIPART_OVERHEAD_BYTES) {
      return NextResponse.json({ error: `Image must be ${PROFILE_IMAGE_MAX_LABEL} or smaller.`, code: "too_large" }, { status: 413, headers: NO_STORE });
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
    if (file.size > PROFILE_IMAGE_MAX_BYTES) {
      return NextResponse.json({ error: `Image must be ${PROFILE_IMAGE_MAX_LABEL} or smaller.`, code: "too_large" }, { status: 413, headers: NO_STORE });
    }

    const result = await setProfileImage({ userId: user.id, bytes: new Uint8Array(await file.arrayBuffer()) });
    if (!result.ok) {
      const headers: Record<string, string> = { ...NO_STORE };
      if (result.retryAfter !== undefined) headers["Retry-After"] = String(Math.ceil(result.retryAfter));
      return NextResponse.json({ error: result.message, code: result.code }, { status: result.status, headers });
    }
    return NextResponse.json({ avatarUrl: result.avatarUrl, hasCustomAvatar: true }, { status: 201, headers: NO_STORE });
  } catch (err) {
    console.error("avatar_upload_route_failed", err instanceof Error ? err.message : "unknown_error");
    return NextResponse.json({ error: "Internal server error" }, { status: 500, headers: NO_STORE });
  }
}

/** Removes the uploaded picture; the existing default avatar is shown again. */
export async function DELETE(req: NextRequest) {
  if (!isSameOriginRequest(req)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403, headers: NO_STORE });
  }
  try {
    const user = await getSessionUser(req);
    if (!user) return unauthorized();
    const result = await removeProfileImage(user.id);
    return NextResponse.json({ ok: true, removed: result.removed }, { headers: NO_STORE });
  } catch (err) {
    console.error("avatar_remove_route_failed", err instanceof Error ? err.message : "unknown_error");
    return NextResponse.json({ error: "Internal server error" }, { status: 500, headers: NO_STORE });
  }
}
