"use client";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { ImagePlus, Trash2, Upload, RefreshCw } from "lucide-react";
import { cn, formatBytes } from "@/lib/utils";
import { useToast } from "@/components/ui/Toast";
import FileThumb from "@/components/ui/FileThumb";

const MAX_BYTES = 2 * 1024 * 1024;
const ACCEPTED = ["image/jpeg", "image/png", "image/webp"];

interface Props {
  fileId: number;
  fileType: string;
  hasThumbnail: boolean;
  /** Cache-busting token for the current thumbnail. */
  version?: string | null;
  onChanged: () => void;
  onClose: () => void;
}

/**
 * Creator thumbnail manager: pick from the gallery, preview, upload with
 * progress, replace or remove. Validation here is only a UX convenience —
 * the server re-validates everything.
 */
export default function ThumbnailEditor({ fileId, fileType, hasThumbnail, version, onChanged, onClose }: Props) {
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const pick = (file: File | undefined) => {
    setError(null);
    if (!file) return;
    if (!ACCEPTED.includes(file.type)) {
      setError("Unsupported image type. Please choose a JPEG, PNG or WebP image.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError(`That image is ${formatBytes(file.size)}. The maximum size is 2 MB.`);
      return;
    }
    setSelected(file);
    setPreviewUrl(URL.createObjectURL(file));
  };

  const upload = useCallback(() => {
    if (!selected) return;
    setError(null);
    setProgress(0);
    const form = new FormData();
    form.append("file", selected);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/files/${fileId}/thumbnail`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      setProgress(null);
      if (xhr.status >= 200 && xhr.status < 300) {
        toast(hasThumbnail ? "Thumbnail replaced" : "Thumbnail saved");
        onChanged();
        onClose();
        return;
      }
      let message = "Upload failed. Please try again.";
      try {
        message = JSON.parse(xhr.responseText).error || message;
      } catch {
        /* keep default */
      }
      setError(message);
      toast(message, "error");
    };
    xhr.onerror = () => {
      setProgress(null);
      setError("Network error. Please check your connection and retry.");
      toast("Network error. Please retry.", "error");
    };
    xhr.send(form);
  }, [selected, fileId, hasThumbnail, onChanged, onClose, toast]);

  const remove = async () => {
    setRemoving(true);
    try {
      const res = await fetch(`/api/files/${fileId}/thumbnail`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      toast("Thumbnail removed");
      onChanged();
      onClose();
    } catch {
      toast("Could not remove the thumbnail. Please try again.", "error");
    } finally {
      setRemoving(false);
      setConfirmRemove(false);
    }
  };

  const uploading = progress !== null;
  const currentSrc = hasThumbnail ? `/api/files/${fileId}/thumbnail${version ? `?v=${encodeURIComponent(version)}` : ""}` : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="w-full aspect-video rounded-2xl bg-secondary border border-app overflow-hidden flex items-center justify-center text-5xl">
        {previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={previewUrl} alt="Thumbnail preview" className="w-full h-full object-cover" />
        ) : (
          <FileThumb src={currentSrc} fileType={fileType} />
        )}
      </div>

      <p className="text-xs text-secondary">
        JPEG, PNG or WebP up to 2 MB. Images are resized to 1280&nbsp;px, optimised and stripped of location/EXIF data. Only the thumbnail is stored — never your file.
      </p>

      <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ""; }} />

      {uploading && (
        <div>
          <div className="h-2 rounded-full bg-secondary overflow-hidden">
            <div className="h-full gradient-brand transition-all" style={{ width: `${progress}%` }} />
          </div>
          <p className="text-xs text-secondary mt-1">{progress === 100 ? "Optimising & saving…" : `Uploading ${progress}%`}</p>
        </div>
      )}

      {error && <p className="text-sm text-red-500" role="alert">{error}</p>}

      <div className="flex flex-col gap-2">
        {selected ? (
          <>
            <button onClick={upload} disabled={uploading} className={cn("btn-primary w-full py-3 text-sm flex items-center justify-center gap-2", uploading && "opacity-60")}>
              <Upload size={15} /> {hasThumbnail ? "Replace thumbnail" : "Save thumbnail"}
            </button>
            <button onClick={() => { setSelected(null); setPreviewUrl(null); }} disabled={uploading} className="btn-secondary w-full py-2.5 text-sm">
              Choose a different image
            </button>
          </>
        ) : (
          <button onClick={() => inputRef.current?.click()} className="btn-primary w-full py-3 text-sm flex items-center justify-center gap-2">
            {hasThumbnail ? <RefreshCw size={15} /> : <ImagePlus size={15} />} {hasThumbnail ? "Replace from gallery" : "Choose from gallery"}
          </button>
        )}

        {hasThumbnail && !selected && (
          confirmRemove ? (
            <div className="flex gap-2">
              <button onClick={remove} disabled={removing} className="flex-1 py-2.5 text-sm rounded-xl bg-red-500 text-white font-semibold">
                {removing ? "Removing…" : "Yes, remove"}
              </button>
              <button onClick={() => setConfirmRemove(false)} className="flex-1 btn-secondary py-2.5 text-sm">Cancel</button>
            </div>
          ) : (
            <button onClick={() => setConfirmRemove(true)} className="w-full py-2.5 text-sm rounded-xl text-red-500 bg-secondary font-semibold flex items-center justify-center gap-2">
              <Trash2 size={14} /> Remove thumbnail
            </button>
          )
        )}
      </div>
    </div>
  );
}
