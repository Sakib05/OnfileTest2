import { NextRequest, NextResponse } from "next/server";
import { removeFileFromPlaylist } from "@/lib/playlistMembers";
import { NO_STORE, badRequest, guard, idParam, memberError, playlistSnapshot } from "@/lib/playlistApi";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; fileId: string }> };

/**
 * Removes the file from THIS playlist only. The file stays in the Library and in
 * all its other playlists — this route has no code path that deletes a file.
 */
export async function DELETE(req: NextRequest, { params }: Ctx) {
  try {
    const g = await guard(req, true);
    if (!g.ok) return g.res;
    const p = await params;
    const playlistId = idParam(p.id);
    const fileId = idParam(p.fileId);
    if (!playlistId || !fileId) return badRequest("Invalid id");

    const result = await removeFileFromPlaylist(g.user.id, playlistId, fileId);
    if (!result.ok) return memberError(result.code, result.message);
    return NextResponse.json({ success: true, ...(await playlistSnapshot(g.user.id, playlistId)) }, { headers: NO_STORE });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Couldn't remove the file from the playlist. Please try again." }, { status: 500 });
  }
}
