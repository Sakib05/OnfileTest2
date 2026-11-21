"use client";
import React, { useEffect, useRef, useState } from "react";
import { ImagePlus, Trash2, Loader2, Undo2 } from "lucide-react";
import { cn, formatBytes } from "@/lib/utils";
import FileThumb from "@/components/ui/FileThumb";
import { THUMBNAIL_MAX_LABEL } from "@/lib/thumbnails/limits";
import { THUMBNAIL_ACCEPT, precheckThumbnail } from "@/lib/thumbnails/clientUpload";

interface Props {
  fileType: string;
  fileTitle?: string;
  /** The thumbnail currently stored for the file (null → default artwork). */
  currentUrl?: string | null;
  /** The replacement image the creator picked but has NOT saved yet. */
  selected: File | null;
  /** The creator chose "Remove thumbnail" (applied on Save). */
  removed: boolean;
  onSelect: (file: File | null) => void;
  onRemovedChange: (removed: boolean) => void;
  /** Disables every control while the parent is saving. */
  disabled?: boolean;
  /** Upload progress shown while the parent saves: `null` when idle. */
  progress?: { phase: "uploading" | "processing"; pct: number } | null;
  /** Error from the parent's save attempt (e.g. the upload failed). */
  error?: string | null;
}

/**
 * Thumbnail picker used inside Library ⋮ → Edit Details. It is a STAGED control: choosing an image only shows a local
 * preview; nothing is uploaded until the creator presses "Save changes" (the parent then calls the existing
 * POST/DELETE /api/files/:id/thumbnail endpoints via `lib/thumbnails/clientUpload`). Cancelling discards the choice.
 */
export default function ThumbnailManager({ fileType, fileTitle, currentUrl, selected, removed, onSelect, onRemovedChange, disabled, progress, error }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);

  useEffect(() => {
    if (!selected) {
      // Clears the preview when the staged file goes away (network-free local state sync).
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(selected);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [selected]);

  const pick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null;
    e.target.value = "";
    setPickError(null);
    if (!f) return;
    const problem = precheckThumbnail(f);
    if (problem) {
      setPickError(problem);
      return;
    }
    onRemovedChange(false);
    onSelect(f);
  };

  const shownUrl = removed ? null : currentUrl ?? null;
  const hasCustom = !!currentUrl && !removed;
  const shownError = pickError ?? error ?? null;

  return (
    <div className="flex flex-col gap-3" data-testid="thumbnail-editor">
      <div className="relative w-full max-w-sm mx-auto overflow-hidden rounded-2xl bg-secondary flex items-center justify-center text-5xl" style={{ aspectRatio: "16 / 9" }}>
        {previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- local blob preview
          <img src={previewUrl} alt="Selected thumbnail preview" className="absolute inset-0 w-full h-full object-cover" />
        ) : (
          <FileThumb url={shownUrl} fileType={fileType} title={fileTitle} alt="Current thumbnail" eager />
        )}
      </div>

      {selected && (
        <p className="text-xs text-secondary" data-testid="thumbnail-selected-note">
          {selected.name} · {formatBytes(selected.size)} — it will be optimized (resized to max 1280px, metadata removed) and saved when you press “Save changes”.
        </p>
      )}
      {removed && !selected && (
        <p className="text-xs text-secondary" data-testid="thumbnail-removed-note">The custom thumbnail will be removed when you press “Save changes”; the default artwork is used instead.</p>
      )}

      {progress && (
        <div>
          <div className="h-2 rounded-full bg-secondary overflow-hidden" role="progressbar" aria-valuenow={progress.pct} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full gradient-brand transition-all" style={{ width: `${progress.pct}%` }} />
          </div>
          <p className="text-xs text-secondary mt-1.5 flex items-center gap-1.5">
            <Loader2 size={12} className="animate-spin" aria-hidden="true" />
            {progress.phase === "uploading" ? `Uploading thumbnail… ${progress.pct}%` : "Optimizing and saving thumbnail…"}
          </p>
        </div>
      )}

      {shownError && (
        <p role="alert" className="text-xs text-red-500 bg-red-50 dark:bg-red-900/20 rounded-xl px-3 py-2" data-testid="thumbnail-error">
          {shownError}
        </p>
      )}

      <input ref={inputRef} type="file" accept={THUMBNAIL_ACCEPT} className="hidden" onChange={pick} data-testid="thumbnail-input" />

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={disabled}
          className={cn("btn-secondary min-h-11 px-4 text-sm font-medium flex items-center justify-center gap-2 flex-1", disabled && "opacity-60")}
        >
          <ImagePlus size={15} aria-hidden="true" />
          {selected ? "Choose a different image" : hasCustom ? "Replace thumbnail" : "Choose thumbnail"}
        </button>
        {selected && (
          <button
            type="button"
            onClick={() => {
              onSelect(null);
              setPickError(null);
            }}
            disabled={disabled}
            className="min-h-11 px-4 text-sm text-secondary flex items-center justify-center gap-2 disabled:opacity-60"
          >
            <Undo2 size={14} aria-hidden="true" /> Discard choice
          </button>
        )}
        {!selected && hasCustom && (
          <button
            type="button"
            onClick={() => onRemovedChange(true)}
            disabled={disabled}
            className="min-h-11 px-4 text-sm text-red-500 flex items-center justify-center gap-2 disabled:opacity-60"
          >
            <Trash2 size={14} aria-hidden="true" /> Remove thumbnail
          </button>
        )}
        {!selected && removed && (
          <button type="button" onClick={() => onRemovedChange(false)} disabled={disabled} className="min-h-11 px-4 text-sm text-secondary flex items-center justify-center gap-2 disabled:opacity-60">
            <Undo2 size={14} aria-hidden="true" /> Keep current thumbnail
          </button>
        )}
      </div>
      <p className="text-[11px] text-muted">JPEG, PNG or WebP · Maximum {THUMBNAIL_MAX_LABEL}</p>
    </div>
  );
}
