"use client";
import React, { useState } from "react";
import { Check, ImageIcon, Loader2 } from "lucide-react";
import FileThumb from "@/components/ui/FileThumb";
import PlaylistThumb from "@/components/ui/PlaylistThumb";
import { useToast } from "@/components/ui/Toast";
import { cn } from "@/lib/utils";
import { PLAYLIST_DESCRIPTION_MAX, PLAYLIST_TITLE_MAX } from "@/lib/playlists";
import { JSON_HEADERS, readJson, type MemberFile, type PlaylistSummary } from "./types";

/**
 * Edit title / description, and choose the cover.
 * Covers are DERIVED from the first file's thumbnail (no separate image is stored or uploaded), so "changing the
 * cover" means choosing which file is first — done through the existing reorder endpoint, by the parent.
 */
export default function EditDetailsView({
  playlist,
  files,
  coverBusy,
  onSaved,
  onSetCover,
}: {
  playlist: PlaylistSummary;
  files: MemberFile[];
  coverBusy: boolean;
  onSaved: (p: PlaylistSummary) => void;
  onSetCover: (fileId: number) => void;
}) {
  const { toast } = useToast();
  const [title, setTitle] = useState(playlist.title);
  const [description, setDescription] = useState(playlist.description ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = title.trim() !== playlist.title || description.trim() !== (playlist.description ?? "");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (saving || !dirty) return;
    const t = title.trim();
    if (!t) return setError("Playlist name is required.");
    if (t.length > PLAYLIST_TITLE_MAX) return setError(`Name must be ${PLAYLIST_TITLE_MAX} characters or fewer.`);
    if (description.length > PLAYLIST_DESCRIPTION_MAX) return setError(`Description must be ${PLAYLIST_DESCRIPTION_MAX} characters or fewer.`);
    setError(null);
    setSaving(true);
    try {
      const res = await fetch(`/api/playlists/${playlist.id}`, { method: "PATCH", headers: JSON_HEADERS, body: JSON.stringify({ title: t, description: description.trim() || null }) });
      const data = await readJson(res);
      if (!res.ok || !data?.playlist) {
        setError(String(data?.error ?? "Couldn't save your changes. Please try again."));
        return;
      }
      toast("Playlist updated");
      onSaved(data.playlist as PlaylistSummary);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <div>
          <label htmlFor="pl-edit-title" className="text-xs font-semibold text-secondary mb-1.5 block">Playlist name</label>
          <input id="pl-edit-title" className="input-app" value={title} maxLength={PLAYLIST_TITLE_MAX} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div>
          <label htmlFor="pl-edit-desc" className="text-xs font-semibold text-secondary mb-1.5 block">Description (optional)</label>
          <textarea id="pl-edit-desc" className="input-app min-h-28" value={description} maxLength={PLAYLIST_DESCRIPTION_MAX} onChange={(e) => setDescription(e.target.value)} />
          <p className="text-[11px] text-muted text-right mt-1">{description.length}/{PLAYLIST_DESCRIPTION_MAX}</p>
        </div>
        {error && <p role="alert" className="text-xs text-red-500 bg-red-50 dark:bg-red-900/20 rounded-xl px-3 py-2">{error}</p>}
        <button type="submit" disabled={saving || !dirty} className="btn-primary w-full min-h-11 py-3 text-sm flex items-center justify-center gap-2 disabled:opacity-60">
          {saving ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <Check size={15} aria-hidden="true" />} {saving ? "Saving…" : "Save changes"}
        </button>
      </form>

      <section aria-labelledby="cover-heading" data-testid="cover-picker">
        <h2 id="cover-heading" className="text-sm font-bold text-primary flex items-center gap-2 mb-1">
          <ImageIcon size={15} aria-hidden="true" /> Cover
        </h2>
        <p className="text-xs text-secondary mb-3">
          The cover is the thumbnail of the playlist&apos;s first file. Pick a file to use as the cover — it moves to the top of the playlist. Nothing is uploaded.
        </p>
        <div className="flex items-center gap-3 mb-3">
          <div className="relative w-28 aspect-video rounded-xl overflow-hidden bg-secondary border border-app flex-shrink-0">
            <PlaylistThumb url={playlist.thumbnailUrl} />
          </div>
          <p className="text-xs text-secondary">Current cover</p>
        </div>
        {files.length === 0 ? (
          <p className="text-sm text-secondary rounded-xl border border-dashed border-app p-4 text-center">Add a file first — its thumbnail becomes the cover.</p>
        ) : (
          <ul className="grid grid-cols-2 sm:grid-cols-3 gap-2" role="list">
            {files.map((f, i) => (
              <li key={f.id}>
                <button
                  type="button"
                  onClick={() => onSetCover(f.id)}
                  disabled={coverBusy || i === 0}
                  aria-pressed={i === 0}
                  aria-label={i === 0 ? `${f.title} is the current cover` : `Use ${f.title} as the cover`}
                  data-testid="cover-option"
                  className={cn("w-full text-left rounded-xl border bg-card p-1.5 disabled:opacity-100", i === 0 ? "border-[var(--color-primary)] ring-1 ring-[var(--color-primary)]" : "border-app disabled:opacity-60")}
                >
                  <span className="block relative aspect-video rounded-lg overflow-hidden bg-secondary">
                    <FileThumb url={f.thumbnailUrl} fileType={f.fileType} title={f.title} mimeType={f.mimeType} />
                  </span>
                  <span className="mt-1.5 px-0.5 flex items-center gap-1 text-xs text-primary">
                    <span className="min-w-0 flex-1 truncate">{f.title}</span>
                    {i === 0 && <Check size={13} className="text-brand flex-shrink-0" aria-hidden="true" />}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
