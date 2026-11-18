"use client";
import { useCallback, useMemo, useSyncExternalStore } from "react";
import {
  parseSaved,
  readRaw,
  removeSaved,
  savedKey,
  subscribeSaved,
  upsertSaved,
  withLastFile,
  writeSaved,
  type SavedInput,
  type SavedItem,
  type SavedType,
} from "@/lib/savedItems";

const serverSnapshot = () => null;

/** Reactive view of this device's saved items (also follows changes made in other tabs). */
export function useSavedItems() {
  // The raw string is a stable primitive, so React re-renders only when the stored value really changes.
  const raw = useSyncExternalStore(subscribeSaved, readRaw, serverSnapshot);
  const items = useMemo(() => parseSaved(raw), [raw]);
  const keys = useMemo(() => new Set(items.map((i) => savedKey(i.type, i.id))), [items]);

  const isSaved = useCallback((type: SavedType, id: string) => keys.has(savedKey(type, id)), [keys]);

  // Always re-read storage right before writing so concurrent tabs don't overwrite each other.
  const save = useCallback((input: SavedInput): boolean => writeSaved(upsertSaved(parseSaved(readRaw()), input)), []);
  const remove = useCallback((type: SavedType, id: string): boolean => writeSaved(removeSaved(parseSaved(readRaw()), type, id)), []);
  const clear = useCallback((): boolean => writeSaved([]), []);
  const rememberLastFile = useCallback((playlistId: string, fileSlug: string) => {
    const current = parseSaved(readRaw());
    const next = withLastFile(current, playlistId, fileSlug);
    if (next !== current) writeSaved(next);
  }, []);

  return { items: items as SavedItem[], count: items.length, isSaved, save, remove, clear, rememberLastFile };
}
