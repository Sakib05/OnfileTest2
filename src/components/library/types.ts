/** Shapes returned by GET /api/files and GET /api/playlists, as used by My Library. */
export interface FileItem {
  id: number;
  title: string;
  description?: string;
  fileType: string;
  mimeType?: string | null;
  /** Kept on the record (backend metadata) but intentionally never rendered in My Library. */
  fileSize?: number;
  starsPrice?: number;
  password?: string;
  isPublished: boolean;
  views?: number;
  downloads?: number;
  earnings?: string;
  smartLinkSlug?: string;
  createdAt: string;
  category?: string;
  thumbnailUrl?: string | null;
  thumbnailWidth?: number | null;
  thumbnailHeight?: number | null;
}

export interface PlaylistItem {
  id: number;
  title: string;
  description?: string | null;
  totalFiles?: number;
  totalViews?: number;
  totalDownloads?: number;
  starsPrice?: number;
  hasPassword?: boolean;
  isPublished: boolean;
  createdAt: string;
  /** Derived from the playlist's first file; null → default playlist image. */
  thumbnailUrl?: string | null;
}

export type CardLayout = "list" | "grid" | "row";

export type MenuTarget = { id: number; type: "file" | "playlist"; anchor: DOMRect };
