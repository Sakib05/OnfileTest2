"use client";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type Modifier,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ArrowRightLeft, Check, ChevronLeft, ChevronRight, CopyPlus, GripVertical, ListPlus, Loader2, Pencil, Search, Trash2 } from "lucide-react";
import DeleteConfirmModal from "@/components/ui/DeleteConfirmModal";
import FileThumb from "@/components/ui/FileThumb";
import PlaylistThumb from "@/components/ui/PlaylistThumb";
import { useToast } from "@/components/ui/Toast";
import { useApp } from "@/contexts/AppContext";
import SwipeableRow from "@/components/playlists/SwipeableRow";
import { cn } from "@/lib/utils";
import { fileKindLabel } from "@/lib/fileKinds";
import { PLAYLIST_DESCRIPTION_MAX, PLAYLIST_TITLE_MAX } from "@/lib/playlists";
import { useTelegramBackButton } from "@/lib/useTelegramBackButton";
import { consumeFromLibraryFlag } from "@/lib/playlistNav";

export interface PlaylistSummary {
  id: number;
  title: string;
  description?: string | null;
  totalFiles?: number;
  totalDownloads?: number;
  thumbnailUrl?: string | null;
  hasPassword?: boolean;
  starsPrice?: number;
  isPublished?: boolean;
}

interface MemberFile {
  id: number;
  title: string;
  fileType: string | null;
  mimeType: string | null;
  fileSize: number | null;
  isPublished: boolean | null;
  thumbnailUrl: string | null;
  position: number;
}

interface LibraryFile {
  id: number;
  title: string;
  fileType: string | null;
  mimeType?: string | null;
  fileSize?: number | null;
  thumbnailUrl?: string | null;
}

type View = { name: "list" } | { name: "edit" } | { name: "add" } | { name: "transfer"; file: MemberFile };

const JSON_HEADERS = { "Content-Type": "application/json" };
/** Rows only travel up/down; keeps the dragged row inside the list column. */
const lockVertical: Modifier = ({ transform }) => ({ ...transform, x: 0 });

async function readJson(res: Response): Promise<Record<string, unknown> | null> {
  return (await res.json().catch(() => null)) as Record<string, unknown> | null;
}

/**
 * Full-page playlist details (route: /playlists/[id]) — replaces the former popup.
 *
 * Hierarchy: Back · cover · title · description · file count · actions · ordered file list.
 * Everything the old manager did is preserved: edit title/description, add files from the
 * Library, drag to reorder, remove (now swipe-to-remove), add-to / move-to another playlist, delete.
 * The playlist cover is DERIVED server-side from the first ordered file's thumbnail — nothing is
 * uploaded or duplicated here; we only re-read the server's snapshot after every change.
 */
