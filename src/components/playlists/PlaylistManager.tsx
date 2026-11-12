"use client";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { ArrowLeft, ArrowRightLeft, Check, CopyPlus, GripVertical, ListPlus, Loader2, MoreHorizontal, Pencil, Search, Trash2, X } from "lucide-react";
import Modal from "@/components/ui/Modal";
import DeleteConfirmModal from "@/components/ui/DeleteConfirmModal";
import FileThumb from "@/components/ui/FileThumb";
import PlaylistThumb from "@/components/ui/PlaylistThumb";
import { useToast } from "@/components/ui/Toast";
import { cn } from "@/lib/utils";
import { fileKindLabel } from "@/lib/fileKinds";
import { PLAYLIST_DESCRIPTION_MAX, PLAYLIST_TITLE_MAX } from "@/lib/playlists";

export interface PlaylistSummary {
  id: number;
  title: string;
  description?: string | null;
  totalFiles?: number;
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

type View = { name: "list" } | { name: "edit" } | { name: "add" } | { name: "transfer"; file: MemberFile; mode: "add" | "move" };

const JSON_HEADERS = { "Content-Type": "application/json" };
/** Rows only travel up/down; keeps the dragged row inside the list column. */
const lockVertical: Modifier = ({ transform }) => ({ ...transform, x: 0 });

async function readJson(res: Response): Promise<Record<string, unknown> | null> {
  return (await res.json().catch(() => null)) as Record<string, unknown> | null;
}

export default function PlaylistManager({
  playlist,
  allPlaylists,
  initialView = "list",
  onClose,
  onPlaylistChanged,
  onChanged,
  onDeleted,
}: {
  playlist: PlaylistSummary;
  allPlaylists: PlaylistSummary[];
  initialView?: "list" | "edit";
  onClose: () => void;
  /** A fresh server copy of THIS playlist (title, count, derived cover). */
  onPlaylistChanged: (p: PlaylistSummary) => void;
  /** Something changed that may affect other playlists (move/add elsewhere). */
  onChanged: () => void;
  onDeleted: () => void;
}) {
  const { toast } = useToast();
  const [view, setView] = useState<View>(initialView === "edit" ? { name: "edit" } : { name: "list" });
  const [files, setFiles] = useState<MemberFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busyFileId, setBusyFileId] = useState<number | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const savingRef = useRef(false);

