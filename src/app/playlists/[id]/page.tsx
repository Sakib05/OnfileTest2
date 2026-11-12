import type { Metadata } from "next";
import { notFound } from "next/navigation";
import PlaylistPage from "@/components/playlists/PlaylistPage";

export const metadata: Metadata = { title: "Playlist – Onfile" };

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ edit?: string | string[] }>;
};

/**
 * Full-page playlist details. Data is loaded client-side through the existing, session-scoped
 * playlist APIs (the same ones the Library uses), so ownership checks stay server-side.
 */
export default async function PlaylistRoute({ params, searchParams }: Props) {
  const { id } = await params;
  const { edit } = await searchParams;
  const playlistId = /^\d+$/.test(id) ? Number(id) : NaN;
  if (!Number.isSafeInteger(playlistId) || playlistId <= 0) notFound();
  return <PlaylistPage key={playlistId} playlistId={playlistId} initialView={edit === "1" ? "edit" : "list"} />;
}
