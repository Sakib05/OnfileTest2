/**
 * Pure, UI-free logic for the My Library screen: category filters, search and
 * the organisation of the "Home" view into category sections.
 *
 * Nothing here talks to the network or the database. The library is fetched
 * once (GET /api/files + /api/playlists, both already scoped to the signed-in
 * creator server-side) and every section below is *derived* from that single
 * in-memory snapshot — so Home needs no extra queries and never shows another
 * creator's content, and a file that appears in two sections is still one record.
 */

/** Category tabs, in display order. "Home" replaces the former "All". */
export const LIBRARY_FILTERS = ["Home", "Video", "Document", "Audio", "Image", "Archive", "Playlist"] as const;
export type LibraryFilter = (typeof LIBRARY_FILTERS)[number];

/** How many cards a Home row shows before "See all" is offered. */
export const HOME_ROW_LIMIT = 8;

export type HomeSectionKey = "recent" | "video" | "document" | "audio" | "image" | "archive" | "playlist";

export interface HomeSection<T> {
  key: HomeSectionKey;
  title: string;
  /** Category tab "See all" opens; null → this section expands in place (Recently Added). */
  filter: LibraryFilter | null;
  kind: "file" | "playlist";
  /** At most HOME_ROW_LIMIT items. */
  items: T[];
  /** Number of matching items in the whole library (≥ items.length). */
  total: number;
}

interface HasTitle {
  title: string;
}
interface HasCreatedAt {
  createdAt: string | Date | null | undefined;
}
interface LibraryFileLike extends HasTitle, HasCreatedAt {
  fileType: string;
}

/** Case-insensitive title match; an empty/blank query matches everything. */
export function matchesQuery(title: string | null | undefined, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (title ?? "").toLowerCase().includes(q);
}

export function filterByQuery<T extends HasTitle>(items: T[], query: string): T[] {
  if (!query.trim()) return items;
  return items.filter((i) => matchesQuery(i.title, query));
}

function time(v: string | Date | null | undefined): number {
  if (!v) return 0;
  const t = v instanceof Date ? v.getTime() : Date.parse(v);
  return Number.isNaN(t) ? 0 : t;
}

/** Newest first. Stable for equal timestamps (keeps the API's order). */
export function sortNewestFirst<T extends HasCreatedAt>(items: T[]): T[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => time(b.item.createdAt) - time(a.item.createdAt) || a.index - b.index)
    .map((x) => x.item);
}

/** Files shown for a category tab (the former `fi.fileType === f` rule). */
export function filesForFilter<T extends { fileType: string }>(files: T[], filter: LibraryFilter): T[] {
  if (filter === "Home") return files;
  if (filter === "Playlist") return [];
  return files.filter((f) => f.fileType === filter.toLowerCase());
}

const CATEGORY_SECTIONS: { key: Exclude<HomeSectionKey, "recent" | "playlist">; title: string; filter: LibraryFilter }[] = [
  { key: "video", title: "Videos", filter: "Video" },
  { key: "document", title: "Documents", filter: "Document" },
  { key: "audio", title: "Audio", filter: "Audio" },
  { key: "image", title: "Images", filter: "Image" },
  { key: "archive", title: "Archives", filter: "Archive" },
];

/**
 * Builds the Home view: Recently Added, Videos, Documents, Audio, Images,
 * Archives, Playlists — in that order, each holding only relevant content, and
 * omitted entirely when empty. Within every section items are newest first.
 */
export function buildHomeSections<F extends LibraryFileLike, P extends HasTitle & HasCreatedAt>(
  files: F[],
  playlists: P[],
  limit: number = HOME_ROW_LIMIT
): HomeSection<F | P>[] {
  const sections: HomeSection<F | P>[] = [];
  const newest = sortNewestFirst(files);

  if (newest.length > 0) {
    sections.push({
      key: "recent",
      title: "Recently Added",
      filter: null,
      kind: "file",
      items: newest.slice(0, limit),
      total: newest.length,
    });
  }

  for (const c of CATEGORY_SECTIONS) {
    const inCategory = newest.filter((f) => f.fileType === c.filter.toLowerCase());
    if (inCategory.length === 0) continue;
    sections.push({
      key: c.key,
      title: c.title,
      filter: c.filter,
      kind: "file",
      items: inCategory.slice(0, limit),
      total: inCategory.length,
    });
  }

  if (playlists.length > 0) {
    const pls = sortNewestFirst(playlists);
    sections.push({
      key: "playlist",
      title: "Playlists",
      filter: "Playlist",
      kind: "playlist",
      items: pls.slice(0, limit),
      total: pls.length,
    });
  }

  return sections;
}

/** True when "See all" would reveal more than the row already shows. */
export function hasMore(section: Pick<HomeSection<unknown>, "items" | "total">): boolean {
  return section.total > section.items.length;
}
