"use client";
import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
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
import { SortableContext, arrayMove, sortableKeyboardCoordinates, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { ChevronLeft, CircleDollarSign, Copy, EyeOff, Globe, GripVertical, ListPlus, Loader2, Pencil, Share2, Trash2 } from "lucide-react";
import { type ActionMenuItem } from "@/components/ui/ActionMenu";
import DeleteConfirmModal from "@/components/ui/DeleteConfirmModal";
import ShareSheet from "@/components/playlists/ShareSheet";
import { useToast } from "@/components/ui/Toast";
import { cn } from "@/lib/utils";
import { useApp } from "@/contexts/AppContext";
import { itemHref } from "@/lib/playlistSharing";
import { requestShareLink } from "@/lib/playlistShareClient";
import { chunkIds, duplicateTitle, moveToFront, previewBlock, summariseFiles } from "@/lib/playlistManage";
import { useTelegramBackButton } from "@/lib/useTelegramBackButton";
import { isRunningInsideTelegram } from "@/lib/telegramWebApp";
import { consumeFromLibraryFlag } from "@/lib/playlistNav";
import PlaylistHero from "@/components/playlists/manage/PlaylistHero";
import ManageFileRow from "@/components/playlists/manage/ManageFileRow";
import AddFilesView from "@/components/playlists/manage/AddFilesView";
import EditDetailsView from "@/components/playlists/manage/EditDetailsView";
import SettingsForm from "@/components/playlists/manage/SettingsForm";
import TransferView from "@/components/playlists/manage/TransferView";
import ConfirmDialog from "@/components/playlists/manage/ConfirmDialog";
import { JSON_HEADERS, isOpenable, readJson, type MemberFile, type PlaylistSummary } from "@/components/playlists/manage/types";

export type { PlaylistSummary } from "@/components/playlists/manage/types";

type View =
  | { name: "list" }
  | { name: "edit" }
  | { name: "add" }
  | { name: "monetization" }
  | { name: "transfer"; file: MemberFile; mode: "add" | "move" }
  | { name: "fileSettings"; file: MemberFile };

type Confirm = { kind: "remove"; file: MemberFile } | { kind: "unpublish"; file: MemberFile } | { kind: "private" } | { kind: "duplicate" } | null;

/** Rows only travel up/down; keeps the dragged row inside the list column. */
const lockVertical: Modifier = ({ transform }) => ({ ...transform, x: 0 });

const noopSubscribe = () => () => {};

/**
 * Creator playlist management page (route: /playlists/[id]) — a dashboard-style workspace, separate from the
 * public viewer (/p/<token>, /f/<slug>), which it only links to.
 *
 * Layout: header (back · heading · ⋮) → cover → info → Add Files / Preview / Share / More → compact analytics → ordered files.
 * Every operation goes through the EXISTING, session-scoped endpoints (ownership is enforced server-side):
 *   playlist PATCH/DELETE · /files (add, reorder) · /files/:id (remove) · /files/:id/transfer · /share · /api/files/:id (publish, settings).
 * The cover is DERIVED from the first ordered file's thumbnail; we only re-read the server's snapshot after changes.
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
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [working, setWorking] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const savingRef = useRef(false);
  const headingRef = useRef<HTMLElement>(null);
  const firstViewRender = useRef(true);

  const pid = playlistId;
  const authed = authStatus === "authenticated";
  // Inside Telegram the native Back Button is the back control; elsewhere (browser) the page shows its own.
  const insideTelegram = useSyncExternalStore(noopSubscribe, () => isRunningInsideTelegram(), () => false);

  // ── Navigation ─────────────────────────────────────────────────────────────
  const goToLibrary = useCallback(() => {
    setActiveTab("files");
    if (consumeFromLibraryFlag()) router.back();
    else router.replace("/");
  }, [router, setActiveTab]);

  /** Back: from a sub-screen → the playlist; from the playlist → the Library (the Creator's playlist list). */
  const handleBack = useCallback(() => {
    if (view.name !== "list") setView({ name: "list" });
    else goToLibrary();
  }, [view.name, goToLibrary]);

  useTelegramBackButton(handleBack);

  // Visitors / sessions without a verified creator account never see a dashboard page.
  useEffect(() => {
    if (authStatus === "guest" || authStatus === "setup_required" || channelStatus === "no_channel") router.replace("/");
  }, [authStatus, channelStatus, router]);

  // Keyboard: Escape leaves a sub-screen (dialogs and menus handle their own Escape first).
  const overlayOpen = confirm !== null || confirmDelete || shareOpen;
  useEffect(() => {
    if (view.name === "list" || overlayOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (e.target instanceof Element && e.target.closest('[role="menu"]')) return;
      setView({ name: "list" });
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [view.name, overlayOpen]);

  // Focus management: after switching screens, move focus to the new screen's heading.
  useEffect(() => {
    if (firstViewRender.current) {
      firstViewRender.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [view.name]);

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

  // Mouse needs a small move before a drag starts; touch needs a short press so normal scrolling still works.
  // Both listeners live on the drag HANDLE only, so tapping or scrolling anywhere else never starts a drag.
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

  const patchPlaylistState = (p: Partial<PlaylistSummary>) => {
    setPlaylist((cur) => (cur ? { ...cur, ...p } : cur));
    setAllPlaylists((cur) => cur.map((x) => (x.id === pid ? { ...x, ...p } : x)));
  };

  /**
   * Persists a new order through the existing PUT endpoint. Optimistic: the list shows the new order at once and is
   * rolled back (with a message) if the server refuses. Returns whether it was saved.
   */
  const persistOrder = async (next: MemberFile[], successMessage: string): Promise<boolean> => {
    if (savingRef.current) return false;
    const previous = files;
    setFiles(next);
    savingRef.current = true;
    setSaving(true);
    try {
      const res = await fetch(`/api/playlists/${pid}/files`, { method: "PUT", headers: JSON_HEADERS, body: JSON.stringify({ fileIds: next.map((f) => f.id) }) });
      const data = await readJson(res);
      if (!res.ok) {
        setFiles(previous);
        toast(String(data?.error ?? "Couldn't save the new order."), "error");
        if (res.status === 409) await loadFiles().catch(() => undefined); // someone else changed it — show the truth
        return false;
      }
      applySnapshot(data); // persisted order + refreshed cover (first file)
      toast(successMessage);
      return true;
    } catch {
      setFiles(previous);
      toast("Network error. The order wasn't saved.", "error");
      return false;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const handleDragEnd = async (e: DragEndEvent) => {
    setDragging(false);
    const { active, over } = e;
    if (!over || active.id === over.id || savingRef.current) return;
    const from = files.findIndex((f) => f.id === active.id);
    const to = files.findIndex((f) => f.id === over.id);
    if (from < 0 || to < 0) return;
    await persistOrder(arrayMove(files, from, to), "Order saved");
  };

  /** Cover = first file's thumbnail, so choosing a cover moves that file to the top (existing reorder endpoint). */
  const setCover = async (fileId: number) => {
    const next = moveToFront(files, fileId);
    if (next === files) return;
    await persistOrder(next, "Cover updated");
  };

  // ── File actions ───────────────────────────────────────────────────────────
  /**
   * Removes ONE file's membership from THIS playlist (DELETE /api/playlists/:id/files/:fileId). The file itself, its
   * Telegram post, thumbnail, own link and membership in other playlists are untouched (this route never touches
   * /api/files). The row disappears immediately; on failure the previous list, count and cover are restored.
   */
  const removeFile = async (f: MemberFile) => {
    if (busyFileId !== null || saving || savingRef.current) return;
    const prevFiles = files;
    const prevPlaylist = playlist;
    const next = files.filter((x) => x.id !== f.id);
    setBusyFileId(f.id);
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
      toast("Removed from this playlist. The original file is untouched.");
    } catch (e) {
      setFiles(prevFiles);
      setPlaylist(prevPlaylist);
      toast("Couldn't remove it from the playlist. Please try again.", "error");
      if ((e as { status?: number }).status === 404) void loadFiles().catch(() => undefined);
    } finally {
      setBusyFileId(null);
    }
  };

  /** Publish / unpublish ONE file with the existing PATCH. Nothing is deleted; the file's own access rules are unchanged. */
  const setFilePublished = async (f: MemberFile, published: boolean) => {
    if (busyFileId !== null || saving) return;
    setBusyFileId(f.id);
    try {
      const res = await fetch(`/api/files/${f.id}`, { method: "PATCH", headers: JSON_HEADERS, body: JSON.stringify({ isPublished: published }) });
      const data = await readJson(res);
      const row = data?.file as { isPublished?: boolean | null } | undefined;
      if (!res.ok || !row) throw new Error("failed");
      setFiles((cur) => cur.map((x) => (x.id === f.id ? { ...x, isPublished: !!row.isPublished } : x)));
      toast(published ? "File published" : "File unpublished. It isn't deleted — publish it again any time.");
    } catch {
      toast(published ? "Couldn't publish the file. Please try again." : "Couldn't unpublish the file. Please try again.", "error");
    } finally {
      setBusyFileId(null);
    }
  };

  // ── Playlist actions ───────────────────────────────────────────────────────
  const deletePlaylist = async () => {
    setWorking(true);
    try {
      const res = await fetch(`/api/playlists/${pid}`, { method: "DELETE" });
      if (!res.ok) throw new Error("failed");
      toast("Playlist deleted. Your Telegram files are untouched.");
      setConfirmDelete(false);
      consumeFromLibraryFlag();
      setActiveTab("files");
      router.replace("/"); // this page no longer exists — don't leave it in the history
    } catch {
      toast("Couldn't delete the playlist. Please try again.", "error");
    } finally {
      setWorking(false);
    }
  };

  const setVisibility = async (published: boolean) => {
    setWorking(true);
    try {
      const res = await fetch(`/api/playlists/${pid}`, { method: "PATCH", headers: JSON_HEADERS, body: JSON.stringify({ isPublished: published }) });
      const data = await readJson(res);
      if (!res.ok || !data?.playlist) throw new Error("failed");
      applySnapshot(data);
      toast(published ? "Playlist is now public" : "Playlist is now private. Its public link no longer works.");
      setConfirm(null);
    } catch {
      toast("Couldn't change the visibility. Please try again.", "error");
    } finally {
      setWorking(false);
    }
  };

  /**
   * Duplicates the playlist STRUCTURE only: a new playlist (existing create endpoint) whose members are references to the
   * same files (existing add endpoint). No Telegram file is copied. Password isn't copied (only a hash is stored).
   * If anything fails after the copy was created, the half-built copy is deleted again.
   */
  const duplicatePlaylist = async () => {
    if (!playlist) return;
    setWorking(true);
    try {
      const res = await fetch("/api/playlists", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ title: duplicateTitle(playlist.title), description: playlist.description ?? null, starsPrice: playlist.starsPrice ?? 0 }),
      });
      const data = await readJson(res);
      if (!res.ok || !data?.playlist) {
        toast(String(data?.error ?? "Couldn't duplicate the playlist. Please try again."), "error");
        return;
      }
      const created = data.playlist as PlaylistSummary;
      if (data.duplicate) {
        toast("A playlist with that name was created a moment ago — find it in your Library.", "info");
        setConfirm(null);
        return;
      }
      try {
        for (const ids of chunkIds(files.map((f) => f.id))) {
          const r = await fetch(`/api/playlists/${created.id}/files`, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ fileIds: ids }) });
          if (!r.ok) throw new Error("add failed");
        }
        if (!playlist.isPublished) {
          const r = await fetch(`/api/playlists/${created.id}`, { method: "PATCH", headers: JSON_HEADERS, body: JSON.stringify({ isPublished: false }) });
          if (!r.ok) throw new Error("visibility failed");
        }
      } catch {
        await fetch(`/api/playlists/${created.id}`, { method: "DELETE" }).catch(() => undefined);
        toast("Couldn't duplicate the playlist. Nothing was created.", "error");
        return;
      }
      toast(`Duplicated as “${created.title}”. Find it in your Library.`);
      setConfirm(null);
    } catch {
      toast("Network error. Please try again.", "error");
    } finally {
      setWorking(false);
    }
  };

  // ── Open / preview / share ─────────────────────────────────────────────────
  /**
   * Opens ONE file in the existing public file viewer (/f/<slug>), which keeps enforcing that file's own password / price.
   * When the playlist can be shared, the playlist context travels along (?list=…&i=…) so the viewer can show
   * "3 of 12" with Previous / Next / Back to playlist. If it can't (private / paid playlist), the file still opens plainly.
   */
  const openItem = async (f: MemberFile) => {
    if (!f.smartLinkSlug || !f.isPublished) {
      toast("This file isn't published yet, so it can't be previewed.", "info");
      return;
    }
    const position = files.filter(isOpenable).findIndex((x) => x.id === f.id) + 1;
    let token = playlist?.shareSlug ?? null;
    if (!token) {
      const r = await requestShareLink(pid);
      if (r.ok) {
        token = r.share.slug;
        setPlaylist((cur) => (cur ? { ...cur, shareSlug: token } : cur));
      }
    }
    router.push(token && position > 0 ? itemHref(f.smartLinkSlug, token, position) : `/f/${encodeURIComponent(f.smartLinkSlug)}`);
  };

  /**
   * Preview = the REAL public playlist page (/p/<token>), exactly as a visitor sees it (password / Stars / ad rules are
   * enforced there, not here). It never changes visibility: a private playlist has no public page, so we explain that and
   * offer the Share dialog instead of publishing it silently. Browser / Telegram Back returns to this page.
   */
  const previewPlaylist = async () => {
    if (!playlist || previewing) return;
    const block = previewBlock(playlist);
    if (block === "private") {
      toast("This playlist is private, so it has no public page to preview. Make it public to preview it.", "info");
      setShareOpen(true);
      return;
    }
    if (block === "paid") {
      toast("Playlists with a Stars price have no public page yet, so there's nothing to preview.", "info");
      return;
    }
    setPreviewing(true);
    try {
      const r = await requestShareLink(pid);
      if (!r.ok) {
        toast(r.message, "error");
        if (r.reason === "private") setShareOpen(true);
        return;
      }
      setPlaylist((cur) => (cur ? { ...cur, shareSlug: r.share.slug } : cur));
      router.push(r.share.path);
    } finally {
      setPreviewing(false);
    }
  };

  const locked = dragging || saving || busyFileId !== null || working;
  const memberIds = useMemo(() => new Set(files.map((f) => f.id)), [files]);
  const otherPlaylists = allPlaylists.filter((p) => p.id !== pid);
  const summary = useMemo(() => summariseFiles(files), [files]);

  const headerTitle =
    view.name === "edit" ? "Edit details"
    : view.name === "add" ? "Add files"
    : view.name === "monetization" ? "Monetization"
    : view.name === "fileSettings" ? "File settings"
    : view.name === "transfer" ? "Move to another playlist"
    : "";

  // ── Render ─────────────────────────────────────────────────────────────────
  const menuItems: ActionMenuItem[] = playlist
    ? [
        { key: "edit", label: "Edit details", icon: Pencil, onSelect: () => setView({ name: "edit" }) },
        playlist.isPublished
          ? { key: "visibility", label: "Make private", icon: EyeOff, onSelect: () => setConfirm({ kind: "private" }) }
          : { key: "visibility", label: "Make public", icon: Globe, onSelect: () => void setVisibility(true) },
        { key: "monetization", label: "Monetization settings", icon: CircleDollarSign, onSelect: () => setView({ name: "monetization" }) },
        { key: "share", label: "Share settings", icon: Share2, onSelect: () => setShareOpen(true) },
        { key: "duplicate", label: "Duplicate playlist", icon: Copy, separated: true, onSelect: () => setConfirm({ kind: "duplicate" }) },
        { key: "delete", label: "Delete playlist", icon: Trash2, destructive: true, onSelect: () => setConfirmDelete(true) },
      ]
    : [];

  const Heading = "h1" as const;
  const shell = (children: React.ReactNode) => (
    <div className="min-h-screen bg-app overflow-x-hidden" data-testid="playlist-page">
      <div className="max-w-2xl mx-auto w-full px-4 pt-[max(0.5rem,env(safe-area-inset-top))] pb-[calc(env(safe-area-inset-bottom)+2.5rem)]">
        {/* The playlist screen has no title bar: inside Telegram the native Back Button is the only back control
            (nothing to render); in a plain browser a compact back arrow sits above the cover. Sub-screens keep
            their own title (<h1>) with a spacer opposite the back control so it stays centred. */}
        {(view.name !== "list" || !insideTelegram) && (
          <header className={cn("flex items-center gap-1", view.name === "list" ? "min-h-11 mb-1" : "min-h-12 mb-3")}>
            {insideTelegram ? (
              <span className="w-11 flex-shrink-0" aria-hidden="true" />
            ) : (
              <button
                type="button"
                onClick={handleBack}
                aria-label={view.name === "list" ? "Back to your playlists" : "Back to playlist"}
                data-testid="page-back"
                className="w-11 h-11 -ml-2 flex-shrink-0 inline-flex items-center justify-center rounded-xl text-primary hover:bg-secondary focus-visible:outline-2 focus-visible:outline-[var(--color-primary)]"
              >
                <ChevronLeft size={22} aria-hidden="true" />
              </button>
            )}
            {view.name !== "list" && (
              <>
                <Heading ref={headingRef as never} tabIndex={-1} className="min-w-0 flex-1 text-center text-base font-semibold text-primary truncate outline-none" data-testid="playlist-header-title">
                  {headerTitle}
                </Heading>
                <span className="w-11 flex-shrink-0" aria-hidden="true" />
              </>
            )}
          </header>
        )}
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
        <p className="text-sm text-secondary mb-5">{loadError === "notfound" ? "It may have been deleted." : "Please check your connection and try again."}</p>
        <div className="flex items-center justify-center gap-2">
          {loadError !== "notfound" && (
            <button type="button" className="btn-primary min-h-11 text-sm px-5 py-2.5" onClick={() => void loadAll()}>Try again</button>
          )}
          <button type="button" className="btn-secondary min-h-11 text-sm px-5 py-2.5" onClick={goToLibrary}>Back to My Library</button>
        </div>
      </div>
    );
  }

  const count = files.length;
  const goCreate = () => {
    setActiveTab("create");
    consumeFromLibraryFlag();
    router.replace("/");
  };

  return shell(
    <>
      {view.name === "edit" && (
        <EditDetailsView
          playlist={playlist}
          files={files}
          coverBusy={locked}
          onSaved={(p) => {
            patchPlaylistState(p);
            setView({ name: "list" });
          }}
          onSetCover={(id) => void setCover(id)}
        />
      )}

      {view.name === "monetization" && (
        <SettingsForm
          kind="playlist"
          id={pid}
          initial={{ title: playlist.title, hasPassword: !!playlist.hasPassword, starsPrice: playlist.starsPrice ?? 0 }}
          onSaved={(r) => {
            patchPlaylistState({ hasPassword: r.hasPassword, starsPrice: r.starsPrice });
            setView({ name: "list" });
          }}
        />
      )}

      {view.name === "fileSettings" && (
        <SettingsForm
          key={view.file.id}
          kind="file"
          id={view.file.id}
          withTitle
          initial={{ title: view.file.title, hasPassword: !!view.file.hasPassword, starsPrice: view.file.starsPrice ?? 0 }}
          onSaved={(r) => {
            const id = view.file.id;
            setFiles((cur) => cur.map((x) => (x.id === id ? { ...x, title: r.title ?? x.title, hasPassword: r.hasPassword, starsPrice: r.starsPrice } : x)));
            setView({ name: "list" });
          }}
        />
      )}

      {view.name === "add" && (
        <AddFilesView
          playlistId={pid}
          memberIds={memberIds}
          onGoCreate={goCreate}
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
          initialMode={view.mode}
          onDone={async () => {
            setView({ name: "list" });
            await Promise.all([loadFiles(), loadPlaylists()]).catch(() => undefined); // count + derived cover may have changed
          }}
        />
      )}

      {view.name === "list" && (
        <div className="flex flex-col gap-5">
          <PlaylistHero
            playlist={playlist}
            summary={summary}
            menuItems={menuItems}
            disabled={locked}
            previewing={previewing}
            onAddFiles={() => setView({ name: "add" })}
            onPreview={() => void previewPlaylist()}
            onShare={() => setShareOpen(true)}
            onChangeCover={() => setView({ name: "edit" })}
          />

          <section aria-label="Playlist files">
            <div className="flex items-center justify-between gap-2 mb-1 min-h-6">
              <h2 className="text-base font-bold text-primary flex items-baseline gap-2">
                Files <span className="text-xs font-medium text-muted">{count}</span>
              </h2>
              <span role="status" aria-live="polite" className="text-xs text-secondary inline-flex items-center gap-1.5">
                {saving && (
                  <>
                    <Loader2 size={13} className="animate-spin" aria-hidden="true" /> Saving…
                  </>
                )}
              </span>
            </div>

            {count === 0 ? (
              <div className="text-center py-10 px-3 rounded-2xl border border-dashed border-app" data-testid="playlist-empty">
                <p className="text-sm font-semibold text-primary mb-1">This playlist is empty</p>
                <p className="text-sm text-secondary mb-4">Add files from your connected Telegram channel. The first file&apos;s thumbnail becomes the playlist cover.</p>
                <button type="button" onClick={() => setView({ name: "add" })} className="btn-primary min-h-11 px-5 py-2.5 text-sm inline-flex items-center gap-2">
                  <ListPlus size={16} aria-hidden="true" /> Add Files
                </button>
              </div>
            ) : (
              <>
                <p className="text-xs text-secondary mb-3" data-testid="playlist-hint">
                  Hold <GripVertical size={12} className="inline -mt-0.5" aria-hidden="true" /> and drag to reorder · use ⋮ for more actions.
                </p>
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  modifiers={[lockVertical]}
                  onDragStart={() => setDragging(true)}
                  onDragCancel={() => setDragging(false)}
                  onDragEnd={(e) => void handleDragEnd(e)}
                >
                  <SortableContext items={files.map((f) => f.id)} strategy={verticalListSortingStrategy}>
                    <ul className="flex flex-col gap-2" data-testid="playlist-files">
                      {files.map((f, index) => (
                        <ManageFileRow
                          key={f.id}
                          file={f}
                          index={index}
                          disabled={saving || busyFileId !== null || working}
                          busy={busyFileId === f.id}
                          actions={{
                            onPreview: () => void openItem(f),
                            onSettings: () => setView({ name: "fileSettings", file: f }),
                            onMove: () => setView({ name: "transfer", file: f, mode: "move" }),
                            onTogglePublish: () => (f.isPublished ? setConfirm({ kind: "unpublish", file: f }) : void setFilePublished(f, true)),
                            onSetCover: () => void setCover(f.id),
                            onRemove: () => setConfirm({ kind: "remove", file: f }),
                          }}
                        />
                      ))}
                    </ul>
                  </SortableContext>
                </DndContext>
              </>
            )}
          </section>
        </div>
      )}

      <ShareSheet
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        playlistId={pid}
        title={playlist.title}
        onPublishedChange={(published) => setPlaylist((cur) => (cur ? { ...cur, isPublished: published } : cur))}
      />

      <ConfirmDialog
        open={confirm?.kind === "remove"}
        title="Remove from playlist?"
        description={
          <>
            “{confirm?.kind === "remove" ? confirm.file.title : ""}” will be removed from this playlist only. The original file stays in your Telegram channel and Library, keeps its own link, and stays in any other playlist.
          </>
        }
        confirmLabel="Remove"
        destructive
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          const f = confirm?.kind === "remove" ? confirm.file : null;
          setConfirm(null);
          if (f) void removeFile(f);
        }}
      />

      <ConfirmDialog
        open={confirm?.kind === "unpublish"}
        title="Unpublish this file?"
        description={
          <>
            “{confirm?.kind === "unpublish" ? confirm.file.title : ""}” will stop being available to visitors everywhere — in every playlist and through its own link. It isn&apos;t deleted, and you can publish it again at any time.
          </>
        }
        confirmLabel="Unpublish"
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          const f = confirm?.kind === "unpublish" ? confirm.file : null;
          setConfirm(null);
          if (f) void setFilePublished(f, false);
        }}
      />

      <ConfirmDialog
        open={confirm?.kind === "private"}
        title="Make this playlist private?"
        description="Its public link stops working right away. If you make it public again, the same link works again."
        confirmLabel="Make private"
        busyLabel="Updating…"
        loading={working}
        onClose={() => setConfirm(null)}
        onConfirm={() => void setVisibility(false)}
      />

      <ConfirmDialog
        open={confirm?.kind === "duplicate"}
        title="Duplicate this playlist?"
        description={`A new playlist “${duplicateTitle(playlist.title)}” is created with the same ${count === 1 ? "file" : `${count} files`}, in the same order. Files aren't copied — both playlists reference the same Telegram files. The password isn't copied.`}
        confirmLabel="Duplicate"
        busyLabel="Duplicating…"
        loading={working}
        onClose={() => setConfirm(null)}
        onConfirm={() => void duplicatePlaylist()}
      />

      <DeleteConfirmModal
        open={confirmDelete}
        onClose={() => !working && setConfirmDelete(false)}
        onConfirm={() => void deletePlaylist()}
        loading={working}
        title="Delete playlist"
        description={`Delete “${playlist.title}”? Only the playlist is removed. Its ${count || playlist.totalFiles || 0} file(s) are NOT deleted — they stay in your Telegram channel, your Library and any other playlist.`}
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
      <div className="grid grid-cols-4 gap-2">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-[3.75rem] rounded-xl bg-card border border-app animate-pulse-brand" />
        ))}
      </div>
      {[1, 2, 3].map((i) => (
        <div key={i} className="h-16 rounded-xl bg-card border border-app animate-pulse-brand" />
      ))}
    </div>
  );
}
