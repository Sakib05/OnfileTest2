import { NextRequest, NextResponse } from "next/server";
import { getSessionUser, isSameOriginRequest, unauthorized } from "@/lib/auth";
import { rateLimit } from "@/lib/rateLimit";
import { MAX_UPLOAD_BYTES } from "@/lib/thumbnails/imageProcessing";
import { removeThumbnail, uploadThumbnail, type ServiceFailure } from "@/lib/thumbnails/service";

// Node runtime (sharp is a native module); never statically cached.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const NO_STORE = { "Cache-Control": "private, no-store" };

function failure(f: ServiceFailure) {
  const headers: Record<string, string> = { ...NO_STORE };
  if (f.retryAfter !== undefined) headers["Retry-After"] = String(Math.ceil(f.retryAfter));
  return NextResponse.json(
    { error: f.message, code: f.code, ...(f.retryAfter !== undefined ? { retryAfter: f.retryAfter } : {}) },
    { status: f.status, headers }
  );
}

function parseFileId(raw: string): number | null {
  if (!/^\d{1,9}$/.test(raw)) return null;
  const n = Number(raw);
  return n > 0 ? n : null;
}

/** Upload or replace the thumbnail of one of the caller's own files. multipart field: "file". */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isSameOriginRequest(req)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403, headers: NO_STORE });
  }
  try {
    // Identity ONLY from the verified server-side session cookie. Any
    // client-supplied user/telegram id (headers, form fields) is ignored.
    const user = await getSessionUser(req);
    if (!user) return unauthorized();

    const { id } = await params;
    const fileId = parseFileId(id);
    if (!fileId) return NextResponse.json({ error: "Invalid file id" }, { status: 400, headers: NO_STORE });

    const { allowed } = rateLimit(`thumb-upload:${user.id}`, 10, 60_000);
    if (!allowed) {
      return NextResponse.json(
        { error: "Too many uploads. Please wait a minute and try again.", code: "rate_limited" },
        { status: 429, headers: { ...NO_STORE, "Retry-After": "60" } }
      );
    }

    // Cheap early rejection before buffering the body (multipart overhead allowance: 64 KB).
    const declared = Number(req.headers.get("content-length") ?? "0");
    if (declared > MAX_UPLOAD_BYTES + 64 * 1024) {
      return NextResponse.json({ error: "Image must be 2 MB or smaller.", code: "too_large" }, { status: 413, headers: NO_STORE });
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
      return NextResponse.json({ error: "Image must be 2 MB or smaller.", code: "too_large" }, { status: 413, headers: NO_STORE });
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const result = await uploadThumbnail({ userId: user.id, fileId, bytes });
    if (!result.ok) return failure(result);

    return NextResponse.json(
      {
        thumbnail: result.thumbnail,
        optimized: { originalBytes: result.originalSizeBytes, storedBytes: result.thumbnail.sizeBytes },
      },
      { status: 200, headers: NO_STORE }
    );
  } catch (err) {
    console.error("thumbnail_upload_route_failed", err instanceof Error ? err.message : "unknown_error");
    return NextResponse.json({ error: "Internal server error" }, { status: 500, headers: NO_STORE });
  }
}

/** Remove the thumbnail of one of the caller's own files. */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isSameOriginRequest(req)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403, headers: NO_STORE });
  }
  try {
    const user = await getSessionUser(req);
    if (!user) return unauthorized();

    const { id } = await params;
    const fileId = parseFileId(id);
    if (!fileId) return NextResponse.json({ error: "Invalid file id" }, { status: 400, headers: NO_STORE });

    const result = await removeThumbnail({ userId: user.id, fileId });
    if (!result.ok) return failure(result);
    return NextResponse.json({ success: true, removed: result.removed }, { headers: NO_STORE });
  } catch (err) {
    console.error("thumbnail_delete_route_failed", err instanceof Error ? err.message : "unknown_error");
    return NextResponse.json({ error: "Internal server error" }, { status: 500, headers: NO_STORE });
  }
}
