import { NextRequest, NextResponse } from "next/server";
import { transferFile } from "@/lib/playlistMembers";
import { NO_STORE, badRequest, guard, idParam, memberError, readJsonObject } from "@/lib/playlistApi";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; fileId: string }> };

/**
 * body { toPlaylistId: number, mode: "add" | "move" }
 *   add  → file stays here AND is added to the destination
 *   move → file leaves this playlist and is added to the destination
 * Both playlists and the file must belong to the caller.
 */
export async function POST(req: NextRequest, { params }: Ctx) {
  try {
    const g = await guard(req, true);
    if (!g.ok) return g.res;
    const p = await params;
    const fromId = idParam(p.id);
    const fileId = idParam(p.fileId);
    if (!fromId || !fileId) return badRequest("Invalid id");

    const body = await readJsonObject(req);
    const toId = typeof body?.toPlaylistId === "number" && Number.isInteger(body.toPlaylistId) ? idParam(String(body.toPlaylistId)) : null;
    if (!toId) return badRequest("Choose a destination playlist.");
    if (body?.mode !== "add" && body?.mode !== "move") return badRequest('mode must be "add" or "move".');

    const result = await transferFile(g.user.id, fromId, toId, fileId, body.mode);
    if (!result.ok) return memberError(result.code, result.message);
    return NextResponse.json(
      { success: true, mode: result.mode, alreadyInDestination: result.alreadyInDestination },
      { headers: NO_STORE }
    );
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Couldn't update the playlists. Please try again." }, { status: 500 });
  }
}
