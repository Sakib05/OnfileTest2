"use client";
import React, { useEffect, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import Modal from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import type { FileItem } from "@/components/library/types";
import type { PlaylistMembershipRow } from "./ManagePlaylistsDialog";

/**
 * Library ⋮ → Delete File. Explicit confirmation that says exactly what happens:
 *   - removes the file from the Onfile Library (DELETE /api/files/:id, owner-scoped), its Onfile link and its thumbnail copy,
 *   - removes it from the playlists that contain it (membership rows cascade; the playlists and their other files stay — the
 *     affected playlists are listed here BEFORE the creator confirms),
 *   - never touches the Telegram channel: no Telegram API call exists anywhere in this path, the post stays where it is.
 */
export default function DeleteFileDialog({ file, onClose, onDeleted }: { file: FileItem; onClose: () => void; onDeleted: (id: number) => void }) {
  const { toast } = useToast();
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inPlaylists, setInPlaylists] = useState<{ name: "loading" } | { name: "ready"; titles: string[] } | { name: "unknown" }>({ name: "loading" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/files/${file.id}/playlists`, { cache: "no-store" });
        const data = (await res.json().catch(() => null)) as { playlists?: PlaylistMembershipRow[] } | null;
        if (cancelled) return;
        if (!res.ok || !data?.playlists) setInPlaylists({ name: "unknown" });
        else setInPlaylists({ name: "ready", titles: data.playlists.filter((p) => p.isMember).map((p) => p.title) });
      } catch {
        if (!cancelled) setInPlaylists({ name: "unknown" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [file.id]);

  const confirm = async () => {
    if (deleting) return;
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/files/${file.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(res.status === 404 ? "This file no longer exists." : data?.error ?? "Couldn't delete the file. Please try again.");
        if (res.status === 404) onDeleted(file.id);
        return;
      }
      toast("File deleted from your Library");
      onDeleted(file.id);
      onClose();
    } catch {
      setError("Network error. Please check your connection and try again.");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Modal open onClose={() => !deleting && onClose()} size="sm" hideClose>
      <div className="flex flex-col items-center text-center gap-4" data-testid="delete-file-dialog" aria-live="polite">
        <div className="w-12 h-12 rounded-2xl bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
          <AlertTriangle size={24} className="text-red-500" aria-hidden="true" />
        </div>
        <div className="min-w-0 w-full">
          <h3 className="text-lg font-bold text-primary mb-1">Delete from Library?</h3>
          <p className="text-sm font-semibold text-primary break-words line-clamp-2 mb-2" data-testid="delete-file-title">“{file.title}”</p>
          <ul className="text-sm text-secondary leading-relaxed text-left list-disc pl-5 space-y-1">
            <li>It is removed from your Onfile Library and its Onfile link stops working. This can&apos;t be undone.</li>
            <li data-testid="delete-file-playlists">
              {inPlaylists.name === "loading" && "Checking which playlists contain it…"}
              {inPlaylists.name === "unknown" && "It is also removed from any playlist that contains it. The playlists and their other files stay."}
              {inPlaylists.name === "ready" &&
                (inPlaylists.titles.length === 0
                  ? "It isn't in any playlist."
                  : `It is also removed from ${inPlaylists.titles.length === 1 ? "this playlist" : `these ${inPlaylists.titles.length} playlists`}: ${inPlaylists.titles.map((t) => `“${t}”`).join(", ")}. The playlists and their other files stay.`)}
            </li>
            <li className="text-primary font-medium">The original file in your Telegram channel is NOT deleted.</li>
          </ul>
        </div>
        {error && <p role="alert" className="text-xs text-red-500 bg-red-50 dark:bg-red-900/20 rounded-xl px-3 py-2 w-full" data-testid="delete-file-error">{error}</p>}
        <div className="flex gap-3 w-full">
          <button type="button" data-autofocus onClick={onClose} disabled={deleting} className="flex-1 min-h-11 py-3 rounded-xl font-medium text-sm btn-secondary disabled:opacity-60">Cancel</button>
          <button
            type="button"
            onClick={() => void confirm()}
            disabled={deleting}
            data-testid="delete-file-confirm"
            className="flex-1 min-h-11 py-3 rounded-xl font-semibold text-sm bg-red-500 text-white hover:bg-red-600 transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
          >
            {deleting ? <><Loader2 size={15} className="animate-spin" aria-hidden="true" /> Deleting…</> : "Delete file"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
