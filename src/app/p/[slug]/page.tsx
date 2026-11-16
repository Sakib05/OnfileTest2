import type { Metadata } from "next";
import PublicPlaylistView from "@/components/playlists/PublicPlaylistView";
import { isValidShareSlug } from "@/lib/playlistSharing";
import { findSharedPlaylist } from "@/lib/publicPlaylist";

type Props = { params: Promise<{ slug: string }> };

/** Link-preview metadata (Telegram / social cards). Only the public title + description — never anything private. */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const fallback: Metadata = { title: "Playlist – Onfile", robots: { index: false, follow: false } };
  if (!isValidShareSlug(slug)) return fallback;
  try {
    const row = await findSharedPlaylist(slug);
    if (!row) return fallback;
    const description = row.description?.trim() || "A playlist shared on Onfile";
    return {
      title: `${row.title} – Onfile`,
      description,
      robots: { index: false, follow: false }, // shared by link, not meant for search engines
      openGraph: { title: row.title, description, type: "website" },
    };
  } catch {
    return fallback;
  }
}

/**
 * Public playlist page (route: /p/<token>). No login needed. The page is a thin shell: all data comes from
 * GET /api/p/<token>, which enforces publishing, password and price rules on the server.
 */
export default async function SharedPlaylistRoute({ params }: Props) {
  const { slug } = await params;
  return <PublicPlaylistView slug={slug} />;
}
