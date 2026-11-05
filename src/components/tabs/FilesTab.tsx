"use client";
import React, { useState, useEffect, useCallback } from "react";
import {
  MoreHorizontal, Edit2, FolderPlus, ExternalLink, Share2, BarChart2, Trash2,
  Plus, Play, FileText, Music, Image, Archive, Film, Grid, List, Search,
  Lock, Star, Eye, Download
} from "lucide-react";
import { cn, formatBytes, formatNumber, getFileTypeBadgeColor, getFileTypeIcon, timeAgo } from "@/lib/utils";
import DeleteConfirmModal from "@/components/ui/DeleteConfirmModal";
import Modal from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";

interface FileItem {
  id: number;
  title: string;
  description?: string;
  fileType: string;
  fileSize?: number;
  starsPrice?: number;
  password?: string;
  isPublished: boolean;
  views?: number;
  downloads?: number;
  earnings?: string;
  smartLinkSlug?: string;
  createdAt: string;
  category?: string;
}

interface PlaylistItem {
  id: number;
  title: string;
  description?: string;
  totalFiles?: number;
  totalViews?: number;
  totalDownloads?: number;
  starsPrice?: number;
  password?: string;
  isPublished: boolean;
  createdAt: string;
}

const FILTERS = ["All", "Video", "Document", "Audio", "Image", "Archive", "Playlist"];

