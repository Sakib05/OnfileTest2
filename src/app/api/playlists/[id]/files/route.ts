import { NextRequest, NextResponse } from "next/server";
import { addFilesToPlaylist, listPlaylistFiles, parseFileIds, reorderPlaylist } from "@/lib/playlistMembers";
import { NO_STORE, badRequest, guard, idParam, memberError, playlistSnapshot, readJsonObject } from "@/lib/playlistApi";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Ordered contents of one of the caller's playlists. */
export async function GET(req: NextRequest, { params }: Ctx) {
  try {
    const g = await guard(req, false);
    if (!g.ok) return g.res;
    const playlistId = idParam((await params).id);
    if (!playlistId) return badRequest("Invalid playlist id");
    const list = await listPlaylistFiles(g.user.id, playlistId);
    if (!list) return NextResponse.json({ error: "Not found" }, { status: 404, headers: NO_STORE });
    return NextResponse.json({ files: list }, { headers: NO_STORE });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/** Add one or many existing library files: body { fileIds: number[] }. Duplicates are skipped. */
export async function POST(req: NextRequest, { params }: Ctx) {
  try {
    const g = await guard(req, true);
    if (!g.ok) return g.res;
    const playlistId = idParam((await params).id);
    if (!playlistId) return badRequest("Invalid playlist id");
    const body = await readJsonObject(req);
    const fileIds = parseFileIds(body?.fileIds);
    if (!fileIds) return badRequest("Choose between 1 and 200 files to add.");

    const result = await addFilesToPlaylist(g.user.id, playlistId, fileIds);
    if (!result.ok) return memberError(result.code, result.message);
    return NextResponse.json(
      { added: result.added, alreadyMembers: result.alreadyMembers, ...(await playlistSnapshot(g.user.id, playlistId)) },
      { headers: NO_STORE }
    );
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Couldn't add the files. Please try again." }, { status: 500 });
  }
}

/** Persist a new order: body { fileIds: number[] } = every current member, in the desired order. */
export async function PUT(req: NextRequest, { params }: Ctx) {
  try {
    const g = await guard(req, true);
    if (!g.ok) return g.res;
    const playlistId = idParam((await params).id);
    if (!playlistId) return badRequest("Invalid playlist id");
    const body = await readJsonObject(req);
    const fileIds = parseFileIds(body?.fileIds);
    if (!fileIds) return badRequest("Send the full list of file ids in the new order.");

    const result = await reorderPlaylist(g.user.id, playlistId, fileIds);
    if (!result.ok) return memberError(result.code, result.message);
    return NextResponse.json(await playlistSnapshot(g.user.id, playlistId), { headers: NO_STORE });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Couldn't save the new order. Please try again." }, { status: 500 });
  }
}
