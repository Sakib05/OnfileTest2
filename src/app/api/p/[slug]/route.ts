import { NextRequest, NextResponse } from "next/server";
import { getSessionUser, isSameOriginRequest } from "@/lib/auth";
import { verifyAccessPassword } from "@/lib/password";
import { getClientIp, rateLimit } from "@/lib/rateLimit";
import { recordPlaylistView } from "@/lib/playlistAnalytics";
import {
  UNLOCK_COOKIE_MAX_AGE,
  buildPublicPayload,
  findSharedPlaylist,
  lockFor,
  makeUnlockToken,
  unlockCookieName,
  verifyUnlockToken,
} from "@/lib/publicPlaylist";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" } as const;
const NOT_FOUND = () => NextResponse.json({ error: "Playlist not found" }, { status: 404, headers: NO_STORE });

type Ctx = { params: Promise<{ slug: string }> };

/**
 * Public view of a SHARED playlist (no login needed). Access is decided entirely here:
 * published + valid token, then password / price locks. See src/lib/publicPlaylist.ts.
 */
export async function GET(req: NextRequest, { params }: Ctx) {
  try {
    const { slug } = await params;
    const row = await findSharedPlaylist(slug);
    if (!row) return NOT_FOUND();

    // The creator may preview their own playlist without re-typing its password. Anonymous visitors are fine too.
    const user = await getSessionUser(req).catch(() => null);
    const isOwner = !!user && user.id === row.userId;
    const unlocked = verifyUnlockToken(row, req.cookies.get(unlockCookieName(slug))?.value);

    const payload = await buildPublicPayload(row, lockFor(row, { isOwner, unlocked }));
    const res = NextResponse.json(payload, { headers: NO_STORE });
    // Playlist analytics: one deduplicated view per anonymous visitor (never the owner, bots or prefetches). Never throws.
    await recordPlaylistView(req, res, row.id, { isOwner });
    return res;
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500, headers: NO_STORE });
  }
}

/** Unlocks a password-protected shared playlist for this browser (signed HttpOnly cookie). Rate limited. */
export async function POST(req: NextRequest, { params }: Ctx) {
  try {
    if (!isSameOriginRequest(req)) {
      return NextResponse.json({ error: "Invalid request origin" }, { status: 403, headers: NO_STORE });
    }
    const { slug } = await params;
    const { allowed } = rateLimit(`playlist-unlock:${getClientIp(req)}`, 10, 60_000);
    if (!allowed) {
      return NextResponse.json({ error: "Too many attempts. Please try again shortly." }, { status: 429, headers: NO_STORE });
    }

    const row = await findSharedPlaylist(slug);
    if (!row) return NOT_FOUND();
    if ((row.starsPrice ?? 0) > 0) {
      return NextResponse.json({ error: "This playlist requires a Stars payment, which isn't available yet.", reason: "paid_unavailable" }, { status: 403, headers: NO_STORE });
    }
    if (!row.password) return NextResponse.json({ success: true }, { headers: NO_STORE });

    let password = "";
    try {
      const body = (await req.json()) as { password?: unknown };
      if (typeof body?.password === "string") password = body.password;
    } catch {
      /* treated as an empty (wrong) password */
    }
    if (!verifyAccessPassword(password, row.password)) {
      return NextResponse.json({ error: "Wrong password" }, { status: 403, headers: NO_STORE });
    }

    const res = NextResponse.json({ success: true }, { headers: NO_STORE });
    res.cookies.set(unlockCookieName(slug), makeUnlockToken(row), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: UNLOCK_COOKIE_MAX_AGE,
    });
    return res;
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500, headers: NO_STORE });
  }
}
