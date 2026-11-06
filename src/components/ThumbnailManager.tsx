"use client";
import React, { useEffect, useRef, useState } from "react";
import { ImagePlus, Trash2, Loader2 } from "lucide-react";
import { cn, formatBytes } from "@/lib/utils";
import FileThumb from "@/components/ui/FileThumb";

const MAX_BYTES = 2 * 1024 * 1024;
const ACCEPT = "image/jpeg,image/png,image/webp";

interface Props {
  fileId: number;
  fileType: string;
  currentUrl?: string | null;
  onChanged: (thumb: { url: string | null; width: number | null; height: number | null }) => void;
  onToast: (message: string, type?: "success" | "error" | "warning" | "info") => void;
}

type Phase = "idle" | "uploading" | "processing" | "removing";

/** Client-side checks are a convenience only — the server re-validates the real image bytes. */
function precheck(file: File): string | null {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    return "Only JPEG, PNG or WebP images are allowed.";
  }
  if (file.size > MAX_BYTES) return `Image is ${formatBytes(file.size)}. Maximum is 2 MB.`;
  if (file.size === 0) return "The file is empty.";
  return null;
}

export default function ThumbnailManager({ fileId, fileType, currentUrl, onChanged, onToast }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!selected) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(selected);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [selected]);

  const busy = phase !== "idle";

  const pick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null;
    e.target.value = "";
    setError(null);
    if (!f) return;
    const problem = precheck(f);
    if (problem) {
      setSelected(null);
      setError(problem);
      return;
    }
    setSelected(f);
  };

  const upload = () => {
    if (!selected || busy) return;
    setError(null);
    setPhase("uploading");
    setProgress(0);

    const form = new FormData();
    form.append("file", selected);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/files/${fileId}/thumbnail`);
    xhr.responseType = "json";
    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable) setProgress(Math.round((ev.loaded / ev.total) * 100));
    };
    xhr.upload.onload = () => {
      setProgress(100);
      setPhase("processing"); // server is now optimizing + storing
    };
    xhr.onerror = () => {
      setPhase("idle");
      setError("Network error. Please check your connection and try again.");
    };
    xhr.ontimeout = xhr.onerror;
    xhr.timeout = 60_000;
    xhr.onload = () => {
      setPhase("idle");
      const data = xhr.response as { thumbnail?: { url: string | null; width: number; height: number }; error?: string } | null;
      if (xhr.status >= 200 && xhr.status < 300 && data?.thumbnail) {
        onChanged({ url: data.thumbnail.url, width: data.thumbnail.width, height: data.thumbnail.height });
        setSelected(null);
        onToast("Thumbnail saved", "success");
      } else {
        setError(data?.error || "Upload failed. Please try again.");
      }
    };
    xhr.send(form);
  };

  const remove = async () => {
    if (busy) return;
    setError(null);
    setPhase("removing");
    try {
      const res = await fetch(`/api/files/${fileId}/thumbnail`, { method: "DELETE" });
      if (res.ok) {
        onChanged({ url: null, width: null, height: null });
        setSelected(null);
        onToast("Thumbnail removed", "success");
      } else {
        const data = await res.json().catch(() => null);
        setError(data?.error || "Could not remove the thumbnail.");
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setPhase("idle");
    }
  };

  const shown = previewUrl ?? currentUrl ?? null;

  return (
    <div className="flex flex-col gap-4">
      <div className="relative w-full overflow-hidden rounded-2xl bg-secondary flex items-center justify-center text-5xl" style={{ aspectRatio: "16 / 9" }}>
        {previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- local blob preview
          <img src={previewUrl} alt="Selected thumbnail preview" className="absolute inset-0 w-full h-full object-cover" />
        ) : (
          <FileThumb url={shown} fileType={fileType} alt="Current thumbnail" eager />
        )}
      </div>

      {selected && (
        <p className="text-xs text-secondary">
          {selected.name} · {formatBytes(selected.size)} — it will be optimized (resized to max 1280px, metadata removed) before saving.
        </p>
      )}

      {phase === "uploading" || phase === "processing" ? (
        <div>
          <div className="h-2 rounded-full bg-secondary overflow-hidden" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full gradient-brand transition-all" style={{ width: `${progress}%` }} />
          </div>
          <p className="text-xs text-secondary mt-1.5 flex items-center gap-1.5">
            <Loader2 size={12} className="animate-spin" />
            {phase === "uploading" ? `Uploading… ${progress}%` : "Optimizing and saving…"}
          </p>
        </div>
      ) : null}

      {error && (
        <p role="alert" className="text-xs text-red-500 bg-red-50 dark:bg-red-900/20 rounded-xl px-3 py-2">
          {error}
        </p>
      )}

      <input ref={inputRef} type="file" accept={ACCEPT} className="hidden" onChange={pick} />

      <div className="flex flex-col gap-2">
        {selected ? (
          <button onClick={upload} disabled={busy} className={cn("btn-primary w-full py-3 text-sm flex items-center justify-center gap-2", busy && "opacity-60")}>
            <ImagePlus size={15} />
            {currentUrl ? "Replace thumbnail" : "Upload thumbnail"}
          </button>
        ) : (
          <button onClick={() => inputRef.current?.click()} disabled={busy} className={cn("btn-primary w-full py-3 text-sm flex items-center justify-center gap-2", busy && "opacity-60")}>
            <ImagePlus size={15} />
            {currentUrl ? "Choose a new image" : "Choose an image"}
          </button>
        )}
        {selected && !busy && (
          <button onClick={() => { setSelected(null); setError(null); }} className="w-full py-2.5 text-sm text-secondary">
            Cancel
          </button>
        )}
        {currentUrl && !selected && (
          <button onClick={remove} disabled={busy} className={cn("w-full py-2.5 text-sm text-red-500 flex items-center justify-center gap-2", busy && "opacity-60")}>
            {phase === "removing" ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
            Remove thumbnail
          </button>
        )}
      </div>
      <p className="text-[11px] text-muted text-center">JPEG, PNG or WebP · up to 2 MB</p>
    </div>
  );
}
