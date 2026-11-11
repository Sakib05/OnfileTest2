"use client";
import React, { useEffect, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, ImagePlus, Loader2, RefreshCw, RotateCcw, Trash2 } from "lucide-react";
import { THUMBNAIL_MAX_LABEL } from "@/lib/publishing/constants";
import {
  validateThumbnailFile,
  type StagedThumbnail,
  type ThumbnailStorageService,
} from "@/lib/publishing/thumbnailStorage";

type Phase = "idle" | "uploading" | "processing" | "removing";

/**
 * Thumbnail picker for the Post Details step. It knows nothing about any
 * concrete storage provider: every upload/remove goes through the injected
 * `ThumbnailStorageService`. A chosen image is previewed immediately (local
 * preview only while uploading), uploaded with progress, and only counts as the
 * post's thumbnail once the service confirms it is stored. A failed upload keeps
 * the chosen file so the creator can retry without re-picking it.
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
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [pending, setPending] = useState<File | null>(null); // file chosen but not (yet) stored
  const [localPreview, setLocalPreview] = useState<string | null>(null);
  const [imgBroken, setImgBroken] = useState(false);
  const busy = phase !== "idle";

  // Local preview of the chosen file; revoked as soon as it's no longer needed.
  useEffect(() => {
    if (!pending) {
      setLocalPreview(null);
      return;
    }
    const url = URL.createObjectURL(pending);
    setLocalPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [pending]);

  const upload = async (file: File) => {
    setError(null);
    setSuccess(false);
    setProgress(0);
    setPhase("uploading");
    try {
      const staged = await service.upload(file, {
        onProgress: setProgress,
        onProcessing: () => setPhase("processing"),
      });
      const previous = value;
      setImgBroken(false);
      onChange(staged);
      setPending(null);
      setSuccess(true);
      if (previous && previous.ref !== staged.ref) void service.remove(previous.ref).catch(() => undefined);
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : "The thumbnail couldn't be uploaded. Please try again.");
    } finally {
      setPhase("idle");
    }
  };

  const handleFile = (file: File | undefined) => {
    if (!file) return;
    setSuccess(false);
    const problem = validateThumbnailFile(file);
    if (problem) {
      setPending(null);
      setError(problem);
      return;
    }
    setPending(file);
    void upload(file);
  };

  const handleRemove = async () => {
    setError(null);
    setSuccess(false);
    // Discarding a failed/never-stored pick needs no server call.
    if (!value) {
      setPending(null);
      return;
    }
    setPhase("removing");
    try {
      await service.remove(value.ref);
      onChange(null);
      setPending(null);
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : "The thumbnail couldn't be removed. Please try again.");
    } finally {
      setPhase("idle");
    }
  };

  const disabled = !service.available || busy;
  const shown = localPreview ?? (value && !imgBroken ? value.previewUrl : null);
  const hasThumb = !!value || !!pending;

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
          {shown ? (
            // eslint-disable-next-line @next/next/no-img-element -- remote storage URL or local preview
            <img
              src={shown}
              alt="Selected thumbnail preview"
              className="absolute inset-0 w-full h-full object-cover"
              onError={() => {
                if (!localPreview) setImgBroken(true);
              }}
            />
          ) : (
            <ImagePlus size={22} className="text-muted" aria-hidden="true" />
          )}
          {busy && phase !== "removing" && (
            <div className="absolute inset-0 bg-black/55 flex flex-col items-center justify-center gap-1" role="status" aria-label="Uploading thumbnail">
              <Loader2 size={18} className="text-white animate-spin" />
              <span className="text-[10px] font-semibold text-white tabular-nums">
                {phase === "uploading" ? `${progress}%` : "Saving…"}
              </span>
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
            onChange={(e) => {
              handleFile(e.target.files?.[0]);
              e.target.value = ""; // allow re-picking the same file
            }}
          />
          <label
            htmlFor="thumb-input"
            aria-disabled={disabled}
            className={`btn-secondary !px-4 !py-2.5 min-h-11 text-sm font-semibold inline-flex items-center justify-center gap-2 ${
              disabled ? "opacity-50 pointer-events-none" : "cursor-pointer"
            }`}
          >
            {value ? <RefreshCw size={15} /> : <ImagePlus size={15} />}
            {phase === "uploading" ? "Uploading…" : phase === "processing" ? "Saving…" : value ? "Replace Thumbnail" : "Upload Thumbnail"}
          </label>

          {pending && !busy && error && (
            <button
              type="button"
              onClick={() => void upload(pending)}
              className="btn-primary !px-4 !py-2.5 min-h-11 text-sm font-semibold inline-flex items-center justify-center gap-2"
            >
              <RotateCcw size={15} />
              Retry upload
            </button>
          )}

          {hasThumb && (
            <button
              type="button"
              onClick={() => void handleRemove()}
              disabled={busy}
              className="text-xs font-semibold text-red-500 min-h-11 inline-flex items-center justify-center gap-1.5 disabled:opacity-50"
            >
              <Trash2 size={14} />
              {phase === "removing" ? "Removing…" : value ? "Remove Thumbnail" : "Cancel"}
            </button>
          )}
        </div>
      </div>

      {busy && phase !== "removing" && (
        <div className="h-1.5 rounded-full bg-secondary overflow-hidden" aria-hidden="true">
          <div
            className="h-full bg-brand transition-all duration-200"
            style={{ width: `${phase === "processing" ? 100 : progress}%` }}
          />
        </div>
      )}

      <p className="text-xs text-muted">
        JPEG, PNG or WebP · Maximum {THUMBNAIL_MAX_LABEL}. Without one, a default thumbnail is
        used.
      </p>

      {!service.available && service.unavailableMessage && (
        <p className="text-xs text-secondary rounded-lg bg-secondary px-3 py-2" role="note">
          {service.unavailableMessage}
        </p>
      )}
      {success && !error && value && (
        <p role="status" className="text-xs text-green-600 flex items-center gap-1.5">
          <CheckCircle2 size={13} className="flex-shrink-0" />
          Thumbnail uploaded. It will be attached when you publish.
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
