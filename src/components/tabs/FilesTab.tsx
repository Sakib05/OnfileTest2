"use client";
import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  Edit2, ExternalLink, Share2, BarChart2, Trash2, Plus, Grid, List, Search,
  Eye, Download, ChevronLeft, SearchX,
} from "lucide-react";
import { cn, formatNumber } from "@/lib/utils";
import DeleteConfirmModal from "@/components/ui/DeleteConfirmModal";
import Modal from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import FileThumb from "@/components/ui/FileThumb";
import FileTypeArt from "@/components/ui/FileTypeArt";
import { fileKindLabel } from "@/lib/fileKinds";
import {
  LIBRARY_FILTERS, buildHomeSections, filesForFilter, filterByQuery, sortNewestFirst,
  type HomeSection, type LibraryFilter,
} from "@/lib/library";
import { FileCard, PlaylistCard, LibrarySkeleton } from "@/components/library/LibraryCards";
import HomeSections from "@/components/library/HomeSections";
import LibrarySearch from "@/components/library/LibrarySearch";
import RelativeTime from "@/components/library/RelativeTime";
import { parseTimestamp } from "@/lib/relativeTime";
import { markNavigatedFromLibrary } from "@/lib/playlistNav";
import LibraryMenu, { type MenuAction } from "@/components/library/LibraryMenu";
import type { FileItem, MenuTarget, PlaylistItem } from "@/components/library/types";

const CATEGORY_LABEL: Record<LibraryFilter, string> = {
  Home: "All files",
  Video: "Videos",
  Document: "Documents",
  Audio: "Audio",
  Image: "Images",
  Archive: "Archives",
  Playlist: "Playlists",
};

const EMPTY_COPY: Record<Exclude<LibraryFilter, "Home">, { title: string; hint: string }> = {
  Video: { title: "No videos yet", hint: "Videos you upload will appear here" },
  Document: { title: "No documents yet", hint: "Documents you upload will appear here" },
  Audio: { title: "No audio yet", hint: "Audio files you upload will appear here" },
  Image: { title: "No images yet", hint: "Images you upload will appear here" },
  Archive: { title: "No archives yet", hint: "Archives you upload will appear here" },
  Playlist: { title: "No playlists yet", hint: "Add a file to a playlist when you publish it" },
};