  const pid = playlist.id;

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(`/api/playlists/${pid}/files`, { cache: "no-store" });
      const data = await readJson(res);
      if (!res.ok) throw new Error("failed");
      setFiles(Array.isArray(data?.files) ? (data!.files as MemberFile[]) : []);
    } catch {
      setLoadError("Couldn't load this playlist. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [pid]);

  useEffect(() => {
    void load();
  }, [load]);

  // Mouse needs a small move before a drag starts; touch needs a short press so normal scrolling still works.
  // Both listeners live on the drag HANDLE only, so tapping/scrolling anywhere else never starts a drag.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 120, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const applySnapshot = (data: Record<string, unknown> | null) => {
    if (data?.files && Array.isArray(data.files)) setFiles(data.files as MemberFile[]);
    if (data?.playlist) onPlaylistChanged(data.playlist as PlaylistSummary);
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
        if (res.status === 409) await load(); // someone else changed it — show the truth
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

  const removeFile = async (f: MemberFile) => {
    if (busyFileId !== null || saving) return;
    setBusyFileId(f.id);
    try {
      const res = await fetch(`/api/playlists/${pid}/files/${f.id}`, { method: "DELETE" });
      const data = await readJson(res);
      if (!res.ok) throw new Error(String(data?.error ?? "failed"));
      applySnapshot(data);
      setExpandedId(null);
      toast("Removed from playlist. The file is still in your Library.");
    } catch {
      toast("Couldn't remove it from the playlist. Please try again.", "error");
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
      onDeleted();
    } catch {
      toast("Couldn't delete the playlist. Please try again.", "error");
    } finally {
      setDeleting(false);
    }
  };

  const locked = dragging || saving || busyFileId !== null;
  const memberIds = useMemo(() => new Set(files.map((f) => f.id)), [files]);
  const otherPlaylists = allPlaylists.filter((p) => p.id !== pid);

  const title = view.name === "edit" ? "Edit playlist" : view.name === "add" ? "Add files" : view.name === "transfer" ? (view.mode === "move" ? "Move to another playlist" : "Add to another playlist") : "Playlist";

  return (
    <>
      <Modal open onClose={onClose} title={title} size="lg">
        {view.name !== "list" && (
          <button type="button" onClick={() => setView({ name: "list" })} className="mb-3 -mt-1 inline-flex items-center gap-1.5 text-sm font-medium text-secondary min-h-9">
            <ArrowLeft size={15} /> Back to playlist
          </button>
        )}

        {view.name === "edit" && (
          <EditForm
            playlist={playlist}
            onSaved={(p) => {
              onPlaylistChanged(p);
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
            mode={view.mode}
            playlists={otherPlaylists}
            onDone={async () => {
              setView({ name: "list" });
              setExpandedId(null);
              await load();
              onChanged();
            }}
          />
        )}

        {view.name === "list" && (
          <div className="flex flex-col gap-4">
            {/* Header: cover = first file's thumbnail (derived), title, description */}
            <div className="flex items-start gap-3">
              <div className="relative w-16 h-16 rounded-2xl overflow-hidden flex-shrink-0 bg-secondary">
                <PlaylistThumb url={playlist.thumbnailUrl} />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="font-bold text-primary text-base leading-snug break-words">{playlist.title}</h3>
                {playlist.description ? (
                  <p className="text-sm text-secondary whitespace-pre-wrap break-words mt-0.5 line-clamp-3">{playlist.description}</p>
                ) : (
                  <p className="text-sm text-muted mt-0.5">No description</p>
                )}
                <p className="text-xs text-secondary mt-1">{files.length} {files.length === 1 ? "file" : "files"}</p>
              </div>
              <button type="button" onClick={() => setView({ name: "edit" })} className="flex-shrink-0 inline-flex items-center gap-1.5 px-3 min-h-9 rounded-xl bg-secondary text-sm font-medium text-primary" aria-label="Edit playlist name and description">
                <Pencil size={14} /> Edit
              </button>
            </div>

            <button type="button" onClick={() => setView({ name: "add" })} disabled={locked} className="btn-primary w-full py-3 text-sm flex items-center justify-center gap-2 disabled:opacity-60">
              <ListPlus size={16} /> Add files from Library
            </button>

            {loading ? (
              <p className="text-sm text-secondary text-center py-6" role="status">Loading…</p>
            ) : loadError ? (
              <div className="text-center py-4">
                <p role="alert" className="text-sm text-red-500 mb-3">{loadError}</p>
                <button type="button" className="btn-secondary text-sm px-4 py-2" onClick={() => void load()}>Try again</button>
              </div>
            ) : files.length === 0 ? (
              <div className="text-center py-6 px-2">
                <p className="text-sm font-semibold text-primary mb-1">This playlist is empty</p>
                <p className="text-sm text-secondary">Add files from your Library. The first file&apos;s thumbnail becomes the playlist cover.</p>
              </div>
            ) : (
              <>
                <p className="text-xs text-secondary flex items-center gap-1.5">
                  <GripVertical size={13} /> Press and hold the handle, then drag to reorder.
                  {saving && <Loader2 size={12} className="animate-spin ml-auto" aria-label="Saving order" />}
                </p>
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  modifiers={[lockVertical]}
                  onDragStart={() => {
                    setDragging(true);
                    setExpandedId(null);
                  }}
                  onDragCancel={() => setDragging(false)}
                  onDragEnd={(e) => void handleDragEnd(e)}
                >
                  <SortableContext items={files.map((f) => f.id)} strategy={verticalListSortingStrategy}>
                    <ul className="flex flex-col gap-2 max-h-[48vh] overflow-y-auto overscroll-contain pr-0.5" data-testid="playlist-files">
                      {files.map((f, index) => (
                        <SortableRow
                          key={f.id}
                          file={f}
                          index={index}
                          disabled={saving || busyFileId !== null}
                          locked={locked}
                          expanded={expandedId === f.id}
                          removing={busyFileId === f.id}
                          onToggle={() => setExpandedId((cur) => (cur === f.id ? null : f.id))}
                          onTransfer={(mode) => setView({ name: "transfer", file: f, mode })}
                          onRemove={() => void removeFile(f)}
                        />
                      ))}
                    </ul>
                  </SortableContext>
                </DndContext>
              </>
            )}

            <button type="button" onClick={() => setConfirmDelete(true)} disabled={locked} className="w-full py-2.5 text-sm font-medium text-red-500 flex items-center justify-center gap-2 disabled:opacity-60">
              <Trash2 size={14} /> Delete playlist
            </button>
          </div>
        )}
      </Modal>

      <DeleteConfirmModal
        open={confirmDelete}
        onClose={() => !deleting && setConfirmDelete(false)}
        onConfirm={() => void deletePlaylist()}
        loading={deleting}
        title="Delete playlist"
        description={`Delete “${playlist.title}”? Its ${files.length || playlist.totalFiles || 0} file(s) will NOT be deleted — they stay in your Library and in any other playlist. Only the playlist itself is removed.`}
      />
    </>
  );
}

// ─── Sortable row ───────────────────────────────────────────────────────────────

function SortableRow({
  file,
  index,
  disabled,
  locked,
  expanded,
  removing,
  onToggle,
  onTransfer,
  onRemove,
}: {
  file: MemberFile;
  index: number;
  disabled: boolean;
  locked: boolean;
  expanded: boolean;
  removing: boolean;
  onToggle: () => void;
  onTransfer: (mode: "add" | "move") => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: file.id, disabled });
  const style: React.CSSProperties = { transform: CSS.Transform.toString(transform), transition, zIndex: isDragging ? 20 : undefined, position: "relative" };

  return (
    <li ref={setNodeRef} style={style} data-testid="playlist-file-row" data-file-id={file.id} className={cn("rounded-xl bg-secondary", isDragging && "shadow-app-lg ring-2 ring-brand opacity-95")}>
      <div className="flex items-center gap-1.5 p-2">
        {/* Drag handle: the ONLY element that starts a drag. touch-action:none lets a finger drag it without scrolling the page. */}
        <button
          type="button"
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          disabled={disabled}
          aria-label={`Reorder ${file.title}`}
          data-testid="drag-handle"
          style={{ touchAction: "none" }}
          className="w-9 h-11 flex-shrink-0 flex items-center justify-center rounded-lg text-muted cursor-grab active:cursor-grabbing disabled:opacity-40"
        >
          <GripVertical size={18} />
        </button>
        <div className="w-14 h-10 rounded-lg bg-card relative overflow-hidden flex-shrink-0">
          <FileThumb url={file.thumbnailUrl} fileType={file.fileType} title={file.title} mimeType={file.mimeType} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-primary line-clamp-1">{file.title}</p>
          <p className="text-xs text-secondary flex items-center gap-1.5 flex-wrap">
            <span>{fileKindLabel(file)}</span>
            {index === 0 && <span className="chip bg-brand-10 text-brand" title="The first file's thumbnail is the playlist cover">Cover</span>}
          </p>
        </div>
        <button
          type="button"
          onClick={onToggle}
          disabled={locked}
          aria-expanded={expanded}
          aria-label={`Actions for ${file.title}`}
          className="w-9 h-9 flex-shrink-0 rounded-lg bg-card flex items-center justify-center disabled:opacity-50"
        >
          {expanded ? <X size={15} className="text-secondary" /> : <MoreHorizontal size={15} className="text-secondary" />}
        </button>
      </div>
      {expanded && !isDragging && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 px-2 pb-2">
          <button type="button" onClick={() => onTransfer("add")} disabled={locked} className="flex items-center justify-center gap-1.5 rounded-lg bg-card px-2 min-h-10 text-xs font-semibold text-primary disabled:opacity-50">
            <CopyPlus size={14} className="text-brand" /> Add to another playlist
          </button>
          <button type="button" onClick={() => onTransfer("move")} disabled={locked} className="flex items-center justify-center gap-1.5 rounded-lg bg-card px-2 min-h-10 text-xs font-semibold text-primary disabled:opacity-50">
            <ArrowRightLeft size={14} className="text-brand" /> Move to another playlist
          </button>
          <button type="button" onClick={onRemove} disabled={locked} className="flex items-center justify-center gap-1.5 rounded-lg bg-card px-2 min-h-10 text-xs font-semibold text-red-500 disabled:opacity-50">
            {removing ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />} {removing ? "Removing…" : "Remove from playlist"}
          </button>
        </div>
      )}
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
      <div className="relative">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
        <input className="input-app pl-9 py-2.5 text-sm" placeholder="Search your Library…" value={query} onChange={(e) => setQuery(e.target.value)} />
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
        <ul className="flex flex-col gap-2 max-h-[44vh] overflow-y-auto overscroll-contain" data-testid="library-picker">
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
      <button type="button" onClick={() => void submit()} disabled={selected.size === 0 || saving} className="btn-primary w-full py-3 text-sm flex items-center justify-center gap-2 disabled:opacity-60">
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
  mode,
  playlists,
  onDone,
}: {
  fromPlaylistId: number;
  file: MemberFile;
  mode: "add" | "move";
  playlists: PlaylistSummary[];
  onDone: () => Promise<void>;
}) {
  const { toast } = useToast();
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
