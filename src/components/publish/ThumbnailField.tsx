"use client";
import React, { useRef, useState } from "react";
import { AlertCircle, ImagePlus, Loader2, RefreshCw, Trash2 } from "lucide-react";
import { THUMBNAIL_MAX_BYTES } from "@/lib/publishing/constants";
import {
  validateThumbnailFile,
  type StagedThumbnail,
  type ThumbnailStorageService,
} from "@/lib/publishing/thumbnailStorage";

/**
 * Thumbnail picker for the Post Details step. It knows nothing about any
 * concrete storage provider: every upload/remove goes through the injected
 * `ThumbnailStorageService`. While the service reports `available: false` the
 * control is disabled and says so — it never fakes a successful upload.
 */
export default function ThumbnailField({
  value,
  onChange,
  service,
}: {
  value: StagedThumbnail | null;
  onChange: (next: StagedThumbnail | null) => void;
  service: ThumbnailStorageService;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<"uploading" | "removing" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    const problem = validateThumbnailFile(file);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy("uploading");
    try {
      const staged = await service.upload(file);
      const previous = value;
      onChange(staged);
      if (previous) void service.remove(previous.ref).catch(() => undefined);
    } catch {
      setError("The thumbnail couldn't be uploaded. Please try again.");
    } finally {
      setBusy(null);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const handleRemove = async () => {
    if (!value) return;
    setError(null);
    setBusy("removing");
    try {
      await service.remove(value.ref);
      onChange(null);
    } catch {
      setError("The thumbnail couldn't be removed. Please try again.");
    } finally {
      setBusy(null);
    }
  };

  const disabled = !service.available || busy !== null;

  return (
    <div className="flex flex-col gap-2">
      <span id="thumb-label" className="text-xs font-semibold text-secondary">
        Thumbnail <span className="font-normal text-muted">(optional)</span>
      </span>

      <div className="flex items-center gap-3">
        <div
          className="relative w-28 aspect-video rounded-xl overflow-hidden bg-secondary border border-app flex items-center justify-center flex-shrink-0"
          aria-labelledby="thumb-label"
        >
          {value ? (
            // eslint-disable-next-line @next/next/no-img-element -- staged preview from the storage service
            <img src={value.previewUrl} alt="Selected thumbnail preview" className="absolute inset-0 w-full h-full object-cover" />
          ) : (
            <ImagePlus size={22} className="text-muted" aria-hidden="true" />
          )}
          {busy === "uploading" && (
            <div className="absolute inset-0 bg-black/50 flex items-center justify-center" role="status" aria-label="Uploading thumbnail">
              <Loader2 size={20} className="text-white animate-spin" />
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2 min-w-0">
          <input
            ref={inputRef}
            id="thumb-input"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            disabled={disabled}
            onChange={(e) => void handleFile(e.target.files?.[0])}
          />
          <label
            htmlFor="thumb-input"
            aria-disabled={disabled}
            className={`btn-secondary !px-4 !py-2.5 min-h-11 text-sm font-semibold inline-flex items-center justify-center gap-2 ${
              disabled ? "opacity-50 pointer-events-none" : "cursor-pointer"
            }`}
          >
            {value ? <RefreshCw size={15} /> : <ImagePlus size={15} />}
            {busy === "uploading" ? "Uploading…" : value ? "Replace Thumbnail" : "Upload Thumbnail"}
          </label>
          {value && (
            <button
              type="button"
              onClick={() => void handleRemove()}
              disabled={busy !== null}
              className="text-xs font-semibold text-red-500 min-h-11 inline-flex items-center justify-center gap-1.5 disabled:opacity-50"
            >
              <Trash2 size={14} />
              {busy === "removing" ? "Removing…" : "Remove Thumbnail"}
            </button>
          )}
        </div>
      </div>

      <p className="text-xs text-muted">
        JPEG, PNG or WebP · up to {Math.round(THUMBNAIL_MAX_BYTES / (1024 * 1024))} MB. Without one, a default thumbnail is
        used.
      </p>

      {!service.available && service.unavailableMessage && (
        <p className="text-xs text-secondary rounded-lg bg-secondary px-3 py-2" role="note">
          {service.unavailableMessage}
        </p>
      )}
      {error && (
        <p role="alert" className="text-xs text-red-500 flex items-start gap-1.5">
          <AlertCircle size={13} className="mt-0.5 flex-shrink-0" />
          {error}
        </p>
      )}
    </div>
  );
}
