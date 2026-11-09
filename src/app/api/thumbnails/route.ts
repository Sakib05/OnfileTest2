import { NextRequest, NextResponse } from "next/server";
import { getSessionUser, isSameOriginRequest, unauthorized } from "@/lib/auth";
import { rateLimit } from "@/lib/rateLimit";
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_MB } from "@/lib/thumbnails/imageProcessing";
import { stageThumbnail } from "@/lib/thumbnails/staged";

// Node runtime (sharp is a native module); never statically cached.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const NO_STORE = { "Cache-Control": "private, no-store" };

/**
 * Stage a thumbnail for a post that is still being created (Publish wizard).
 * multipart field "file". Identity comes ONLY from the session cookie.
 * Returns { thumbnail: { ref, url, ... } }; send `ref` as `thumbnailRef` when publishing.
 */
export async function POST(req: NextRequest) {
  if (!isSameOriginRequest(req)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403, headers: NO_STORE });
  }
  try {
    const user = await getSessionUser(req);
    if (!user) return unauthorized();

    const { allowed } = rateLimit(`thumb-stage:${user.id}`, 15, 60_000);
    if (!allowed) {
      return NextResponse.json(
        { error: "Too many uploads. Please wait a minute and try again.", code: "rate_limited" },
        { status: 429, headers: { ...NO_STORE, "Retry-After": "60" } }
      );
    }

    // Cheap early rejection before buffering the body (multipart overhead allowance: 64 KB).
    const declared = Number(req.headers.get("content-length") ?? "0");
    if (declared > MAX_UPLOAD_BYTES + 64 * 1024) {
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

    const result = await stageThumbnail({ userId: user.id, bytes: new Uint8Array(await file.arrayBuffer()) });
    if (!result.ok) {
      const headers: Record<string, string> = { ...NO_STORE };
      if (result.retryAfter !== undefined) headers["Retry-After"] = String(Math.ceil(result.retryAfter));
      return NextResponse.json({ error: result.message, code: result.code }, { status: result.status, headers });
    }
    return NextResponse.json({ thumbnail: result.thumbnail }, { status: 201, headers: NO_STORE });
  } catch (err) {
    console.error("thumbnail_stage_route_failed", err instanceof Error ? err.message : "unknown_error");
    return NextResponse.json({ error: "Internal server error" }, { status: 500, headers: NO_STORE });
  }
}
