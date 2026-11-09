"use client";
import React, { useRef, useState } from "react";
import { FolderOpen, ListPlus, Star } from "lucide-react";
import Modal from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { STARS_MAX } from "@/lib/publishing/constants";
import { PLAYLIST_TITLE_MAX } from "@/lib/playlists";

export interface PlaylistOption {
  id: number;
  title: string;
  totalFiles?: number;
}

/**
 * Selects an existing playlist and keeps the existing "New Playlist" flow
 * (same /api/playlists endpoint and fields as before the redesign).
 */
export default function PlaylistPicker({
  playlists,
  value,
  onChange,
  onCreated,
}: {
  playlists: PlaylistOption[];
  value: string;
  onChange: (id: string) => void;
  /** Receives the playlist exactly as saved by the server. */
  onCreated: (playlist: PlaylistOption) => void | Promise<void>;
}) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ title: "", description: "", password: "", starsPrice: "" });

  const submitGuard = useRef(false);
  const [formError, setFormError] = useState<string | null>(null);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    // This dialog is rendered by a component that lives inside the Post Details
    // <form>. React bubbles submit events through portals, so without this the
    // outer form would ALSO submit and advance the wizard while the playlist is created.
    e.stopPropagation();
    if (submitGuard.current) return; // blocks double-taps before state updates
    const title = form.title.trim();
    if (!title) {
      setFormError("Playlist title is required.");
      return;
    }
    if (title.length > PLAYLIST_TITLE_MAX) {
      setFormError(`Title must be ${PLAYLIST_TITLE_MAX} characters or fewer.`);
      return;
    }
    const price = form.starsPrice.trim() ? Number(form.starsPrice) : 0;
    if (!Number.isInteger(price) || price < 0 || price > STARS_MAX) {
      setFormError(`Stars price must be a whole number from 0 to ${STARS_MAX}.`);
      return;
    }
    setFormError(null);
    submitGuard.current = true;
    setSaving(true);
    try {
      const res = await fetch("/api/playlists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, description: form.description.trim(), password: form.password, starsPrice: price }),
      });
      const data = (await res.json().catch(() => ({}))) as { playlist?: PlaylistOption; error?: string; duplicate?: boolean };
      if (res.ok && data.playlist) {
        toast(data.duplicate ? "That playlist already exists — selected it for you." : "Playlist created! 🎬");
        setForm({ title: "", description: "", password: "", starsPrice: "" });
        setOpen(false);
        await onCreated(data.playlist);
        onChange(String(data.playlist.id));
      } else if (res.status === 401) {
        setFormError("Your session has expired. Please reopen Onfile from Telegram.");
      } else {
        setFormError(data.error || "Couldn't create the playlist. Please try again.");
      }
    } catch {
      setFormError("Network problem. Check your connection and try again.");
    } finally {
      submitGuard.current = false;
      setSaving(false);
    }
  };

  return (
    <div>
      <label htmlFor="playlist" className="text-xs font-semibold text-secondary mb-1.5 flex items-center gap-1.5">
        <FolderOpen size={12} className="text-brand" />
        Playlist <span className="font-normal text-muted">(optional)</span>
      </label>
      <div className="flex gap-2">
        <select
          id="playlist"
          className="input-app text-sm min-h-12 flex-1"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">No playlist</option>
          {playlists.map((p) => (
            <option key={p.id} value={p.id}>
              {p.title}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => {
            setFormError(null);
            setOpen(true);
          }}
          className="btn-secondary !px-4 min-h-12 flex items-center gap-1.5 text-sm font-semibold flex-shrink-0"
        >
          <ListPlus size={16} />
          New
        </button>
      </div>

      <Modal open={open} onClose={() => { if (!saving) setOpen(false); }} title="Create New Playlist" size="md">
        <form onSubmit={create} className="flex flex-col gap-4" noValidate>
          <div>
            <label htmlFor="pl-title" className="text-xs font-medium text-secondary mb-1.5 block">
              Playlist Title *
            </label>
            <input
              id="pl-title"
              className="input-app text-sm"
              placeholder="e.g. Premium Video Course"
              value={form.title}
              onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
              maxLength={PLAYLIST_TITLE_MAX + 20}
              autoFocus
            />
          </div>
          <div>
            <label htmlFor="pl-desc" className="text-xs font-medium text-secondary mb-1.5 block">
              Description
            </label>
            <textarea
              id="pl-desc"
              className="input-app text-sm resize-none"
              rows={2}
              placeholder="Describe this playlist..."
              value={form.description}
              onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="pl-pass" className="text-xs font-medium text-secondary mb-1.5 block">
                Password (optional)
              </label>
              <input
                id="pl-pass"
                className="input-app text-sm"
                type="password"
                autoComplete="new-password"
                placeholder="No password"
                value={form.password}
                onChange={(e) => setForm((p) => ({ ...p, password: e.target.value }))}
              />
            </div>
            <div>
              <label htmlFor="pl-stars" className="text-xs font-medium text-secondary mb-1.5 flex items-center gap-1">
                <Star size={10} className="text-yellow-500" />
                Stars Price
              </label>
              <input
                id="pl-stars"
                className="input-app text-sm"
                type="number"
                min="0"
                max={STARS_MAX}
                placeholder="0"
                value={form.starsPrice}
                onChange={(e) => setForm((p) => ({ ...p, starsPrice: e.target.value }))}
              />
            </div>
          </div>
          {formError && (
            <p role="alert" className="text-xs text-red-500">
              {formError}
            </p>
          )}
          <div className="flex gap-3">
            <button type="button" onClick={() => setOpen(false)} disabled={saving} className="flex-1 btn-secondary py-3 text-sm min-h-12">
              Cancel
            </button>
            <button type="submit" disabled={saving} className="flex-1 btn-primary py-3 text-sm min-h-12 disabled:opacity-60">
              {saving ? "Creating..." : "Create Playlist"}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
