import type { Metadata } from "next";
import { notFound } from "next/navigation";
import PlaylistAnalyticsPage from "@/components/playlists/analytics/PlaylistAnalyticsPage";

export const metadata: Metadata = { title: "Playlist Analytics – Onfile", robots: { index: false, follow: false } };

type Props = { params: Promise<{ id: string }> };

/**
 * Creator-only analytics for one playlist. Like the management page it is a thin client shell: the numbers come from
 * GET /api/playlists/:id/analytics, which verifies on the server that the signed-in user owns the playlist.
 */
export default async function PlaylistAnalyticsRoute({ params }: Props) {
  const { id } = await params;
  const playlistId = /^\d+$/.test(id) ? Number(id) : NaN;
  if (!Number.isSafeInteger(playlistId) || playlistId <= 0) notFound();
  return <PlaylistAnalyticsPage key={playlistId} playlistId={playlistId} />;
}
