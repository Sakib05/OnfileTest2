"use client";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Check, ListPlus, Loader2, Search, Send } from "lucide-react";
import FileThumb from "@/components/ui/FileThumb";
import { useToast } from "@/components/ui/Toast";
import { cn, formatBytes } from "@/lib/utils";
import { fileKindLabel } from "@/lib/fileKinds";
import { JSON_HEADERS, readJson, type LibraryFile } from "./types";

/**
 * Add files from the Creator's connected Telegram channel.
 *
 * The existing workflow is preserved: files reach the Library when the creator publishes a post from their
 * connected channel, and a playlist is an ordered list of REFERENCES to those files (POST /api/playlists/:id/files).
 * Nothing is downloaded, copied or re-uploaded. Ownership is enforced by the server (a foreign id fails the request)
 * and the server skips files that are already members, so duplicates can't be stored even if the UI is bypassed.
 */
export default function AddFilesView({
  playlistId,
  memberIds,
  onAdded,
  onGoCreate,
}: {
  playlistId: number;
  memberIds: Set<number>;
  onAdded: (data: Record<string, unknown> | null) => void;
  /** Sends the creator to the Create tab (where channel posts become Library files). */
  onGoCreate: () => void;
}) {
  const { toast } = useToast();
  const [library, setLibrary] = useState<LibraryFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const loadLibrary = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch("/api/files", { cache: "no-store" });
      if (!res.ok) throw new Error("failed");
      const data = await readJson(res);
      setLibrary(Array.isArray(data?.files) ? (data!.files as LibraryFile[]) : []);
    } catch {
      setLoadError("Couldn't load the files from your channel. Please try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Initial network load on mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadLibrary();
  }, [loadLibrary]);

  const shown = useMemo(() => library.filter((f) => !query.trim() || f.title.toLowerCase().includes(query.trim().toLowerCase())), [library, query]);
  const selectable = shown.filter((f) => !memberIds.has(f.id));
  const allSelected = selectable.length > 0 && selectable.every((f) => selected.has(f.id));
  const availableTotal = library.filter((f) => !memberIds.has(f.id)).length;

  const toggle = (id: number) =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleAll = () =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (allSelected) selectable.forEach((f) => next.delete(f.id));
      else selectable.forEach((f) => next.add(f.id));
      return next;
    });

  const submit = async () => {
    if (selected.size === 0 || saving) return;
    setSaving(true);
    setSubmitError(null);
    try {
      // Keep the Library's order so files land in the playlist in the order the creator sees them.
      const ids = library.filter((f) => selected.has(f.id) && !memberIds.has(f.id)).map((f) => f.id);
      const res = await fetch(`/api/playlists/${playlistId}/files`, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ fileIds: ids }) });
      const data = await readJson(res);
      if (!res.ok) {
        const msg = String(data?.error ?? "Couldn't add the files. Please try again.");
        setSubmitError(msg);
        toast(msg, "error");
        return;
      }
      const added = Array.isArray(data?.added) ? data!.added.length : 0;
      const skipped = Array.isArray(data?.alreadyMembers) ? data!.alreadyMembers.length : 0;
      toast(
        added > 0 ? `Added ${added} ${added === 1 ? "file" : "files"}${skipped ? ` (${skipped} already in the playlist)` : ""}` : "Those files are already in the playlist",
        added > 0 ? "success" : "info"
      );
      onAdded(data);
    } catch {
      setSubmitError("Network error. Please try again.");
      toast("Network error. Please try again.", "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-3" data-testid="add-files">
      <p className="text-sm text-secondary">
        Pick files from your connected Telegram channel. They&apos;re added by reference — the originals stay in your channel and are never copied or changed.
      </p>

      {loading ? (
        <div className="flex flex-col gap-2" role="status" aria-label="Loading your files" aria-busy="true">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-16 rounded-xl bg-card border border-app animate-pulse-brand" />
          ))}
        </div>
      ) : loadError ? (
        <div className="text-center py-6">
          <p role="alert" className="text-sm text-red-500 mb-3">{loadError}</p>
          <button type="button" className="btn-secondary min-h-11 text-sm px-4 py-2" onClick={() => void loadLibrary()}>Try again</button>
        </div>
      ) : library.length === 0 ? (
        <div className="text-center py-10 px-3 rounded-2xl border border-dashed border-app" data-testid="add-files-empty-channel">
          <Send size={22} className="mx-auto text-muted mb-2" aria-hidden="true" />
          <p className="text-sm font-semibold text-primary mb-1">No files from your channel yet</p>
          <p className="text-sm text-secondary mb-4">Post a file in your connected Telegram channel, then publish it from the Create tab. It will appear here.</p>
          <button type="button" className="btn-primary min-h-11 px-5 py-2.5 text-sm" onClick={onGoCreate}>Go to Create</button>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2 h-11 pl-3.5 pr-3 rounded-xl border-[1.5px] border-app bg-secondary focus-within:border-[#FF6115] focus-within:shadow-[0_0_0_3px_rgba(255,97,21,0.15)] transition-[border-color,box-shadow]">
            <Search size={15} className="flex-shrink-0 text-muted" aria-hidden="true" />
            <input
              className="flex-1 min-w-0 h-full p-0 bg-transparent border-0 outline-none text-sm text-primary placeholder:text-muted appearance-none [&::-webkit-search-cancel-button]:hidden"
              type="search"
              placeholder="Search your files…"
              aria-label="Search your files"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          <div className="flex items-center justify-between gap-2 min-h-9">
            <p className="text-xs text-secondary" aria-live="polite">
              {availableTotal === 0 ? "Every file is already in this playlist" : `${selected.size} selected · ${availableTotal} available`}
            </p>
            {selectable.length > 0 && (
              <button type="button" onClick={toggleAll} className="min-h-9 px-2 text-xs font-semibold text-brand rounded-lg focus-visible:outline-2 focus-visible:outline-[var(--color-primary)]" data-testid="select-all">
                {allSelected ? "Clear selection" : query.trim() ? "Select all results" : "Select all"}
              </button>
            )}
          </div>

          {shown.length === 0 ? (
            <p className="text-sm text-secondary text-center py-6">No files match your search.</p>
          ) : (
            <ul className="flex flex-col gap-2" data-testid="library-picker">
              {shown.map((f) => {
                const already = memberIds.has(f.id);
                const checked = selected.has(f.id);
                return (
                  <li key={f.id}>
                    <label className={cn("flex items-center gap-3 rounded-xl border border-app bg-card p-2.5 min-h-14", already ? "opacity-60" : "cursor-pointer", checked && "ring-2 ring-brand")}>
                      <input type="checkbox" className="w-5 h-5 accent-[var(--color-primary)] flex-shrink-0" checked={checked} disabled={already} onChange={() => toggle(f.id)} aria-label={`Select ${f.title}`} />
                      <div className="w-14 h-10 rounded-lg bg-secondary relative overflow-hidden flex-shrink-0">
                        <FileThumb url={f.thumbnailUrl} fileType={f.fileType} title={f.title} mimeType={f.mimeType} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-primary line-clamp-1 break-all">{f.title}</p>
                        <p className="text-xs text-secondary">
                          {fileKindLabel(f)}
                          {f.fileSize ? ` · ${formatBytes(f.fileSize)}` : ""}
                          {f.isPublished === false ? " · Not published" : ""}
                        </p>
                      </div>
                      {already && (
                        <span className="chip bg-brand-10 text-brand flex-shrink-0">
                          <Check size={11} aria-hidden="true" /> In playlist
                        </span>
                      )}
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}

      {submitError && <p role="alert" className="text-xs text-red-500 bg-red-50 dark:bg-red-900/20 rounded-xl px-3 py-2">{submitError}</p>}

      {!loading && !loadError && library.length > 0 && (
        <div className="sticky bottom-[calc(env(safe-area-inset-bottom)+12px)] pt-1">
          <button
            type="button"
            onClick={() => void submit()}
            disabled={selected.size === 0 || saving}
            data-testid="add-files-submit"
            className="btn-primary w-full min-h-12 py-3 text-sm flex items-center justify-center gap-2 shadow-app-md disabled:opacity-60"
          >
            {saving ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <ListPlus size={15} aria-hidden="true" />}
            {saving ? "Adding…" : selected.size > 0 ? `Add ${selected.size} ${selected.size === 1 ? "file" : "files"}` : "Select files to add"}
          </button>
        </div>
      )}
    </div>
  );
}
