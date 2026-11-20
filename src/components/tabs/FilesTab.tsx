"use client";
import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  Edit2, Share2, Trash2, Grid, List, Search, Eye, SearchX,
  Pencil, ImagePlus, ListPlus, Link2, QrCode, Info,
} from "lucide-react";
import { cn } from "@/lib/utils";
import DeleteConfirmModal from "@/components/ui/DeleteConfirmModal";
import { useToast } from "@/components/ui/Toast";
import FileTypeArt from "@/components/ui/FileTypeArt";
import {
  LIBRARY_FILTERS, buildHomeSections, filesForFilter, filterByQuery, sortNewestFirst,
  type HomeSection, type LibraryFilter,
} from "@/lib/library";
import { FileCard, PlaylistCard, LibrarySkeleton } from "@/components/library/LibraryCards";
import HomeSections from "@/components/library/HomeSections";
import LibrarySearch from "@/components/library/LibrarySearch";
import { markNavigatedFromLibrary } from "@/lib/playlistNav";
import { useTelegramBackButton } from "@/lib/useTelegramBackButton";
import LibraryMenu, { type MenuAction } from "@/components/library/LibraryMenu";
import type { FileItem, MenuTarget, PlaylistItem } from "@/components/library/types";
import EditDetailsDialog from "@/components/library/file/EditDetailsDialog";
import ChangeThumbnailDialog from "@/components/library/file/ChangeThumbnailDialog";
import ManagePlaylistsDialog from "@/components/library/file/ManagePlaylistsDialog";
import ShareFileDialog from "@/components/library/file/ShareFileDialog";
import QrCodeDialog from "@/components/library/file/QrCodeDialog";
import FileDetailsDialog from "@/components/library/file/FileDetailsDialog";
import DeleteFileDialog from "@/components/library/file/DeleteFileDialog";
import { copyText } from "@/lib/playlistShareClient";
import { fileShareAvailability, fileShareUrl } from "@/lib/fileShare";