export default function FilesTab({ onCreateClick }: { onCreateClick?: () => void }) {
  const { toast } = useToast();
  const [activeFilter, setActiveFilter] = useState("All");
  const [viewMode, setViewMode] = useState<"grid" | "list">("list");
  const [files, setFiles] = useState<FileItem[]>([]);
  const [playlists, setPlaylists] = useState<PlaylistItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [menuOpen, setMenuOpen] = useState<number | null>(null);
  const [menuType, setMenuType] = useState<"file" | "playlist">("file");
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; type: "file" | "playlist" } | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [detailFile, setDetailFile] = useState<FileItem | null>(null);

  const fetchAll = useCallback(async () => {
    try {
      setLoading(true);
      const [filesRes, plRes] = await Promise.all([
        fetch("/api/files"),
        fetch("/api/playlists"),
      ]);
      if (filesRes.ok) setFiles(await filesRes.json().then((d) => d.files || []));
      if (plRes.ok) setPlaylists(await plRes.json().then((d) => d.playlists || []));
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const filtered = (): (FileItem | PlaylistItem & { _type: string })[] => {
    const f = activeFilter.toLowerCase();
    let items: (FileItem | (PlaylistItem & { _type: string }))[] = [];

    if (f === "playlist") {
      items = playlists.map((p) => ({ ...p, _type: "playlist" }));
    } else if (f === "all") {
      const pls = playlists.map((p) => ({ ...p, _type: "playlist" }));
      items = [
        ...(files as FileItem[]),
        ...pls,
      ];
    } else {
      items = files.filter((fi) => fi.fileType === f);
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      return items.filter((i) => i.title.toLowerCase().includes(q));
    }
    return items;
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleteLoading(true);
    try {
      const url = deleteTarget.type === "file"
        ? `/api/files/${deleteTarget.id}`
        : `/api/playlists/${deleteTarget.id}`;
      const res = await fetch(url, { method: "DELETE" });
      if (res.ok) {
        toast(`${deleteTarget.type === "file" ? "File" : "Playlist"} deleted successfully`);
        fetchAll();
        setDeleteTarget(null);
      } else {
        toast("Failed to delete. Please try again.", "error");
      }
    } catch {
      toast("Network error. Please retry.", "error");
    } finally {
      setDeleteLoading(false);
    }
  };

  const isPlaylist = (item: FileItem | (PlaylistItem & { _type?: string })): item is PlaylistItem & { _type: string } =>
    "_type" in item && (item as { _type?: string })._type === "playlist";

  const smartLink = (slug: string) => `${window.location.origin}/f/${slug}`;

  const handleShare = (slug?: string) => {
    if (!slug) return;
    navigator.clipboard.writeText(smartLink(slug));
    toast("Smart link copied to clipboard! 🔗");
    setMenuOpen(null);
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-primary">My Library</h1>
        <button
          onClick={onCreateClick}
          className="w-9 h-9 rounded-xl gradient-brand flex items-center justify-center shadow-lg"
          style={{ boxShadow: "0 4px 14px rgba(255,97,21,0.4)" }}
        >
          <Plus size={18} color="white" />
        </button>
      </div>

      {/* Search */}
      <div className="relative">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
        <input
          className="input-app pl-9 py-2.5 text-sm"
          placeholder="Search files & playlists..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* Filter + View Toggle */}
      <div className="flex items-center gap-2">
        <div className="flex gap-2 overflow-x-auto no-scrollbar flex-1">
          {FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setActiveFilter(f)}
              className={cn(
                "flex-shrink-0 px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all",
                activeFilter === f ? "tab-active" : "bg-secondary text-secondary hover:text-primary"
              )}
            >
              {f}
            </button>
          ))}
        </div>
        <div className="flex gap-1 flex-shrink-0">
          <button
            onClick={() => setViewMode("list")}
            className={cn("w-7 h-7 rounded-lg flex items-center justify-center transition-colors",
              viewMode === "list" ? "bg-brand text-white" : "bg-secondary text-secondary")}
          >
            <List size={13} />
          </button>
          <button
            onClick={() => setViewMode("grid")}
            className={cn("w-7 h-7 rounded-lg flex items-center justify-center transition-colors",
              viewMode === "grid" ? "bg-brand text-white" : "bg-secondary text-secondary")}
          >
            <Grid size={13} />
          </button>
        </div>
      </div>

      {/* Files List/Grid */}
      {loading ? (
        <div className="flex flex-col gap-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-card rounded-2xl p-4 border border-app h-20 animate-pulse-brand" />
          ))}
        </div>
      ) : filtered().length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-4 py-16">
          <div className="w-16 h-16 rounded-2xl bg-secondary flex items-center justify-center text-3xl">📁</div>
          <div className="text-center">
            <p className="font-semibold text-primary mb-1">No files yet</p>
            <p className="text-sm text-secondary">Upload your first file to get started</p>
          </div>
          <button onClick={onCreateClick} className="btn-primary px-6 py-2.5 text-sm">
            Upload File
          </button>
        </div>
      ) : (
        <div className={cn(viewMode === "grid" ? "grid grid-cols-2 gap-3" : "flex flex-col gap-3")}>
          {filtered().map((item) => {
            const isPl = isPlaylist(item);
            const itemId = item.id;

            if (isPl) {
              const pl = item as PlaylistItem & { _type: string };
              return (
                <div key={`pl-${pl.id}`} className={cn("bg-card border border-app rounded-2xl shadow-app-sm relative", viewMode === "grid" ? "p-3" : "p-4")}>
                  <div className={cn("flex gap-3", viewMode === "grid" ? "flex-col" : "flex-row items-center")}>
                    <div className="w-12 h-12 rounded-xl gradient-brand flex items-center justify-center flex-shrink-0">
                      <FolderPlus size={20} color="white" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-semibold text-primary text-sm line-clamp-1">{pl.title}</p>
                        {pl.password && <Lock size={11} className="text-brand flex-shrink-0" />}
                        {(pl.starsPrice ?? 0) > 0 && <Star size={11} className="text-yellow-500 flex-shrink-0" />}
                      </div>
                      <div className="flex items-center gap-3 mt-1">
                        <span className="chip bg-brand-10 text-brand">{pl.totalFiles ?? 0} files</span>
                        <span className="text-xs text-secondary">{formatNumber(pl.totalDownloads ?? 0)} dl</span>
                      </div>
                    </div>
                    <button
                      className="flex-shrink-0 w-7 h-7 rounded-lg bg-secondary flex items-center justify-center"
                      onClick={() => { setMenuOpen(pl.id); setMenuType("playlist"); }}
                    >
                      <MoreHorizontal size={14} style={{ color: "var(--color-text-secondary)" }} />
                    </button>
                  </div>
                  {menuOpen === pl.id && menuType === "playlist" && (
                    <ActionMenu
                      onClose={() => setMenuOpen(null)}
                      onDelete={() => { setDeleteTarget({ id: pl.id, type: "playlist" }); setMenuOpen(null); }}
                      onShare={() => toast("Playlist link copied!")}
                    />
                  )}
                </div>
              );
            }

            const fi = item as FileItem;
            return (
              <div key={`f-${fi.id}`} className={cn("bg-card border border-app rounded-2xl shadow-app-sm relative", viewMode === "grid" ? "p-3" : "p-4")}>
                <div className={cn("flex gap-3", viewMode === "grid" ? "flex-col" : "flex-row items-center")}>
                  <div className={cn(
                    "rounded-xl flex items-center justify-center flex-shrink-0 text-xl",
                    viewMode === "grid" ? "w-full h-20" : "w-12 h-12",
                    "bg-secondary"
                  )}>
                    {getFileTypeIcon(fi.fileType)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <p className="font-semibold text-primary text-sm line-clamp-1">{fi.title}</p>
                      {fi.password && <Lock size={11} className="text-brand flex-shrink-0" />}
                      {(fi.starsPrice ?? 0) > 0 && (
                        <span className="chip bg-yellow-50 text-yellow-600 dark:bg-yellow-900/20 dark:text-yellow-400">
                          ⭐ {fi.starsPrice}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      <span className={cn("chip text-xs", getFileTypeBadgeColor(fi.fileType))}>{fi.fileType}</span>
                      <span className="text-xs text-secondary">{formatBytes(fi.fileSize)}</span>
                    </div>
                    <div className="flex items-center gap-3 mt-1.5">
                      <span className="text-xs text-secondary flex items-center gap-1">
                        <Eye size={10} />{formatNumber(fi.views ?? 0)}
                      </span>
                      <span className="text-xs text-secondary flex items-center gap-1">
                        <Download size={10} />{formatNumber(fi.downloads ?? 0)}
                      </span>
                      <span className="text-xs text-brand font-medium">+${Number(fi.earnings ?? 0).toFixed(2)}</span>
                    </div>
                  </div>
                  <button
                    className="flex-shrink-0 w-7 h-7 rounded-lg bg-secondary flex items-center justify-center"
                    onClick={() => { setMenuOpen(fi.id); setMenuType("file"); }}
                  >
                    <MoreHorizontal size={14} style={{ color: "var(--color-text-secondary)" }} />
                  </button>
                </div>
                {menuOpen === fi.id && menuType === "file" && (
                  <ActionMenu
                    onClose={() => setMenuOpen(null)}
                    onDelete={() => { setDeleteTarget({ id: fi.id, type: "file" }); setMenuOpen(null); }}
                    onShare={() => handleShare(fi.smartLinkSlug)}
                    onDetail={() => { setDetailFile(fi); setMenuOpen(null); }}
                    onOpen={() => { if (fi.smartLinkSlug) window.open(`/f/${fi.smartLinkSlug}`, "_blank"); setMenuOpen(null); }}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Delete Modal */}
      <DeleteConfirmModal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        loading={deleteLoading}
        title={`Delete ${deleteTarget?.type === "file" ? "File" : "Playlist"}`}
        description={`Are you sure you want to delete this ${deleteTarget?.type === "file" ? "file" : "playlist"}? This action cannot be undone.`}
      />

      {/* Detail Modal */}
      <Modal open={!!detailFile} onClose={() => setDetailFile(null)} title="File Details" size="md">
        {detailFile && (
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <div className="w-14 h-14 rounded-2xl bg-secondary text-3xl flex items-center justify-center">
                {getFileTypeIcon(detailFile.fileType)}
              </div>
              <div>
                <p className="font-bold text-primary">{detailFile.title}</p>
                <p className="text-sm text-secondary">{formatBytes(detailFile.fileSize)}</p>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: "Views", value: formatNumber(detailFile.views ?? 0), icon: Eye },
                { label: "Downloads", value: formatNumber(detailFile.downloads ?? 0), icon: Download },
                { label: "Earnings", value: `$${Number(detailFile.earnings ?? 0).toFixed(2)}`, icon: BarChart2 },
              ].map(({ label, value, icon: Icon }) => (
                <div key={label} className="bg-secondary rounded-xl p-3 text-center">
                  <Icon size={16} className="text-brand mx-auto mb-1" />
                  <p className="font-bold text-primary text-base">{value}</p>
                  <p className="text-xs text-secondary">{label}</p>
                </div>
              ))}
            </div>
            {detailFile.smartLinkSlug && (
              <div className="bg-secondary rounded-xl p-3">
                <p className="text-xs text-secondary mb-1 font-medium">Smart Link</p>
                <p className="text-xs text-brand break-all">{`${typeof window !== "undefined" ? window.location.origin : ""}/f/${detailFile.smartLinkSlug}`}</p>
              </div>
            )}
            <button
              onClick={() => { handleShare(detailFile.smartLinkSlug); setDetailFile(null); }}
              className="btn-primary w-full py-3 text-sm text-center"
            >
              Copy Smart Link
            </button>
          </div>
        )}
      </Modal>
    </div>
  );
}

function ActionMenu({
  onClose,
  onDelete,
  onShare,
  onDetail,
  onOpen,
  onEdit,
}: {
  onClose: () => void;
  onDelete: () => void;
  onShare?: () => void;
  onDetail?: () => void;
  onOpen?: () => void;
  onEdit?: () => void;
}) {
  const actions = [
    onEdit && { icon: Edit2, label: "Edit", action: onEdit, color: "text-primary" },
    onOpen && { icon: ExternalLink, label: "Open Link", action: onOpen, color: "text-blue-500" },
    onShare && { icon: Share2, label: "Share", action: onShare, color: "text-green-500" },
    onDetail && { icon: BarChart2, label: "Analytics", action: onDetail, color: "text-brand" },
    { icon: Trash2, label: "Delete", action: onDelete, color: "text-red-500" },
  ].filter(Boolean) as { icon: React.FC<{ size: number; className: string }>; label: string; action: () => void; color: string }[];

  return (
    <>
      <div className="fixed inset-0 z-30" onClick={onClose} />
      <div
        className="absolute right-3 top-12 z-40 bg-card border border-app rounded-2xl shadow-app-lg overflow-hidden animate-scale-in"
        style={{ minWidth: 160 }}
      >
        {actions.map(({ icon: Icon, label, action, color }) => (
          <button
            key={label}
            onClick={() => { action(); onClose(); }}
            className="flex items-center gap-3 px-4 py-3 w-full hover:bg-secondary transition-colors text-sm"
          >
            <Icon size={15} className={color} />
            <span className={cn("font-medium", color === "text-primary" ? "text-primary" : color)}>{label}</span>
          </button>
        ))}
      </div>
    </>
  );
}
