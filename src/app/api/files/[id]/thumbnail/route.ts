import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { files } from "@/db/schema";
import { getSessionUser, isSameOriginRequest, unauthorized } from "@/lib/auth";
import { sharedRateLimit } from "@/lib/storage/sharedRateLimit";
import {
  canAccessThumbnail,
  deliverThumbnail,
  ImageValidationError,
  removeThumbnail,
  ThumbnailError,
  uploadThumbnail,
} from "@/lib/storage/thumbnails";
import { MAX_UPLOAD_BYTES } from "@/lib/storage/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function parseId(raw: string): number | null {
  return /^\d{1,9}$/.test(raw) ? parseInt(raw, 10) : null;
}

const VALIDATION_MESSAGES: Record<string, { status: number; message: string }> = {
  empty: { status: 400, message: "The selected image is empty." },
  too_large: { status: 413, message: "Image is too large. The maximum size is 2 MB." },
  unsupported_format: { status: 415, message: "Unsupported image type. Please use a JPEG, PNG or WebP image." },
  mime_mismatch: { status: 415, message: "The file type does not match its content. Please choose a real JPEG, PNG or WebP image." },
  animated: { status: 415, message: "Animated images are not supported. Please choose a still image." },
  corrupt: { status: 400, message: "This image looks corrupt and could not be read. Please choose another one." },
  invalid_dimensions: { status: 400, message: "This image's dimensions are not supported." },
};

/** Owner (or any signed-in viewer of a PUBLISHED file): authorised thumbnail delivery. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getSessionUser(req);
    if (!user) return unauthorized();
    const fileId = parseId((await params).id);
    if (fileId === null) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const limited = await sharedRateLimit(`thumb-get:u${user.id}`, 600, 60);
    if (!limited.allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

    const [file] = await db.select({ id: files.id, userId: files.userId, isPublished: files.isPublished }).from(files).where(eq(files.id, fileId)).limit(1);
    // Unpublished + not the owner => indistinguishable from "does not exist".
    if (!file || !canAccessThumbnail(file, user.id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return await deliverThumbnail(file.id);
  } catch (err) {
    console.error("thumbnail_get_failed", err instanceof Error ? err.message : "unknown");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/** Owner-only: upload or replace a thumbnail (multipart/form-data, field "file"). */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isSameOriginRequest(req)) return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  try {
    const user = await getSessionUser(req);
    if (!user) return unauthorized();
    const fileId = parseId((await params).id);
    if (fileId === null) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const limited = await sharedRateLimit(`thumb-upload:u${user.id}`, 15, 600);
    if (!limited.allowed) {
      return NextResponse.json({ error: "Too many thumbnail uploads. Please wait a few minutes and try again." }, { status: 429 });
    }

    const [file] = await db.select({ id: files.id }).from(files).where(and(eq(files.id, fileId), eq(files.userId, user.id))).limit(1);
    if (!file) return NextResponse.json({ error: "File not found" }, { status: 404 });

    const declaredLength = Number(req.headers.get("content-length") ?? "0");
    if (declaredLength > MAX_UPLOAD_BYTES + 64 * 1024) {
      return NextResponse.json({ error: VALIDATION_MESSAGES.too_large.message }, { status: 413 });
    }

    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return NextResponse.json({ error: "Invalid upload. Please choose an image and try again." }, { status: 400 });
    }
    const upload = form.get("file");
    if (!(upload instanceof File)) return NextResponse.json({ error: "No image was provided." }, { status: 400 });
    if (upload.size > MAX_UPLOAD_BYTES) return NextResponse.json({ error: VALIDATION_MESSAGES.too_large.message }, { status: 413 });

    const buffer = Buffer.from(await upload.arrayBuffer());
    const result = await uploadThumbnail({ fileId, ownerId: user.id, image: buffer, declaredMime: upload.type || null });
    return NextResponse.json(
      {
        thumbnail: {
          width: result.asset.width,
          height: result.asset.height,
          size: result.asset.fileSize,
          mimeType: result.asset.mimeType,
          updatedAt: result.asset.updatedAt,
          replaced: result.replaced,
        },
      },
      { status: 201 }
    );
  } catch (err) {
    if (err instanceof ImageValidationError) {
      const m = VALIDATION_MESSAGES[err.reason] ?? { status: 400, message: err.message };
      return NextResponse.json({ error: m.message, reason: err.reason }, { status: m.status });
    }
    if (err instanceof ThumbnailError) return NextResponse.json({ error: err.message, reason: err.code }, { status: err.status });
    console.error("thumbnail_upload_failed", err instanceof Error ? err.message : "unknown");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/** Owner-only: remove the thumbnail. */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isSameOriginRequest(req)) return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  try {
    const user = await getSessionUser(req);
    if (!user) return unauthorized();
    const fileId = parseId((await params).id);
    if (fileId === null) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const limited = await sharedRateLimit(`thumb-delete:u${user.id}`, 30, 600);
    if (!limited.allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    const result = await removeThumbnail(fileId, user.id);
    return NextResponse.json({ success: true, removed: result.removed });
  } catch (err) {
    if (err instanceof ThumbnailError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("thumbnail_delete_failed", err instanceof Error ? err.message : "unknown");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