type FileDialogKind = "edit" | "thumbnail" | "playlists" | "share" | "qr" | "details" | "delete";

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
  // Playlist deletion keeps the generic confirm; file deletion has its own dialog that lists the affected playlists.
  const [deleteTarget, setDeleteTarget] = useState<{ id: number } | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  // One file dialog at a time (edit / thumbnail / playlists / share / qr / details / delete). Holds the id only, so the
  // dialog always shows the live record from `files` (e.g. the new thumbnail right after saving).
  const [fileDialog, setFileDialog] = useState<{ kind: FileDialogKind; id: number } | null>(null);

  const activeFile = useMemo(() => (fileDialog ? files.find((f) => f.id === fileDialog.id) ?? null : null), [fileDialog, files]);

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

  // "Recently Added → See all" is a nested view: Telegram's native Back Button (the only back
  // control — there is no in-page arrow) collapses it back to the Library home; hidden otherwise.
  useTelegramBackButton(() => setShowAllRecent(false), showAllRecent && !searching);

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
  const handleDeletePlaylist = async () => {
    if (!deleteTarget) return;
    setDeleteLoading(true);
    try {
      const res = await fetch(`/api/playlists/${deleteTarget.id}`, { method: "DELETE" });
      if (res.ok) {
        toast("Playlist deleted successfully");
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

  const openFileDialog = useCallback((kind: FileDialogKind, f: FileItem) => setFileDialog({ kind, id: f.id }), []);
  const openDetails = useCallback((f: FileItem) => setFileDialog({ kind: "details", id: f.id }), []);
  const closeFileDialog = useCallback(() => setFileDialog(null), []);
  const patchFile = useCallback((id: number, patch: Partial<FileItem>) => setFiles((cur) => cur.map((f) => (f.id === id ? { ...f, ...patch } : f))), []);

  /** Copy Link: only a valid public smart link, never anything else; private files get an explanation instead. */
  const copyFileLink = async (f: FileItem) => {
    const availability = fileShareAvailability(f);
    const url = availability.ok ? fileShareUrl(window.location.origin, f) : null;
    if (!availability.ok || !url) {
      toast(availability.ok ? "Couldn't build the link." : availability.message, "error");
      return;
    }
    const ok = await copyText(url);
    toast(ok ? "Link copied to clipboard 🔗" : "Couldn't copy the link. Open Share to copy it manually.", ok ? "success" : "error");
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
        { icon: Trash2, label: "Delete", color: "text-red-500", action: () => setDeleteTarget({ id: pl.id }) },
      ];
    }
    const fi = files.find((f) => f.id === menu.id);
    if (!fi) return [];
    // Share / Copy link / QR need a valid public link: a private (unpublished) file has none, so those items stay
    // visible but dimmed, say why, and explain it when tapped instead of producing a dead or unrestricted link.
    const shareable = fileShareAvailability(fi).ok;
    const privateHint = shareable ? undefined : "Private — publish to share";
    return [
      { icon: Pencil, label: "Edit Details", action: () => openFileDialog("edit", fi) },
      { icon: ImagePlus, label: "Change Thumbnail", action: () => openFileDialog("thumbnail", fi) },
      { icon: ListPlus, label: "Manage Playlists", action: () => openFileDialog("playlists", fi) },
      { icon: Share2, label: "Share", separated: true, unavailable: !shareable, hint: privateHint, action: () => openFileDialog("share", fi) },
      { icon: Link2, label: "Copy Link", unavailable: !shareable, hint: privateHint, action: () => void copyFileLink(fi) },
      { icon: QrCode, label: "Generate QR Code", unavailable: !shareable, hint: privateHint, action: () => openFileDialog("qr", fi) },
      { icon: Info, label: "File Details", separated: true, action: () => openFileDialog("details", fi) },
      { icon: Trash2, label: "Delete File", destructive: true, action: () => openFileDialog("delete", fi) },
    ];
    // copyFileLink only depends on stable inputs (toast); intentionally not a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menu, files, playlists, openPlaylist]);

  // ── Render helpers ──────────────────────────────────────────────────────
  const renderFlat = () => (
    <div className={cn(viewMode === "grid" ? "grid grid-cols-2 gap-3" : "flex flex-col gap-3")} data-testid="library-items" data-view={viewMode}>
      {flat.files.map((fi) => (
        <FileCard key={`f-${fi.id}`} file={fi} layout={viewMode} onOpen={openDetails} onMenu={onMenuFile} />
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
      {/* Header: title · search icon — with the collapsible search field beneath.
          (Adding a file lives in the Create tab and the empty-state "Upload File" button.) */}
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
            onOpenFile={openDetails}
            onMenuFile={onMenuFile}
            onOpenPlaylist={openPlaylist}
            onMenuPlaylist={onMenuPlaylist}
            onSeeAll={handleSeeAll}
          />
        )
      ) : (
        <>
          {/* Results header: label, List/Grid toggle (no in-page back: the native Back Button collapses "Recently Added") */}
          <div className="flex items-center justify-between gap-2 min-h-10">
            <div className="flex items-center gap-1 min-w-0">
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

      {/* Playlist delete confirmation (files use DeleteFileDialog below) */}
      <DeleteConfirmModal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDeletePlaylist}
        loading={deleteLoading}
        title="Delete Playlist"
        description="Delete this playlist? Its files will NOT be deleted — they stay in your Library and in any other playlist. Only the playlist itself is removed."
      />

      {/* File dialogs (opened from the file ⋮ menu or by tapping a card) */}
      {activeFile && fileDialog?.kind === "edit" && (
        <EditDetailsDialog
          key={activeFile.id}
          file={activeFile}
          onClose={closeFileDialog}
          onSaved={(d) => patchFile(activeFile.id, { title: d.title, description: d.description ?? undefined, updatedAt: d.updatedAt ?? activeFile.updatedAt })}
        />
      )}
      {activeFile && fileDialog?.kind === "thumbnail" && (
        <ChangeThumbnailDialog
          key={activeFile.id}
          file={activeFile}
          onClose={closeFileDialog}
          onChanged={(t) => {
            patchFile(activeFile.id, { thumbnailUrl: t.url, thumbnailWidth: t.width, thumbnailHeight: t.height });
            void fetchAll(); // playlist covers derive from the first file's thumbnail
          }}
        />
      )}
      {activeFile && fileDialog?.kind === "playlists" && (
        <ManagePlaylistsDialog key={activeFile.id} file={activeFile} onClose={closeFileDialog} onChanged={() => void fetchAll()} />
      )}
      {activeFile && fileDialog?.kind === "share" && (
        <ShareFileDialog file={activeFile} onClose={closeFileDialog} onQr={() => openFileDialog("qr", activeFile)} />
      )}
      {activeFile && fileDialog?.kind === "qr" && <QrCodeDialog file={activeFile} onClose={closeFileDialog} />}
      {activeFile && fileDialog?.kind === "details" && <FileDetailsDialog key={activeFile.id} file={activeFile} onClose={closeFileDialog} />}
      {activeFile && fileDialog?.kind === "delete" && (
        <DeleteFileDialog
          key={activeFile.id}
          file={activeFile}
          onClose={closeFileDialog}
          onDeleted={(id) => {
            setFiles((cur) => cur.filter((f) => f.id !== id));
            setFileDialog(null);
            void fetchAll(); // playlist counts / covers may have changed
          }}
        />
      )}
    </div>
  );
}
