"use client";
import React, { useState, useEffect, useCallback } from "react";
import {
  Link2, Plus, X, Upload, Lock, Star, Tag, FileText, FolderOpen,
  Check, ChevronDown, Info, ListPlus
} from "lucide-react";
import { cn } from "@/lib/utils";
import Modal from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { useApp } from "@/contexts/AppContext";

interface Playlist {
  id: number;
  title: string;
}

const CATEGORIES = ["Education", "Entertainment", "Music", "Design", "Books", "Software", "Games", "Stock", "Other"];
const FILE_TYPES = ["video", "audio", "document", "image", "archive", "other"];

export default function CreateTab({ onSuccess }: { onSuccess?: () => void }) {
  const { toast } = useToast();
  const { refreshUser } = useApp();
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [showPlaylistModal, setShowPlaylistModal] = useState(false);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    telegramMessageLink: "",
    title: "",
    description: "",
    category: "",
    fileType: "video",
    password: "",
    starsPrice: "",
    playlistId: "",
  });
  const [playlistForm, setPlaylistForm] = useState({
    title: "",
    description: "",
    password: "",
    starsPrice: "",
  });
  const [playlistLoading, setPlaylistLoading] = useState(false);

  const fetchPlaylists = useCallback(async () => {
    const res = await fetch("/api/playlists");
    if (res.ok) {
      const data = await res.json();
      setPlaylists(data.playlists || []);
    }
  }, []);

  useEffect(() => { fetchPlaylists(); }, [fetchPlaylists]);

  const parseTelegramLink = (link: string) => {
    // Extract post info from link for auto-fill
    if (link.includes("t.me")) {
      const parts = link.split("/");
      const postNum = parts[parts.length - 1];
      if (!form.title) {
        setForm((prev) => ({ ...prev, title: `Telegram Post #${postNum}` }));
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.telegramMessageLink.trim()) {
      toast("Please paste a Telegram message link", "error");
      return;
    }
    if (!form.title.trim()) {
      toast("Please enter a title", "error");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          starsPrice: form.starsPrice ? parseInt(form.starsPrice) : 0,
          playlistId: form.playlistId || null,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        toast("File published successfully! 🎉");
        setForm({
          telegramMessageLink: "",
          title: "",
          description: "",
          category: "",
          fileType: "video",
          password: "",
          starsPrice: "",
          playlistId: "",
        });
        refreshUser();
        onSuccess?.();
      } else {
        const err = await res.json();
        toast(err.error || "Failed to publish", "error");
      }
    } catch {
      toast("Network error. Please retry.", "error");
    } finally {
      setLoading(false);
    }
  };

  const handleCreatePlaylist = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!playlistForm.title.trim()) {
      toast("Playlist title is required", "error");
      return;
    }
    setPlaylistLoading(true);
    try {
      const res = await fetch("/api/playlists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...playlistForm,
          starsPrice: playlistForm.starsPrice ? parseInt(playlistForm.starsPrice) : 0,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        toast("Playlist created! 🎬");
        setPlaylistForm({ title: "", description: "", password: "", starsPrice: "" });
        setShowPlaylistModal(false);
        fetchPlaylists();
        setForm((prev) => ({ ...prev, playlistId: String(data.playlist.id) }));
      } else {
        toast("Failed to create playlist", "error");
      }
    } catch {
      toast("Network error.", "error");
    } finally {
      setPlaylistLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-primary">Import & Publish</h1>
          <p className="text-xs text-secondary mt-0.5">Paste a Telegram link to publish your file</p>
        </div>
        <button
          onClick={() => setShowPlaylistModal(true)}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl gradient-brand text-white text-xs font-semibold shadow-lg"
          style={{ boxShadow: "0 4px 14px rgba(255,97,21,0.4)" }}
        >
          <ListPlus size={14} />
          New Playlist
        </button>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {/* Telegram Link Import */}
        <div className="bg-card rounded-2xl border-2 border-dashed border-brand p-4 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-16 h-16 rounded-full bg-brand-10 -translate-y-4 translate-x-4" />
          <div className="relative z-10">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-8 h-8 rounded-xl gradient-brand flex items-center justify-center">
                <Link2 size={15} color="white" />
              </div>
              <div>
                <p className="text-sm font-semibold text-primary">Telegram Message Link</p>
                <p className="text-xs text-secondary">e.g. https://t.me/c/123456/42</p>
              </div>
            </div>
            <div className="flex gap-2">
              <input
                className="input-app flex-1 text-sm"
                placeholder="https://t.me/channel/post_id"
                value={form.telegramMessageLink}
                onChange={(e) => {
                  setForm((prev) => ({ ...prev, telegramMessageLink: e.target.value }));
                  parseTelegramLink(e.target.value);
                }}
              />
              {form.telegramMessageLink && (
                <button
                  type="button"
                  onClick={() => setForm((prev) => ({ ...prev, telegramMessageLink: "" }))}
                  className="w-10 h-10 rounded-xl bg-secondary flex items-center justify-center flex-shrink-0"
                >
                  <X size={14} className="text-secondary" />
                </button>
              )}
            </div>
            <div className="flex items-start gap-1.5 mt-2">
              <Info size={12} className="text-brand mt-0.5 flex-shrink-0" />
              <p className="text-xs text-secondary">
                Our bot must be an admin of your channel to forward this file securely.
              </p>
            </div>
          </div>
        </div>

        {/* File Details */}
        <div className="bg-card rounded-2xl p-4 border border-app shadow-app-sm flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-primary flex items-center gap-2">
            <FileText size={14} className="text-brand" />
            File Details
          </h2>

          {/* Title */}
          <div>
            <label className="text-xs font-medium text-secondary mb-1.5 block">Title *</label>
            <input
              className="input-app text-sm"
              placeholder="Enter file title..."
              value={form.title}
              onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))}
              required
            />
          </div>

          {/* Description */}
          <div>
            <label className="text-xs font-medium text-secondary mb-1.5 block">Description</label>
            <textarea
              className="input-app text-sm resize-none"
              rows={3}
              placeholder="Describe this file..."
              value={form.description}
              onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
            />
          </div>

          {/* Category + File Type */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-secondary mb-1.5 block">Category</label>
              <select
                className="input-app text-sm"
                value={form.category}
                onChange={(e) => setForm((prev) => ({ ...prev, category: e.target.value }))}
              >
                <option value="">Select...</option>
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-secondary mb-1.5 block">File Type</label>
              <select
                className="input-app text-sm"
                value={form.fileType}
                onChange={(e) => setForm((prev) => ({ ...prev, fileType: e.target.value }))}
              >
                {FILE_TYPES.map((t) => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
              </select>
            </div>
          </div>

          {/* Playlist */}
          <div>
            <label className="text-xs font-medium text-secondary mb-1.5 flex items-center gap-1.5">
              <FolderOpen size={12} className="text-brand" />
              Add to Playlist (optional)
            </label>
            <select
              className="input-app text-sm"
              value={form.playlistId}
              onChange={(e) => setForm((prev) => ({ ...prev, playlistId: e.target.value }))}
            >
              <option value="">No playlist</option>
              {playlists.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
            </select>
          </div>
        </div>

        {/* Access Controls */}
        <div className="bg-card rounded-2xl p-4 border border-app shadow-app-sm flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-primary flex items-center gap-2">
            <Lock size={14} className="text-brand" />
            Access Controls
          </h2>

          {/* Password */}
          <div>
            <label className="text-xs font-medium text-secondary mb-1.5 flex items-center gap-1.5">
              <Lock size={11} className="text-brand" />
              Password Protection (optional)
            </label>
            <input
              className="input-app text-sm"
              type="password"
              placeholder="Leave empty for no password..."
              value={form.password}
              onChange={(e) => setForm((prev) => ({ ...prev, password: e.target.value }))}
            />
          </div>

          {/* Stars Price */}
          <div>
            <label className="text-xs font-medium text-secondary mb-1.5 flex items-center gap-1.5">
              <Star size={11} className="text-yellow-500" />
              Telegram Stars Price (0 = free)
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-yellow-500 text-sm">⭐</span>
              <input
                className="input-app text-sm pl-8"
                type="number"
                min="0"
                placeholder="0"
                value={form.starsPrice}
                onChange={(e) => setForm((prev) => ({ ...prev, starsPrice: e.target.value }))}
              />
            </div>
            <p className="text-xs text-secondary mt-1">Set to 0 to allow free access via ad countdown</p>
          </div>
        </div>

        {/* Submit */}
        <button
          type="submit"
          disabled={loading}
          className="btn-primary py-4 text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-60"
        >
          {loading ? (
            <div className="w-4 h-4 rounded-full border-2 border-white border-t-transparent animate-spin" />
          ) : (
            <Upload size={16} />
          )}
          {loading ? "Publishing..." : "Publish File"}
        </button>
      </form>

      {/* Create Playlist Modal */}
      <Modal
        open={showPlaylistModal}
        onClose={() => setShowPlaylistModal(false)}
        title="Create New Playlist"
        size="md"
      >
        <form onSubmit={handleCreatePlaylist} className="flex flex-col gap-4">
          <div>
            <label className="text-xs font-medium text-secondary mb-1.5 block">Playlist Title *</label>
            <input
              className="input-app text-sm"
              placeholder="e.g. Premium Video Course"
              value={playlistForm.title}
              onChange={(e) => setPlaylistForm((prev) => ({ ...prev, title: e.target.value }))}
              required
            />
          </div>
          <div>
            <label className="text-xs font-medium text-secondary mb-1.5 block">Description</label>
            <textarea
              className="input-app text-sm resize-none"
              rows={2}
              placeholder="Describe this playlist..."
              value={playlistForm.description}
              onChange={(e) => setPlaylistForm((prev) => ({ ...prev, description: e.target.value }))}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-secondary mb-1.5 block">Password (optional)</label>
              <input
                className="input-app text-sm"
                type="password"
                placeholder="No password"
                value={playlistForm.password}
                onChange={(e) => setPlaylistForm((prev) => ({ ...prev, password: e.target.value }))}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-secondary mb-1.5 flex items-center gap-1">
                <Star size={10} className="text-yellow-500" />
                Stars Price
              </label>
              <input
                className="input-app text-sm"
                type="number"
                min="0"
                placeholder="0"
                value={playlistForm.starsPrice}
                onChange={(e) => setPlaylistForm((prev) => ({ ...prev, starsPrice: e.target.value }))}
              />
            </div>
          </div>
          <div className="flex gap-3">
            <button type="button" onClick={() => setShowPlaylistModal(false)} className="flex-1 btn-secondary py-3 text-sm">
              Cancel
            </button>
            <button type="submit" disabled={playlistLoading} className="flex-1 btn-primary py-3 text-sm">
              {playlistLoading ? "Creating..." : "Create Playlist"}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
