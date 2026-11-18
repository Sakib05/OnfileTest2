export interface PlaylistSummary {
  id: number;
  title: string;
  description?: string | null;
  totalFiles?: number;
  totalDownloads?: number;
  thumbnailUrl?: string | null;
  hasPassword?: boolean;
  starsPrice?: number;
  isPublished?: boolean;
  /** Owner-only: the unguessable public token once the playlist has been shared. */
  shareSlug?: string | null;
}

export interface MemberFile {
  id: number;
  title: string;
  fileType: string | null;
  mimeType: string | null;
  fileSize: number | null;
  isPublished: boolean | null;
  /** Smart-link slug of the published file (opens the existing /f/<slug> viewer); null while unpublished. */
  smartLinkSlug?: string | null;
  starsPrice?: number | null;
  hasPassword?: boolean;
  thumbnailUrl: string | null;
  position: number;
}

export interface LibraryFile {
  id: number;
  title: string;
  fileType: string | null;
  mimeType?: string | null;
  fileSize?: number | null;
  isPublished?: boolean | null;
  thumbnailUrl?: string | null;
}

export const JSON_HEADERS = { "Content-Type": "application/json" };

export async function readJson(res: Response): Promise<Record<string, unknown> | null> {
  return (await res.json().catch(() => null)) as Record<string, unknown> | null;
}

/** A file is openable by visitors only when it is published AND has its smart link. */
export const isOpenable = (f: Pick<MemberFile, "isPublished" | "smartLinkSlug">) => !!f.smartLinkSlug && !!f.isPublished;