export default function FilesTab({ onCreateClick }: { onCreateClick?: () => void }) {
  const { toast } = useToast();
  const router = useRouter();
  const [activeFilter, setActiveFilter] = useState<LibraryFilter>("Home");
  const [viewMode, setViewMode] = useState<"grid" | "list">("list");
  const [files, setFiles] = useState<FileItem[]>([]);
  const [playlists, setPlaylists] = useState<PlaylistItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  /** Home → "Recently Added" → See all: a flat, newest-first list of every file. */
  const [showAllRecent, setShowAllRecent] = useState(false);
  const [menu, setMenu] = useState<MenuTarget | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; type: "file" | "playlist" } | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [detailFile, setDetailFile] = useState<FileItem | null>(null);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const chipBarRef = useRef<HTMLDivElement>(null);

  // One snapshot of the creator's library (both endpoints are scoped to the
  // signed-in user server-side). Home sections are derived from it — no per-section queries.
  const fetchAll = useCallback(async () => {
    try {
      const [filesRes, plRes] = await Promise.all([fetch("/api/files"), fetch("/api/playlists")]);
      if (filesRes.ok) setFiles(await filesRes.json().then((d) => d.files || []));
      if (plRes.ok) setPlaylists(await plRes.json().then((d) => d.playlists || []));
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchAll(); // initial data load on mount
  }, [fetchAll]);

  // A playlist opens as its own full page (route /playlists/[id]) — never in a popup.
  // Returning (Back / Telegram BackButton / Android back) lands on this tab again and re-fetches the library.
  const openPlaylist = useCallback((pl: PlaylistItem, view: "list" | "edit" = "list") => {
    markNavigatedFromLibrary();
    router.push(view === "edit" ? `/playlists/${pl.id}?edit=1` : `/playlists/${pl.id}`);
  }, [router]);

  // ── Search open / close ──────────────────────────────────────────────────
  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus();
  }, [searchOpen]);

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setSearch("");
  }, []);

  // ── Category navigation ─────────────────────────────────────────────────
  const selectFilter = useCallback((f: LibraryFilter) => {
    setActiveFilter(f);
    setShowAllRecent(false);
  }, []);

  // Keep the active chip visible in the horizontally scrolling bar (e.g. after "See all").
  useEffect(() => {
    const bar = chipBarRef.current;
    const chip = bar?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (!bar || !chip || typeof bar.scrollTo !== "function") return;
    bar.scrollTo({ left: chip.offsetLeft - (bar.clientWidth - chip.clientWidth) / 2, behavior: "smooth" });
  }, [activeFilter]);

  const handleSeeAll = useCallback((section: HomeSection<FileItem | PlaylistItem>) => {
    if (section.filter) {
      selectFilter(section.filter);
    } else {
      setActiveFilter("Home");
      setShowAllRecent(true);
    }
  }, [selectFilter]);

  // ── Derived view ────────────────────────────────────────────────────────
  const searching = search.trim().length > 0;

  const sections = useMemo(() => buildHomeSections(files, playlists), [files, playlists]);

  /** Flat list for category tabs, search results and "Recently Added → See all". */
  const flat = useMemo(() => {
    const showFiles = activeFilter !== "Playlist";
    const showPlaylists = activeFilter === "Home" || activeFilter === "Playlist";
    const fl = showFiles ? filterByQuery(sortNewestFirst(filesForFilter(files, activeFilter)), search) : [];
    const pl = showPlaylists && !(activeFilter === "Home" && showAllRecent && !searching)
      ? filterByQuery(sortNewestFirst(playlists), search)
      : [];
    return { files: fl, playlists: pl };
  }, [files, playlists, activeFilter, search, showAllRecent, searching]);

  const flatCount = flat.files.length + flat.playlists.length;
  const isHomeView = activeFilter === "Home" && !searching && !showAllRecent;
  const libraryEmpty = files.length === 0 && playlists.length === 0;

  // ── Actions ─────────────────────────────────────────────────────────────
  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleteLoading(true);
    try {
      const url = deleteTarget.type === "file" ? `/api/files/${deleteTarget.id}` : `/api/playlists/${deleteTarget.id}`;
      const res = await fetch(url, { method: "DELETE" });
      if (res.ok) {
        toast(`${deleteTarget.type === "file" ? "File" : "Playlist"} deleted successfully`);
        void fetchAll();
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

  const smartLink = (slug: string) => `${window.location.origin}/f/${slug}`;

  const handleShare = async (slug?: string) => {
    if (!slug) return;
    try {
      await navigator.clipboard.writeText(smartLink(slug));
      toast("Smart link copied to clipboard! 🔗");
    } catch {
      toast("Couldn't copy the link. Please copy it manually from File Details.", "error");
    }
  };

  const onMenuFile = useCallback((f: FileItem, anchor: DOMRect) => setMenu({ id: f.id, type: "file", anchor }), []);
  const onMenuPlaylist = useCallback((p: PlaylistItem, anchor: DOMRect) => setMenu({ id: p.id, type: "playlist", anchor }), []);
  const closeMenu = useCallback(() => setMenu(null), []);

  const menuActions: MenuAction[] = useMemo(() => {
    if (!menu) return [];
    if (menu.type === "playlist") {
      const pl = playlists.find((p) => p.id === menu.id);
      if (!pl) return [];
      return [
        { icon: Eye, label: "View posts", action: () => openPlaylist(pl) },
        { icon: Edit2, label: "Edit", action: () => openPlaylist(pl, "edit") },
        { icon: Trash2, label: "Delete", color: "text-red-500", action: () => setDeleteTarget({ id: pl.id, type: "playlist" }) },
      ];
    }
    const fi = files.find((f) => f.id === menu.id);
    if (!fi) return [];
    return [
      { icon: ExternalLink, label: "Open Link", color: "text-blue-500", action: () => { if (fi.smartLinkSlug) window.open(`/f/${fi.smartLinkSlug}`, "_blank"); } },
      { icon: Share2, label: "Share", color: "text-green-500", action: () => void handleShare(fi.smartLinkSlug) },
      { icon: BarChart2, label: "Analytics", color: "text-brand", action: () => setDetailFile(fi) },
      { icon: Trash2, label: "Delete", color: "text-red-500", action: () => setDeleteTarget({ id: fi.id, type: "file" }) },
    ];
    // handleShare only depends on stable inputs (toast); intentionally not a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menu, files, playlists, openPlaylist]);

  // ── Render helpers ──────────────────────────────────────────────────────
  const renderFlat = () => (
    <div className={cn(viewMode === "grid" ? "grid grid-cols-2 gap-3" : "flex flex-col gap-3")} data-testid="library-items" data-view={viewMode}>
      {flat.files.map((fi) => (
        <FileCard key={`f-${fi.id}`} file={fi} layout={viewMode} onOpen={setDetailFile} onMenu={onMenuFile} />
      ))}
      {flat.playlists.map((pl) => (
        <PlaylistCard key={`pl-${pl.id}`} playlist={pl} layout={viewMode} onOpen={openPlaylist} onMenu={onMenuPlaylist} />
      ))}
    </div>
  );

  const renderEmpty = () => {
    if (searching) {
      return (
        <div className="flex flex-col items-center justify-center gap-4 py-14 text-center" data-testid="library-empty-search">
          <div className="w-16 h-16 rounded-2xl bg-secondary flex items-center justify-center text-muted"><SearchX size={28} /></div>
          <div>
            <p className="font-semibold text-primary mb-1 break-words">No results for “{search.trim()}”</p>
            <p className="text-sm text-secondary">Check the spelling or try a different keyword</p>
          </div>
          <button type="button" onClick={closeSearch} className="btn-secondary px-5 py-2.5 text-sm">Clear search</button>
        </div>
      );
    }
    const copy = activeFilter !== "Home" && !libraryEmpty
      ? EMPTY_COPY[activeFilter]
      : { title: "No files yet", hint: "Upload your first file to get started" };
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-16" data-testid="library-empty">
        <div className="w-16 h-16 rounded-2xl relative overflow-hidden"><FileTypeArt kind="other" /></div>
        <div className="text-center">
          <p className="font-semibold text-primary mb-1">{copy.title}</p>
          <p className="text-sm text-secondary">{copy.hint}</p>
        </div>
        <button onClick={onCreateClick} className="btn-primary px-6 py-2.5 text-sm">Upload File</button>
      </div>
    );
  };

  const headerLabel = searching
    ? `${flatCount} ${flatCount === 1 ? "result" : "results"}`
    : showAllRecent
      ? "Recently Added"
      : CATEGORY_LABEL[activeFilter];

  return (
    <div className="flex flex-col gap-4">
      {/* Header: title · search icon · add — with the collapsible search field beneath */}
      <div>
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-bold text-primary">My Library</h1>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => (searchOpen ? closeSearch() : setSearchOpen(true))}
            aria-label={searchOpen ? "Close search" : "Search library"}
            aria-expanded={searchOpen}
            aria-controls="library-search-field"
            className={cn(
              "w-10 h-10 rounded-xl flex items-center justify-center border transition-colors",
              searchOpen ? "bg-brand-10 border-brand text-brand" : "bg-secondary border-app text-primary"
            )}
          >
            <Search size={18} />
          </button>
          <button
            type="button"
            onClick={onCreateClick}
            aria-label="Add file"
            className="w-10 h-10 rounded-xl bg-brand flex items-center justify-center active:scale-95 transition-transform"
          >
            <Plus size={20} color="white" />
          </button>
        </div>
      </div>

      <div id="library-search-field">
        <LibrarySearch ref={searchInputRef} open={searchOpen} query={search} onQueryChange={setSearch} onClose={closeSearch} />
      </div>
      </div>

      {/* Categories — horizontally scrollable, never squeezed into one row */}
      <div
        ref={chipBarRef}
        role="group"
        aria-label="Library categories"
        className="flex gap-2 overflow-x-auto no-scrollbar -mx-4 px-4"
        style={{ WebkitOverflowScrolling: "touch" }}
      >
        {LIBRARY_FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => selectFilter(f)}
            aria-pressed={activeFilter === f}
            className={cn(
              "flex-shrink-0 h-9 px-4 rounded-full text-[13px] font-semibold transition-colors border",
              activeFilter === f
                ? "bg-brand text-white border-transparent"
                : "bg-secondary text-secondary border-app hover:text-primary"
            )}
          >
            {f}
          </button>
        ))}
      </div>

      {/* Content */}
      {loading ? (
        <LibrarySkeleton layout={viewMode} />
      ) : isHomeView ? (
        sections.length === 0 ? renderEmpty() : (
          <HomeSections
            sections={sections}
            onOpenFile={setDetailFile}
            onMenuFile={onMenuFile}
            onOpenPlaylist={openPlaylist}
            onMenuPlaylist={onMenuPlaylist}
            onSeeAll={handleSeeAll}
          />
        )
      ) : (
        <>
          {/* Results header: back (for expanded Recently Added), label, List/Grid toggle */}
          <div className="flex items-center justify-between gap-2 min-h-10">
            <div className="flex items-center gap-1 min-w-0">
              {showAllRecent && !searching && (
                <button type="button" onClick={() => setShowAllRecent(false)} aria-label="Back to Home" className="w-10 h-10 -ml-2 flex items-center justify-center text-primary">
                  <ChevronLeft size={20} />
                </button>
              )}
              <p className="text-sm font-semibold text-primary truncate" data-testid="library-results-label">{headerLabel}</p>
              {!searching && flatCount > 0 && <span className="text-xs text-muted">{flatCount}</span>}
            </div>
            <div className="flex gap-1 flex-shrink-0" role="group" aria-label="Layout">
              {([["list", List, "List view"], ["grid", Grid, "Grid view"]] as const).map(([mode, Icon, label]) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setViewMode(mode)}
                  aria-label={label}
                  aria-pressed={viewMode === mode}
                  className={cn(
                    "w-10 h-10 rounded-xl flex items-center justify-center transition-colors",
                    viewMode === mode ? "bg-brand text-white" : "bg-secondary text-secondary"
                  )}
                >
                  <Icon size={15} />
                </button>
              ))}
            </div>
          </div>
          {flatCount === 0 ? renderEmpty() : renderFlat()}
        </>
      )}

      {/* Item action menu */}
      {menu && menuActions.length > 0 && <LibraryMenu anchor={menu.anchor} actions={menuActions} onClose={closeMenu} />}

      {/* Delete Modal */}
      <DeleteConfirmModal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        loading={deleteLoading}
        title={`Delete ${deleteTarget?.type === "file" ? "File" : "Playlist"}`}
        description={deleteTarget?.type === "file"
          ? "Are you sure you want to delete this file? It will also disappear from every playlist. This action cannot be undone."
          : "Delete this playlist? Its files will NOT be deleted — they stay in your Library and in any other playlist. Only the playlist itself is removed."}
      />

      {/* Detail Modal */}
      <Modal open={!!detailFile} onClose={() => setDetailFile(null)} title="File Details" size="md">
        {detailFile && (
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <div className="w-24 aspect-[4/3] rounded-xl bg-secondary relative overflow-hidden flex-shrink-0">
                <FileThumb url={detailFile.thumbnailUrl} fileType={detailFile.fileType} title={detailFile.title} mimeType={detailFile.mimeType} />
              </div>
              <div className="min-w-0">
                <p className="font-bold text-primary break-words">{detailFile.title}</p>
                <p className="text-sm text-secondary">{fileKindLabel(detailFile)}</p>
                {parseTimestamp(detailFile.createdAt) !== null && (
                  <p className="text-xs text-muted mt-0.5">Uploaded <RelativeTime value={detailFile.createdAt} /></p>
                )}
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
              onClick={() => { void handleShare(detailFile.smartLinkSlug); setDetailFile(null); }}
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