export default function PlaylistPage({ playlistId, initialView = "list" }: { playlistId: number; initialView?: "list" | "edit" }) {
  const { toast } = useToast();
  const router = useRouter();
  const { authStatus, channelStatus, setActiveTab } = useApp();

  const [playlist, setPlaylist] = useState<PlaylistSummary | null>(null);
  const [allPlaylists, setAllPlaylists] = useState<PlaylistSummary[]>([]);
  const [files, setFiles] = useState<MemberFile[]>([]);
  const [view, setView] = useState<View>(initialView === "edit" ? { name: "edit" } : { name: "list" });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<"notfound" | "failed" | null>(null);
  const [dragging, setDragging] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busyFileId, setBusyFileId] = useState<number | null>(null);
  const [openRowId, setOpenRowId] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const savingRef = useRef(false);
  const listRef = useRef<HTMLUListElement>(null);

  const pid = playlistId;
  const authed = authStatus === "authenticated";

  // ── Navigation ─────────────────────────────────────────────────────────────
  const goToLibrary = useCallback(() => {
    setActiveTab("files");
    if (consumeFromLibraryFlag()) router.back();
    else router.replace("/");
  }, [router, setActiveTab]);

  /** Back: from a sub-screen (edit / add / move) → the playlist; from the playlist → the Library. */
  const handleBack = useCallback(() => {
    if (view.name !== "list") setView({ name: "list" });
    else goToLibrary();
  }, [view.name, goToLibrary]);

  // Telegram's native BackButton (and the Android back gesture inside the Mini App) follows the same rule.
  useTelegramBackButton(handleBack);

  // Visitors / sessions without a verified creator account never see a dashboard page.
  useEffect(() => {
    if (authStatus === "guest" || authStatus === "setup_required" || channelStatus === "no_channel") router.replace("/");
  }, [authStatus, channelStatus, router]);

  // ── Data ───────────────────────────────────────────────────────────────────
  const loadFiles = useCallback(async () => {
    const res = await fetch(`/api/playlists/${pid}/files`, { cache: "no-store" });
    const data = await readJson(res);
    if (res.status === 404) throw new Error("notfound");
    if (!res.ok) throw new Error("failed");
    setFiles(Array.isArray(data?.files) ? (data!.files as MemberFile[]) : []);
  }, [pid]);

  const loadPlaylists = useCallback(async () => {
    const res = await fetch("/api/playlists", { cache: "no-store" });
    const data = await readJson(res);
    if (!res.ok) throw new Error("failed");
    const list = Array.isArray(data?.playlists) ? (data!.playlists as PlaylistSummary[]) : [];
    setAllPlaylists(list);
    const mine = list.find((p) => p.id === pid) ?? null;
    if (!mine) throw new Error("notfound");
    setPlaylist(mine);
  }, [pid]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      await Promise.all([loadPlaylists(), loadFiles()]);
    } catch (e) {
      setLoadError(e instanceof Error && e.message === "notfound" ? "notfound" : "failed");
    } finally {
      setLoading(false);
    }
  }, [loadPlaylists, loadFiles]);

  useEffect(() => {
    // Initial data load once the session is confirmed (network → state; nothing to derive during render).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (authed) void loadAll();
  }, [authed, loadAll]);

  // A revealed Remove panel closes when the user taps anywhere outside that row.
  useEffect(() => {
    if (openRowId === null) return;
    const onDown = (e: PointerEvent) => {
      const row = listRef.current?.querySelector(`[data-file-id="${openRowId}"]`);
      if (row && !row.contains(e.target as Node)) setOpenRowId(null);
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [openRowId]);

  // Mouse needs a small move before a drag starts; touch needs a short press so normal scrolling still works.
  // Both listeners live on the drag HANDLE only, so tapping/scrolling/swiping anywhere else never starts a drag.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 120, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  /** The server's truth after a change: ordered files + refreshed playlist (count, derived cover). */
  const applySnapshot = (data: Record<string, unknown> | null) => {
    if (data?.files && Array.isArray(data.files)) setFiles(data.files as MemberFile[]);
    if (data?.playlist) {
      const next = data.playlist as PlaylistSummary;
      setPlaylist((cur) => ({ ...cur, ...next }));
      setAllPlaylists((cur) => cur.map((p) => (p.id === next.id ? { ...p, ...next } : p)));
    }
  };

  const handleDragEnd = async (e: DragEndEvent) => {
    setDragging(false);
    const { active, over } = e;
    if (!over || active.id === over.id || savingRef.current) return;
    const from = files.findIndex((f) => f.id === active.id);
    const to = files.findIndex((f) => f.id === over.id);
    if (from < 0 || to < 0) return;

    const previous = files;
    const next = arrayMove(files, from, to);
    setFiles(next); // show the new order immediately
    savingRef.current = true;
    setSaving(true);
    try {
      const res = await fetch(`/api/playlists/${pid}/files`, { method: "PUT", headers: JSON_HEADERS, body: JSON.stringify({ fileIds: next.map((f) => f.id) }) });
      const data = await readJson(res);
      if (!res.ok) {
        setFiles(previous);
        toast(String(data?.error ?? "Couldn't save the new order."), "error");
        if (res.status === 409) await loadFiles().catch(() => undefined); // someone else changed it — show the truth
        return;
      }
      applySnapshot(data); // persisted order + refreshed cover (first file)
      toast("Order saved");
    } catch {
      setFiles(previous);
      toast("Network error. The order wasn't saved.", "error");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  /**
   * Remove ONE file's membership from THIS playlist (DELETE /api/playlists/:id/files/:fileId).
   * The file itself, its thumbnail and its membership in other playlists are untouched (server-side
   * guarantee; this route never touches /api/files). The row disappears immediately; if the request
   * fails the previous list, count and cover are restored.
   */
  const removeFile = async (f: MemberFile) => {
    if (busyFileId !== null || saving || savingRef.current) return;
    const prevFiles = files;
    const prevPlaylist = playlist;
    const next = files.filter((x) => x.id !== f.id);
    setBusyFileId(f.id);
    setOpenRowId(null);
    setFiles(next);
    setPlaylist((cur) => (cur ? { ...cur, totalFiles: next.length, thumbnailUrl: next[0]?.thumbnailUrl ?? null } : cur));
    try {
      const res = await fetch(`/api/playlists/${pid}/files/${f.id}`, { method: "DELETE" });
      const data = await readJson(res);
      if (!res.ok) {
        const err = new Error(String(data?.error ?? "failed")) as Error & { status?: number };
        err.status = res.status;
        throw err;
      }
      applySnapshot(data);
      toast("Removed from playlist. The file is still in your Library.");
    } catch (e) {
      setFiles(prevFiles); // restore the row where it was
      setPlaylist(prevPlaylist);
      toast("Couldn't remove it from the playlist. Please try again.", "error");
      if ((e as { status?: number }).status === 404) void loadFiles().catch(() => undefined);
    } finally {
      setBusyFileId(null);
    }
  };

  const deletePlaylist = async () => {
    setDeleting(true);
    try {
      const res = await fetch(`/api/playlists/${pid}`, { method: "DELETE" });
      if (!res.ok) throw new Error("failed");
      toast("Playlist deleted. Its files are still in your Library.");
      setConfirmDelete(false);
      consumeFromLibraryFlag();
      setActiveTab("files");
      router.replace("/"); // this page no longer exists — don't leave it in the history
    } catch {
      toast("Couldn't delete the playlist. Please try again.", "error");
    } finally {
      setDeleting(false);
    }
  };

  const locked = dragging || saving || busyFileId !== null;
  const memberIds = useMemo(() => new Set(files.map((f) => f.id)), [files]);
  const otherPlaylists = allPlaylists.filter((p) => p.id !== pid);

  const headerTitle =
    view.name === "edit" ? "Edit playlist" : view.name === "add" ? "Add files" : view.name === "transfer" ? "Add or move file" : "Playlist";

  // ── Render ─────────────────────────────────────────────────────────────────
  const shell = (children: React.ReactNode) => (
    <div className="min-h-screen bg-app" data-testid="playlist-page">
      <div className="max-w-2xl mx-auto w-full px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[calc(env(safe-area-inset-bottom)+2.5rem)]">
        <header className="flex items-center gap-1 mb-4 min-h-11">
          <button
            type="button"
            onClick={handleBack}
            aria-label={view.name === "list" ? "Back to My Library" : "Back to playlist"}
            data-testid="playlist-back"
            className="w-11 h-11 -ml-2.5 flex-shrink-0 rounded-full flex items-center justify-center text-primary active:bg-secondary transition-colors"
          >
            <ChevronLeft size={24} />
          </button>
          <p className="flex-1 min-w-0 text-center text-sm font-semibold text-secondary truncate pr-8" data-testid="playlist-header-title">{headerTitle}</p>
        </header>
        {children}
      </div>
    </div>
  );

  if (!authed || loading) {
    return shell(<PageSkeleton />);
  }

  if (loadError || !playlist) {
    return shell(
      <div className="text-center py-16 px-2" data-testid="playlist-error">
        <p className="font-semibold text-primary mb-1">{loadError === "notfound" ? "Playlist not found" : "Couldn't load this playlist"}</p>
        <p className="text-sm text-secondary mb-5">
          {loadError === "notfound" ? "It may have been deleted." : "Please check your connection and try again."}
        </p>
        <div className="flex items-center justify-center gap-2">
          {loadError !== "notfound" && (
            <button type="button" className="btn-primary text-sm px-5 py-2.5" onClick={() => void loadAll()}>Try again</button>
          )}
          <button type="button" className="btn-secondary text-sm px-5 py-2.5" onClick={goToLibrary}>Back to My Library</button>
        </div>
      </div>
    );
  }

  const count = files.length;

  return shell(
    <>
      {view.name === "edit" && (
        <EditForm
          playlist={playlist}
          onSaved={(p) => {
            setPlaylist((cur) => ({ ...cur, ...p }));
            setAllPlaylists((cur) => cur.map((x) => (x.id === p.id ? { ...x, ...p } : x)));
            setView({ name: "list" });
          }}
        />
      )}

      {view.name === "add" && (
        <AddFilesView
          playlistId={pid}
          memberIds={memberIds}
          onAdded={(data) => {
            applySnapshot(data);
            setView({ name: "list" });
          }}
        />
      )}

      {view.name === "transfer" && (
        <TransferView
          fromPlaylistId={pid}
          file={view.file}
          playlists={otherPlaylists}
          onDone={async () => {
            setView({ name: "list" });
            setOpenRowId(null);
            await Promise.all([loadFiles(), loadPlaylists()]).catch(() => undefined); // count + derived cover may have changed
          }}
        />
      )}

      {view.name === "list" && (
        <div className="flex flex-col gap-6">
          {/* Hero: cover (derived from the first file) · title · description · count · actions */}
          <section className="flex flex-col sm:flex-row gap-4 sm:gap-6 sm:items-end" aria-label="Playlist details">
            <div
              className="relative w-full sm:w-60 flex-shrink-0 aspect-video rounded-2xl overflow-hidden bg-secondary border border-app shadow-app-md"
              data-testid="playlist-cover"
            >
              <PlaylistThumb url={playlist.thumbnailUrl} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-brand">Playlist</p>
              <h1 className="text-2xl font-bold text-primary leading-tight break-words mt-1" data-testid="playlist-title">{playlist.title}</h1>
              {playlist.description ? (
                <p className="text-sm text-secondary whitespace-pre-wrap break-words mt-1.5" data-testid="playlist-description">{playlist.description}</p>
              ) : (
                <p className="text-sm text-muted mt-1.5" data-testid="playlist-description">No description</p>
              )}
              <p className="text-xs font-medium text-secondary mt-2.5" data-testid="playlist-count">
                {count} {count === 1 ? "file" : "files"}
              </p>
            </div>
          </section>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setView({ name: "add" })}
              disabled={locked}
              className="btn-primary flex-1 min-h-11 px-4 text-sm flex items-center justify-center gap-2 disabled:opacity-60"
            >
              <ListPlus size={16} /> Add files from Library
            </button>
            <button
              type="button"
              onClick={() => setView({ name: "edit" })}
              disabled={locked}
              aria-label="Edit playlist name and description"
              className="flex-shrink-0 inline-flex items-center justify-center gap-1.5 px-4 min-h-11 rounded-xl bg-secondary border border-app text-sm font-semibold text-primary disabled:opacity-60"
            >
              <Pencil size={14} /> Edit
            </button>
          </div>

          {/* Ordered files */}
          <section aria-label="Playlist files">
            <div className="flex items-center justify-between gap-2 mb-1">
              <h2 className="text-base font-bold text-primary flex items-baseline gap-2">
                Files <span className="text-xs font-medium text-muted">{count}</span>
              </h2>
              {saving && <Loader2 size={14} className="animate-spin text-secondary" aria-label="Saving order" />}
            </div>

            {loadError === null && count === 0 ? (
              <div className="text-center py-10 px-2 rounded-2xl border border-dashed border-app">
                <p className="text-sm font-semibold text-primary mb-1">This playlist is empty</p>
                <p className="text-sm text-secondary">Add files from your Library. The first file&apos;s thumbnail becomes the playlist cover.</p>
              </div>
            ) : (
              <>
                <p className="text-xs text-secondary mb-3" data-testid="playlist-hint">
                  Swipe a file left to remove it · hold <GripVertical size={12} className="inline -mt-0.5" aria-hidden="true" /> and drag to reorder · tap a file to add or move it to another playlist.
                </p>
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  modifiers={[lockVertical]}
                  onDragStart={() => {
                    setDragging(true);
                    setOpenRowId(null);
                  }}
                  onDragCancel={() => setDragging(false)}
                  onDragEnd={(e) => void handleDragEnd(e)}
                >
                  <SortableContext items={files.map((f) => f.id)} strategy={verticalListSortingStrategy}>
                    <ul ref={listRef} className="flex flex-col gap-2" data-testid="playlist-files">
                      {files.map((f, index) => (
                        <SortableRow
                          key={f.id}
                          file={f}
                          index={index}
                          disabled={saving || busyFileId !== null}
                          locked={locked}
                          open={openRowId === f.id}
                          removing={busyFileId === f.id}
                          onOpenChange={(o) => setOpenRowId(o ? f.id : (cur) => (cur === f.id ? null : cur))}
                          onSwipeStart={() => setOpenRowId((cur) => (cur !== null && cur !== f.id ? null : cur))}
                          onOpenTransfer={() => setView({ name: "transfer", file: f })}
                          onRemove={() => void removeFile(f)}
                        />
                      ))}
                    </ul>
                  </SortableContext>
                </DndContext>
              </>
            )}
          </section>

          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            disabled={locked}
            className="w-full min-h-11 py-2.5 text-sm font-medium text-red-500 flex items-center justify-center gap-2 disabled:opacity-60"
          >
            <Trash2 size={14} /> Delete playlist
          </button>
        </div>
      )}

      <DeleteConfirmModal
        open={confirmDelete}
        onClose={() => !deleting && setConfirmDelete(false)}
        onConfirm={() => void deletePlaylist()}
        loading={deleting}
        title="Delete playlist"
        description={`Delete “${playlist.title}”? Its ${count || playlist.totalFiles || 0} file(s) will NOT be deleted — they stay in your Library and in any other playlist. Only the playlist itself is removed.`}
      />
    </>
  );
}

function PageSkeleton() {
  return (
    <div className="flex flex-col gap-5" aria-busy="true" aria-label="Loading playlist" role="status">
      <div className="w-full aspect-video rounded-2xl bg-card border border-app animate-pulse-brand" />
      <div className="h-7 w-2/3 rounded-lg bg-card animate-pulse-brand" />
      <div className="h-4 w-1/2 rounded-lg bg-card animate-pulse-brand" />
      {[1, 2, 3].map((i) => (
        <div key={i} className="h-16 rounded-xl bg-card border border-app animate-pulse-brand" />
      ))}
    </div>
  );
}

// ─── Sortable, swipeable row ─────────────────────────────────────────────────────

function SortableRow({
  file,
  index,
  disabled,
  locked,
  open,
  removing,
  onOpenChange,
  onSwipeStart,
  onOpenTransfer,
  onRemove,
}: {
  file: MemberFile;
  index: number;
  disabled: boolean;
  locked: boolean;
  open: boolean;
  removing: boolean;
  onOpenChange: (open: boolean) => void;
  onSwipeStart: () => void;
  onOpenTransfer: () => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: file.id, disabled });
  const style: React.CSSProperties = { transform: CSS.Transform.toString(transform), transition, zIndex: isDragging ? 20 : undefined, position: "relative" };

  return (
    <li
      ref={setNodeRef}
      style={style}
      data-testid="playlist-file-row"
      data-file-id={file.id}
      className={cn("rounded-xl", isDragging && "shadow-app-lg ring-2 ring-brand opacity-95")}
    >
      <SwipeableRow
        open={open && !isDragging}
        onOpenChange={onOpenChange}
        onSwipeStart={onSwipeStart}
        onRemove={onRemove}
        removeLabel={`Remove ${file.title} from playlist`}
        disabled={locked && !removing}
        removing={removing}
      >
        <div className="flex items-center gap-1.5 p-2 pr-1">
          {/* Drag handle: the ONLY element that starts a reorder drag. touch-action:none lets a finger drag it without
              scrolling the page; data-no-swipe stops the row's swipe gesture from ever starting on it. */}
          <button
            type="button"
            ref={setActivatorNodeRef}
            {...attributes}
            {...listeners}
            disabled={disabled}
            aria-label={`Reorder ${file.title}`}
            data-testid="drag-handle"
            data-no-swipe=""
            style={{ touchAction: "none" }}
            className="w-9 h-11 flex-shrink-0 flex items-center justify-center rounded-lg text-muted cursor-grab active:cursor-grabbing disabled:opacity-40"
          >
            <GripVertical size={18} />
          </button>
          <div className="w-16 h-12 rounded-lg bg-card relative overflow-hidden flex-shrink-0">
            <FileThumb url={file.thumbnailUrl} fileType={file.fileType} title={file.title} mimeType={file.mimeType} />
          </div>
          <button
            type="button"
            onClick={onOpenTransfer}
            disabled={locked}
            aria-label={`Add or move ${file.title} to another playlist`}
            className="min-w-0 flex-1 flex items-center gap-1 self-stretch text-left disabled:opacity-60"
          >
            <span className="min-w-0 flex-1 block">
              <span className="block text-sm font-semibold text-primary line-clamp-1">{file.title}</span>
              <span className="text-xs text-secondary flex items-center gap-1.5 flex-wrap">
                <span>{fileKindLabel(file)}</span>
                {index === 0 && <span className="chip bg-brand-10 text-brand" title="The first file's thumbnail is the playlist cover">Cover</span>}
              </span>
            </span>
            <ChevronRight size={16} className="flex-shrink-0 text-muted" aria-hidden="true" />
          </button>
        </div>
      </SwipeableRow>
    </li>
  );
}

// ─── Edit name / description ──────────────────────────────────────────────────

function EditForm({ playlist, onSaved }: { playlist: PlaylistSummary; onSaved: (p: PlaylistSummary) => void }) {
  const { toast } = useToast();
  const [title, setTitle] = useState(playlist.title);
  const [description, setDescription] = useState(playlist.description ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = title.trim() !== playlist.title || description.trim() !== (playlist.description ?? "");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (saving) return;
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
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <div>
        <label htmlFor="pl-edit-title" className="text-xs font-semibold text-secondary mb-1.5 block">Playlist name</label>
        <input id="pl-edit-title" className="input-app" value={title} maxLength={PLAYLIST_TITLE_MAX} onChange={(e) => setTitle(e.target.value)} autoFocus />
      </div>
      <div>
        <label htmlFor="pl-edit-desc" className="text-xs font-semibold text-secondary mb-1.5 block">Description (optional)</label>
        <textarea id="pl-edit-desc" className="input-app min-h-28" value={description} maxLength={PLAYLIST_DESCRIPTION_MAX} onChange={(e) => setDescription(e.target.value)} />
        <p className="text-[11px] text-muted text-right mt-1">{description.length}/{PLAYLIST_DESCRIPTION_MAX}</p>
      </div>
      {error && <p role="alert" className="text-xs text-red-500 bg-red-50 dark:bg-red-900/20 rounded-xl px-3 py-2">{error}</p>}
      <button type="submit" disabled={saving || !dirty} className="btn-primary w-full py-3 text-sm flex items-center justify-center gap-2 disabled:opacity-60">
        {saving ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />} {saving ? "Saving…" : "Save changes"}
      </button>
    </form>
  );
}

// ─── Add library files ───────────────────────────────────────────────────────

function AddFilesView({ playlistId, memberIds, onAdded }: { playlistId: number; memberIds: Set<number>; onAdded: (data: Record<string, unknown> | null) => void }) {
  const { toast } = useToast();
  const [library, setLibrary] = useState<LibraryFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);

  const loadLibrary = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch("/api/files", { cache: "no-store" });
      if (!res.ok) throw new Error("failed");
      const data = await readJson(res);
      setLibrary(Array.isArray(data?.files) ? (data!.files as LibraryFile[]) : []);
    } catch {
      setLoadError("Couldn't load your Library. Please try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadLibrary();
  }, [loadLibrary]);

  const shown = library.filter((f) => !query.trim() || f.title.toLowerCase().includes(query.trim().toLowerCase()));
  const toggle = (id: number) =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const submit = async () => {
    if (selected.size === 0 || saving) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/playlists/${playlistId}/files`, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ fileIds: [...selected] }) });
      const data = await readJson(res);
      if (!res.ok) {
        toast(String(data?.error ?? "Couldn't add the files. Please try again."), "error");
        return;
      }
      const added = Array.isArray(data?.added) ? data!.added.length : 0;
      const skipped = Array.isArray(data?.alreadyMembers) ? data!.alreadyMembers.length : 0;
      toast(added > 0 ? `Added ${added} ${added === 1 ? "file" : "files"}${skipped ? ` (${skipped} already in the playlist)` : ""}` : "Those files are already in the playlist", added > 0 ? "success" : "info");
      onAdded(data);
    } catch {
      toast("Network error. Please try again.", "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-secondary">Pick files from your Library. They are added by reference — the originals are never copied or changed.</p>
      <div className="flex items-center gap-2 h-11 pl-3.5 pr-3 rounded-xl border-[1.5px] border-app bg-secondary focus-within:border-[#FF6115] focus-within:shadow-[0_0_0_3px_rgba(255,97,21,0.15)] transition-[border-color,box-shadow]">
        <Search size={15} className="flex-shrink-0 text-muted" aria-hidden="true" />
        <input
          className="flex-1 min-w-0 h-full p-0 bg-transparent border-0 outline-none text-sm text-primary placeholder:text-muted appearance-none [&::-webkit-search-cancel-button]:hidden"
          type="search"
          placeholder="Search your Library…"
          aria-label="Search your Library"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      {loading ? (
        <p className="text-sm text-secondary text-center py-6" role="status">Loading…</p>
      ) : loadError ? (
        <div className="text-center py-4">
          <p role="alert" className="text-sm text-red-500 mb-3">{loadError}</p>
          <button type="button" className="btn-secondary text-sm px-4 py-2" onClick={() => void loadLibrary()}>Try again</button>
        </div>
      ) : shown.length === 0 ? (
        <p className="text-sm text-secondary text-center py-6">{library.length === 0 ? "Your Library has no files yet." : "No files match your search."}</p>
      ) : (
        <ul className="flex flex-col gap-2" data-testid="library-picker">
          {shown.map((f) => {
            const already = memberIds.has(f.id);
            const checked = selected.has(f.id);
            return (
              <li key={f.id}>
                <label className={cn("flex items-center gap-3 rounded-xl p-2.5 bg-secondary min-h-14", already ? "opacity-60" : "cursor-pointer", checked && "ring-2 ring-brand")}>
                  <input type="checkbox" className="w-5 h-5 accent-[var(--color-primary)] flex-shrink-0" checked={checked} disabled={already} onChange={() => toggle(f.id)} aria-label={`Select ${f.title}`} />
                  <div className="w-14 h-10 rounded-lg bg-card relative overflow-hidden flex-shrink-0">
                    <FileThumb url={f.thumbnailUrl} fileType={f.fileType} title={f.title} mimeType={f.mimeType} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-primary line-clamp-1">{f.title}</p>
                    <p className="text-xs text-secondary">{fileKindLabel(f)}</p>
                  </div>
                  {already && <span className="chip bg-brand-10 text-brand flex-shrink-0">In playlist</span>}
                </label>
              </li>
            );
          })}
        </ul>
      )}
      <button type="button" onClick={() => void submit()} disabled={selected.size === 0 || saving} className="btn-primary sticky bottom-[calc(env(safe-area-inset-bottom)+12px)] w-full min-h-11 py-3 text-sm flex items-center justify-center gap-2 shadow-app-md disabled:opacity-60">
        {saving ? <Loader2 size={15} className="animate-spin" /> : <ListPlus size={15} />}
        {saving ? "Adding…" : selected.size > 0 ? `Add ${selected.size} ${selected.size === 1 ? "file" : "files"}` : "Select files to add"}
      </button>
    </div>
  );
}

// ─── Add to / move to another playlist ─────────────────────────────────────────

function TransferView({
  fromPlaylistId,
  file,
  playlists,
  onDone,
}: {
  fromPlaylistId: number;
  file: MemberFile;
  playlists: PlaylistSummary[];
  onDone: () => Promise<void>;
}) {
  const { toast } = useToast();
  const [mode, setMode] = useState<"add" | "move">("add");
  const [target, setTarget] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (target === null || saving) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/playlists/${fromPlaylistId}/files/${file.id}/transfer`, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ toPlaylistId: target, mode }) });
      const data = await readJson(res);
      if (!res.ok) {
        toast(String(data?.error ?? "Couldn't update the playlists. Please try again."), "error");
        return;
      }
      const dest = playlists.find((p) => p.id === target)?.title ?? "the playlist";
      if (data?.alreadyInDestination) toast(mode === "move" ? `Already in “${dest}” — removed from this playlist.` : `Already in “${dest}”.`, "info");
      else toast(mode === "move" ? `Moved to “${dest}”` : `Also added to “${dest}”`);
      await onDone();
    } catch {
      toast("Network error. Please try again.", "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3 bg-secondary rounded-xl p-2.5">
        <div className="w-14 h-10 rounded-lg bg-card relative overflow-hidden flex-shrink-0">
          <FileThumb url={file.thumbnailUrl} fileType={file.fileType} title={file.title} mimeType={file.mimeType} />
        </div>
        <p className="text-sm font-semibold text-primary line-clamp-2 min-w-0">{file.title}</p>
      </div>
      <div role="group" aria-label="Action" className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-secondary">
        {([["add", "Add to another playlist", CopyPlus], ["move", "Move to another playlist", ArrowRightLeft]] as const).map(([m, label, Icon]) => (
          <button
            key={m}
            type="button"
            aria-pressed={mode === m}
            onClick={() => setMode(m)}
            className={cn(
              "flex items-center justify-center gap-1.5 rounded-lg min-h-11 px-2 text-xs font-semibold transition-colors",
              mode === m ? "bg-card text-primary shadow-app-sm" : "text-secondary"
            )}
          >
            <Icon size={14} className={mode === m ? "text-brand" : undefined} /> {label}
          </button>
        ))}
      </div>
      <p className="text-sm text-secondary">
        {mode === "move"
          ? "Move: the file leaves this playlist and is added to the one you choose."
          : "Add: the file stays in this playlist and is also added to the one you choose."}{" "}
        Either way, the original file stays in your Library.
      </p>
      {playlists.length === 0 ? (
        <p className="text-sm text-secondary text-center py-6">You have no other playlists yet. Create one from the Publish tab first.</p>
      ) : (
        <ul className="flex flex-col gap-2 max-h-[40vh] overflow-y-auto overscroll-contain" role="radiogroup" aria-label="Destination playlist">
          {playlists.map((p) => (
            <li key={p.id}>
              <label className={cn("flex items-center gap-3 rounded-xl p-2.5 bg-secondary cursor-pointer min-h-14", target === p.id && "ring-2 ring-brand")}>
                <input type="radio" name="destination" className="w-5 h-5 accent-[var(--color-primary)] flex-shrink-0" checked={target === p.id} onChange={() => setTarget(p.id)} aria-label={p.title} />
                <div className="w-12 h-10 rounded-lg relative overflow-hidden flex-shrink-0 bg-card">
                  <PlaylistThumb url={p.thumbnailUrl} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-primary line-clamp-1">{p.title}</p>
                  <p className="text-xs text-secondary">{p.totalFiles ?? 0} files</p>
                </div>
              </label>
            </li>
          ))}
        </ul>
      )}
      <button type="button" onClick={() => void submit()} disabled={target === null || saving} className="btn-primary w-full py-3 text-sm flex items-center justify-center gap-2 disabled:opacity-60">
        {saving ? <Loader2 size={15} className="animate-spin" /> : mode === "move" ? <ArrowRightLeft size={15} /> : <CopyPlus size={15} />}
        {saving ? "Working…" : mode === "move" ? "Move here" : "Add here"}
      </button>
    </div>
  );
}
