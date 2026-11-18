/**
 * Device-local "Saved items" for the public viewer. There are NO viewer accounts and nothing here touches a server.
 *
 * What is stored (localStorage, one JSON array under STORAGE_KEY):
 *   - type: "playlist" | "file"
 *   - id:   the playlist's public share token, or the file's public smart-link slug
 *   - path: the stable public path ("/p/<token>" or "/f/<slug>") — re-derived and checked on every read
 *   - title, thumbnailUrl (public CDN URL), savedAt
 *   - lastFile (playlists only): the public slug of the last selected file, to reopen where the visitor left off
 *
 * What is NEVER stored: original files, Telegram links / channel ids / file ids, passwords, unlock results.
 * A saved link only reopens the public page, which still runs every normal server-side access check.
 *
 * Playlists are saved as ONE entry keyed by the playlist token. Files inside a playlist are never saved on their own.
 * Reading is defensive: malformed JSON, unknown versions, invalid slugs and duplicates are dropped, never thrown.
 */

export const STORAGE_KEY = "onfile_saved_items_v1";
export const SAVED_CHANGE_EVENT = "onfile:saved-items-changed";
export const MAX_SAVED_ITEMS = 100;

export type SavedType = "playlist" | "file";

export interface SavedItem {
  type: SavedType;
  id: string;
  path: string;
  title: string;
  thumbnailUrl: string | null;
  savedAt: number;
  lastFile: string | null;
}

export type SavedInput = {
  type: SavedType;
  id: string;
  title: string;
  thumbnailUrl?: string | null;
  lastFile?: string | null;
};

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const TITLE_MAX = 200;

export function savedPath(type: SavedType, id: string): string {
  return `${type === "playlist" ? "/p/" : "/f/"}${id}`;
}

export function savedKey(type: SavedType, id: string): string {
  return `${type}:${id}`;
}

/** Link that reopens a saved entry. For playlists it adds the last selected file (the page validates it again). */
export function savedHref(item: SavedItem): string {
  if (item.type === "playlist" && item.lastFile) return `${item.path}?f=${encodeURIComponent(item.lastFile)}`;
  return item.path;
}

function safeThumb(v: unknown): string | null {
  if (typeof v !== "string" || v.length > 2048) return null;
  try {
    return new URL(v).protocol === "https:" ? v : null;
  } catch {
    return null;
  }
}

function cleanTitle(v: unknown): string {
  return typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, TITLE_MAX) : "";
}

/** Validates ONE stored entry; null when it is malformed or outdated. */
export function normalizeEntry(raw: unknown): SavedItem | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.type !== "playlist" && r.type !== "file") return null;
  if (typeof r.id !== "string" || !ID_RE.test(r.id)) return null;
  const type = r.type;
  const id = r.id;
  const lastFile = type === "playlist" && typeof r.lastFile === "string" && ID_RE.test(r.lastFile) ? r.lastFile : null;
  const savedAt = typeof r.savedAt === "number" && Number.isFinite(r.savedAt) && r.savedAt > 0 ? r.savedAt : 0;
  return {
    type,
    id,
    path: savedPath(type, id), // never trust a stored path
    title: cleanTitle(r.title) || (type === "playlist" ? "Playlist" : "File"),
    thumbnailUrl: safeThumb(r.thumbnailUrl),
    savedAt,
    lastFile,
  };
}

/** Parses the raw localStorage string. Never throws; returns newest first, de-duplicated, capped. */
export function parseSaved(raw: string | null | undefined): SavedItem[] {
  if (!raw) return [];
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  const seen = new Set<string>();
  const out: SavedItem[] = [];
  for (const entry of data) {
    const item = normalizeEntry(entry);
    if (!item) continue;
    const key = savedKey(item.type, item.id);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out.sort((a, b) => b.savedAt - a.savedAt).slice(0, MAX_SAVED_ITEMS);
}

/** Adds or refreshes ONE entry (same type+id never creates a second one). */
export function upsertSaved(items: SavedItem[], input: SavedInput, now = Date.now()): SavedItem[] {
  const next = normalizeEntry({ ...input, savedAt: now });
  if (!next) return items;
  const existing = items.find((i) => i.type === next.type && i.id === next.id);
  const merged: SavedItem = existing ? { ...next, savedAt: existing.savedAt, lastFile: next.lastFile ?? existing.lastFile } : next;
  return [merged, ...items.filter((i) => !(i.type === next.type && i.id === next.id))]
    .sort((a, b) => b.savedAt - a.savedAt)
    .slice(0, MAX_SAVED_ITEMS);
}

export function removeSaved(items: SavedItem[], type: SavedType, id: string): SavedItem[] {
  return items.filter((i) => !(i.type === type && i.id === id));
}

/** Only touches an entry that already exists (selecting files in a playlist must never create entries). */
export function withLastFile(items: SavedItem[], playlistId: string, fileSlug: string): SavedItem[] {
  if (!ID_RE.test(fileSlug)) return items;
  let changed = false;
  const next = items.map((i) => {
    if (i.type === "playlist" && i.id === playlistId && i.lastFile !== fileSlug) {
      changed = true;
      return { ...i, lastFile: fileSlug };
    }
    return i;
  });
  return changed ? next : items;
}

// ── Browser storage (all failures are swallowed: private mode, quota, disabled storage) ─────────────

export function readRaw(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

/** Persists and notifies this tab (other tabs get the native `storage` event). Returns false when storage failed. */
export function writeSaved(items: SavedItem[]): boolean {
  try {
    if (items.length === 0) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    return false;
  }
  try {
    window.dispatchEvent(new Event(SAVED_CHANGE_EVENT));
  } catch {
    /* ignore */
  }
  return true;
}

export function subscribeSaved(callback: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === STORAGE_KEY) callback();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(SAVED_CHANGE_EVENT, callback);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(SAVED_CHANGE_EVENT, callback);
  };
}
