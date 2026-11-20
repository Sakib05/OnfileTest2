"use client";
import React from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ArrowRightLeft, Eye, EyeOff, GripVertical, ImageIcon, Loader2, Lock, Settings2, Star, Trash2, Upload } from "lucide-react";
import ActionMenu, { type ActionMenuItem } from "@/components/ui/ActionMenu";
import FileThumb from "@/components/ui/FileThumb";
import { cn, formatBytes } from "@/lib/utils";
import { fileKindLabel } from "@/lib/fileKinds";
import { isOpenable, type MemberFile } from "./types";

export interface FileRowActions {
  onPreview: () => void;
  onSettings: () => void;
  onMove: () => void;
  onTogglePublish: () => void;
  onSetCover: () => void;
  onRemove: () => void;
}

/**
 * One sortable file row. The drag handle is the ONLY element that starts a reorder; destructive actions
 * live in the ⋮ menu and always go through a confirmation, so nothing can be removed by a stray drag or tap.
 */
export default function ManageFileRow({
  file,
  index,
  disabled,
  busy,
  actions,
}: {
  file: MemberFile;
  index: number;
  /** Reordering and menus are paused while another change is in flight. */
  disabled: boolean;
  /** This row has a request in flight. */
  busy: boolean;
  actions: FileRowActions;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: file.id, disabled });
  const style: React.CSSProperties = { transform: CSS.Transform.toString(transform), transition, zIndex: isDragging ? 20 : undefined, position: "relative" };
  const published = isOpenable(file);

  const items: ActionMenuItem[] = [
    { key: "preview", label: "Preview", icon: Eye, onSelect: actions.onPreview, disabled: !published },
    { key: "settings", label: "File settings", icon: Settings2, onSelect: actions.onSettings },
    { key: "move", label: "Move to another playlist", icon: ArrowRightLeft, onSelect: actions.onMove },
    { key: "publish", label: file.isPublished ? "Unpublish" : "Publish", icon: file.isPublished ? EyeOff : Upload, onSelect: actions.onTogglePublish },
    ...(index > 0 ? [{ key: "cover", label: "Use as playlist cover", icon: ImageIcon, onSelect: actions.onSetCover }] : []),
    { key: "remove", label: "Remove from playlist", icon: Trash2, destructive: true, onSelect: actions.onRemove },
  ];

  return (
    <li
      ref={setNodeRef}
      style={style}
      data-testid="playlist-file-row"
      data-file-id={file.id}
      className={cn("rounded-xl border border-app bg-card", isDragging && "shadow-app-lg ring-2 ring-brand opacity-95", busy && "opacity-60")}
      aria-busy={busy || undefined}
    >
      <div className="flex items-center gap-1 p-2 pr-1">
        <button
          type="button"
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          disabled={disabled}
          aria-label={`Reorder ${file.title}`}
          data-testid="drag-handle"
          style={{ touchAction: "none" }}
          className="w-8 h-11 flex-shrink-0 flex items-center justify-center rounded-lg text-muted cursor-grab active:cursor-grabbing disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-[var(--color-primary)]"
        >
          <GripVertical size={18} aria-hidden="true" />
        </button>

        <button
          type="button"
          onClick={actions.onPreview}
          disabled={disabled}
          aria-label={published ? `Preview ${file.title}` : `${file.title} (not published)`}
          data-testid="playlist-file-open"
          className="min-w-0 flex-1 flex items-center gap-2.5 self-stretch text-left disabled:opacity-60 rounded-lg focus-visible:outline-2 focus-visible:outline-[var(--color-primary)]"
        >
          <span className="w-20 sm:w-24 aspect-video rounded-lg bg-secondary relative overflow-hidden flex-shrink-0 border border-app">
            <FileThumb url={file.thumbnailUrl} fileType={file.fileType} title={file.title} mimeType={file.mimeType} />
          </span>
          <span className="min-w-0 flex-1 block">
            <span className="block text-sm font-semibold text-primary line-clamp-2 leading-snug break-words" data-testid="file-title">{file.title}</span>
            <span className="mt-0.5 text-xs text-secondary flex items-center gap-x-1.5 gap-y-1 flex-wrap">
              <span>{fileKindLabel(file)}</span>
              {file.fileSize ? <span aria-label="File size">· {formatBytes(file.fileSize)}</span> : null}
            </span>
            <span className="mt-1 flex items-center gap-1 flex-wrap">
              {published ? (
                <span className="chip status-completed !py-0.5 !px-2 !text-[11px]" data-testid="file-published">Published</span>
              ) : (
                <span className="chip bg-secondary text-secondary !py-0.5 !px-2 !text-[11px]" data-testid="file-unpublished">Not published</span>
              )}
              {index === 0 && <span className="chip bg-brand-10 text-brand !py-0.5 !px-2 !text-[11px]" title="The first file's thumbnail is the playlist cover">Cover</span>}
              {file.hasPassword && (
                <span className="chip bg-secondary text-secondary !py-0.5 !px-2 !text-[11px]" aria-label="Password protected"><Lock size={10} aria-hidden="true" /></span>
              )}
              {(file.starsPrice ?? 0) > 0 && (
                <span className="chip bg-secondary text-secondary !py-0.5 !px-2 !text-[11px]"><Star size={10} aria-hidden="true" /> {file.starsPrice}</span>
              )}
            </span>
          </span>
        </button>

        {busy ? (
          <span className="w-11 h-11 flex items-center justify-center flex-shrink-0" role="status" aria-label="Working">
            <Loader2 size={16} className="animate-spin text-secondary" aria-hidden="true" />
          </span>
        ) : (
          <ActionMenu
            label={`Actions for ${file.title}`}
            items={items}
            disabled={disabled}
            className="flex-shrink-0"
            triggerClassName="w-11 h-11 inline-flex items-center justify-center rounded-lg text-secondary hover:bg-secondary disabled:opacity-60"
          />
        )}
      </div>
    </li>
  );
}
