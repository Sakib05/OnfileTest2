import { NextRequest, NextResponse } from "next/server";
import { and, eq, gt } from "drizzle-orm";
import { db } from "@/db";
import { files, reports } from "@/db/schema";
import { isSameOriginRequest } from "@/lib/auth";
import { findSharedPlaylist } from "@/lib/publicPlaylist";
import { getClientIp, rateLimit } from "@/lib/rateLimit";
import { parseReportBody } from "@/lib/reports";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" } as const;
const MAX_BODY_BYTES = 4_000;
const DEDUPE_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Public "Report" endpoint (no account needed).
 *
 * Request: { target: "file" | "playlist", slug, reason, details?, website? }
 *   - `slug` is the file's smart-link slug or the playlist's public share token. Numeric ids are never accepted
 *     or exposed, and the target is resolved here, so a report can only point at something that is publicly reachable.
 *   - A file target must be published; a playlist target must be shared + published (same 404 rule as the public page).
 *
 * Abuse protection: same-origin check, body size cap, honeypot field, per-IP rate limit, and de-duplication
 * (the same reporter reporting the same target for the same reason within 24h is acknowledged, not stored twice).
 * The response is `{ ok: true }` only: reports are never listed publicly and nothing about the target is echoed.
 */
export async function POST(req: NextRequest) {
  try {
    if (!isSameOriginRequest(req)) {
      return NextResponse.json({ error: "Invalid request origin" }, { status: 403, headers: NO_STORE });
    }

    const ip = getClientIp(req);
    if (!rateLimit(`report:${ip}`, 5, 10 * 60_000).allowed) {
      return NextResponse.json({ error: "Too many reports. Please try again later." }, { status: 429, headers: NO_STORE });
    }

    const text = await req.text();
    if (text.length > MAX_BODY_BYTES) {
      return NextResponse.json({ error: "Report is too large." }, { status: 413, headers: NO_STORE });
    }
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      return NextResponse.json({ error: "Invalid request" }, { status: 400, headers: NO_STORE });
    }
    const parsed = parseReportBody(raw);
    if (!parsed) {
      return NextResponse.json({ error: "Please choose a reason and try again." }, { status: 400, headers: NO_STORE });
    }
    // Bots fill hidden fields. Pretend it worked, store nothing.
    if (parsed.honeypot) return NextResponse.json({ ok: true }, { status: 201, headers: NO_STORE });

    let fileId: number | null = null;
    let playlistId: number | null = null;

    if (parsed.target === "file") {
      const [file] = await db
        .select({ id: files.id, isPublished: files.isPublished })
        .from(files)
        .where(eq(files.smartLinkSlug, parsed.fileSlug as string))
        .limit(1);
      if (!file || !file.isPublished) {
        return NextResponse.json({ error: "This content is no longer available." }, { status: 404, headers: NO_STORE });
      }
      fileId = file.id;
    } else {
      const playlist = await findSharedPlaylist(parsed.playlistSlug as string);
      if (!playlist) {
        return NextResponse.json({ error: "This content is no longer available." }, { status: 404, headers: NO_STORE });
      }
      playlistId = playlist.id;
    }

    const reporterIp = ip.slice(0, 64);
    const since = new Date(Date.now() - DEDUPE_WINDOW_MS);
    const [existing] = await db
      .select({ id: reports.id })
      .from(reports)
      .where(
        and(
          eq(reports.reporterIp, reporterIp),
          eq(reports.reason, parsed.reason),
          gt(reports.createdAt, since),
          fileId !== null ? eq(reports.fileId, fileId) : eq(reports.playlistId, playlistId as number)
        )
      )
      .limit(1);

    if (!existing) {
      await db.insert(reports).values({
        fileId,
        playlistId,
        reason: parsed.reason,
        description: parsed.details,
        reporterIp,
        status: "pending",
      });
    }

    return NextResponse.json({ ok: true }, { status: 201, headers: NO_STORE });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500, headers: NO_STORE });
  }
}
