"use client";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Check, EyeOff, Globe, Loader2, Lock, Plus } from "lucide-react";
import Modal from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { cn } from "@/lib/utils";
import type { FileItem } from "@/components/library/types";

export interface PlaylistMembershipRow {
  id: number;
  title: string;
  isPublished: boolean;
  hasPassword: boolean;
  fileCount: number;
  isMember: boolean;
}

type Load = { name: "loading" } | { name: "ready"; rows: PlaylistMembershipRow[] } | { name: "error"; message: string };

/**
 * Library ⋮ → Manage Playlists. Lists the creator's playlists (GET /api/files/:id/playlists) and toggles membership through
 * the EXISTING endpoints — POST /api/playlists/:id/files (append; duplicates are skipped server-side and unique in the DB)
 * and DELETE /api/playlists/:id/files/:fileId (removes this one reference only). Nothing here reorders other files or
 * touches the file itself, its Telegram post or its thumbnail.
 */
export default function ManagePlaylistsDialog({ file, onClose, onChanged }: { file: FileItem; onClose: () => void; onChanged: () => void }) {
  const { toast } = useToast();
  const [state, setState] = useState<Load>({ name: "loading" });
  const [busyId, setBusyId] = useState<number | null>(null);
  const busyRef = useRef(false);
  const dirty = useRef(false);

  const load = useCallback(async () => {
    setState({ name: "loading" });
    try {
      const res = await fetch(`/api/files/${file.id}/playlists`, { cache: "no-store" });
      const data = (await res.json().catch(() => null)) as { playlists?: PlaylistMembershipRow[]; error?: string } | null;
      if (!res.ok || !data?.playlists) throw new Error(data?.error ?? "Couldn't load your playlists.");
      setState({ name: "ready", rows: data.playlists });
    } catch (e) {
      setState({ name: "error", message: e instanceof Error ? e.message : "Couldn't load your playlists." });
    }
  }, [file.id]);

  useEffect(() => {
    // Initial network read when the dialog opens.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const close = () => {
    if (busyRef.current) return;
    if (dirty.current) onChanged();
    onClose();
  };

  const toggle = async (row: PlaylistMembershipRow) => {
    if (busyRef.current) return; // one change at a time → no double-add from a double tap
    busyRef.current = true;
    setBusyId(row.id);
    try {
      const res = row.isMember
        ? await fetch(`/api/playlists/${row.id}/files/${file.id}`, { method: "DELETE" })
        : await fetch(`/api/playlists/${row.id}/files`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fileIds: [file.id] }) });
      const data = (await res.json().catch(() => null)) as { error?: string; added?: number[]; alreadyMembers?: number[] } | null;
      if (!res.ok) {
        toast(data?.error ?? (row.isMember ? "Couldn't remove the file from the playlist." : "Couldn't add the file to the playlist."), "error");
        return;
      }
      dirty.current = true;
      setState((cur) =>
        cur.name === "ready"
          ? { name: "ready", rows: cur.rows.map((r) => (r.id === row.id ? { ...r, isMember: !row.isMember, fileCount: Math.max(0, r.fileCount + (row.isMember ? -1 : data?.alreadyMembers?.length ? 0 : 1)) } : r)) }
          : cur
      );
      toast(row.isMember ? `Removed from “${row.title}”` : data?.alreadyMembers?.length ? `Already in “${row.title}”` : `Added to “${row.title}”`);
    } catch {
      toast("Network error. Please try again.", "error");
    } finally {
      busyRef.current = false;
      setBusyId(null);
    }
  };

  const memberCount = state.name === "ready" ? state.rows.filter((r) => r.isMember).length : 0;

  return (
    <Modal open onClose={close} title="Manage Playlists" size="md">
      <div className="flex flex-col gap-3" data-testid="manage-playlists">
        <p className="text-sm text-secondary break-words line-clamp-2">
          {file.title}
          {state.name === "ready" && (
            <span className="block text-xs text-muted mt-0.5" data-testid="playlist-membership-summary">
              {memberCount === 0 ? "Not in any playlist yet" : `In ${memberCount} ${memberCount === 1 ? "playlist" : "playlists"}`}
            </span>
          )}
        </p>

        {state.name === "loading" && (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-secondary" role="status">
            <Loader2 size={16} className="animate-spin" aria-hidden="true" /> Loading your playlists…
          </div>
        )}

        {state.name === "error" && (
          <div className="flex flex-col gap-3" data-testid="manage-playlists-error">
            <p role="alert" className="text-sm text-red-500 bg-red-50 dark:bg-red-900/20 rounded-xl px-3 py-2">{state.message}</p>
            <button type="button" onClick={() => void load()} className="btn-primary min-h-11 text-sm">Try again</button>
          </div>
        )}

        {state.name === "ready" && state.rows.length === 0 && (
          <div className="text-center py-6 px-3 rounded-2xl border border-dashed border-app" data-testid="manage-playlists-empty">
            <p className="text-sm font-semibold text-primary mb-1">You don&apos;t have any playlists yet</p>
            <p className="text-sm text-secondary">Create a playlist when you publish a file, then come back here to add this file to it.</p>
          </div>
        )}

        {state.name === "ready" && state.rows.length > 0 && (
          <ul className="flex flex-col gap-2" aria-label="Your playlists">
            {state.rows.map((row) => {
              const busy = busyId === row.id;
              return (
                <li key={row.id}>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={row.isMember}
                    aria-label={`${row.title}: ${row.isMember ? "remove from this playlist" : "add to this playlist"}`}
                    disabled={busyId !== null}
                    onClick={() => void toggle(row)}
                    data-testid="playlist-toggle"
                    data-member={row.isMember ? "true" : "false"}
                    className={cn(
                      "w-full min-h-14 flex items-center gap-3 rounded-xl border px-3 py-2 text-left transition-colors disabled:opacity-60",
                      row.isMember ? "border-[var(--color-primary)] bg-brand-10" : "border-app bg-secondary hover:bg-card"
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-primary break-words line-clamp-2">{row.title}</span>
                      <span className="mt-0.5 flex items-center gap-x-2 gap-y-0.5 flex-wrap text-[11px] text-secondary">
                        <span className="inline-flex items-center gap-1">
                          {row.isPublished ? <Globe size={11} aria-hidden="true" /> : <EyeOff size={11} aria-hidden="true" />}
                          {row.isPublished ? "Public" : "Private"}
                        </span>
                        <span>{row.fileCount} {row.fileCount === 1 ? "file" : "files"}</span>
                        {row.hasPassword && <span className="inline-flex items-center gap-1"><Lock size={10} aria-hidden="true" /> Password</span>}
                      </span>
                    </span>
                    <span
                      aria-hidden="true"
                      className={cn(
                        "flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center",
                        row.isMember ? "bg-[var(--color-primary)] text-white" : "bg-card border border-app text-secondary"
                      )}
                    >
                      {busy ? <Loader2 size={15} className="animate-spin" /> : row.isMember ? <Check size={16} /> : <Plus size={16} />}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <p className="text-[11px] text-muted">Playlists only reference your file — adding or removing never changes or deletes the original in your Telegram channel.</p>
        <button type="button" onClick={close} disabled={busyId !== null} className="w-full min-h-11 btn-secondary text-sm font-medium disabled:opacity-60">Done</button>
      </div>
    </Modal>
  );
}
