import { NextRequest, NextResponse } from "next/server";
import { listFilePlaylistMemberships } from "@/lib/playlistMembers";
import { NO_STORE, guard, idParam, badRequest } from "@/lib/playlistApi";

export const dynamic = "force-dynamic";

/**
 * Library → file ⋮ → Manage playlists / File details: the caller's playlists, each flagged with whether
 * this file is already inside. Read-only; changes go through the existing membership endpoints
 * (POST /api/playlists/:id/files, DELETE /api/playlists/:id/files/:fileId), which enforce ownership
 * and the (playlist, file) uniqueness. Owner-scoped: someone else's file is indistinguishable from a missing one.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const g = await guard(req, false);
    if (!g.ok) return g.res;
    const fileId = idParam((await params).id);
    if (!fileId) return badRequest("Invalid file id");
    const playlists = await listFilePlaylistMemberships(g.user.id, fileId);
    if (!playlists) return NextResponse.json({ error: "Not found" }, { status: 404, headers: NO_STORE });
    return NextResponse.json({ playlists }, { headers: NO_STORE });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
