"use client";
import React, { useEffect, useState } from "react";
import { Eye, Download } from "lucide-react";
import Modal from "@/components/ui/Modal";
import FileThumb from "@/components/ui/FileThumb";
import { cn, formatBytes, formatNumber } from "@/lib/utils";
import { fileKindLabel } from "@/lib/fileKinds";
import { parseTimestamp } from "@/lib/relativeTime";
import type { FileItem } from "@/components/library/types";
import type { PlaylistMembershipRow } from "./ManagePlaylistsDialog";

const CATEGORY_LABEL: Record<string, string> = { video: "Video", audio: "Audio", document: "Document", image: "Image", archive: "Archive", other: "Other" };

function formatDate(value: string | null | undefined): string | null {
  const t = parseTimestamp(value ?? null);
  if (t === null) return null;
  return new Date(t).toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** Rows shown in File Details, derived ONLY from stored values (nothing is invented; unknown values are omitted or labelled). */
export function buildDetailRows(file: FileItem): { label: string; value: string }[] {
  const category = CATEGORY_LABEL[(file.fileType || "other").toLowerCase()] ?? "Other";
  const format = fileKindLabel(file);
  const rows: { label: string; value: string }[] = [
    { label: "Category", value: category },
  ];
  if (format !== category && format !== "File") rows.push({ label: "Format", value: format });
  rows.push({ label: "Size", value: file.fileSize ? formatBytes(file.fileSize) : "Not recorded" });
  const uploaded = formatDate(file.createdAt);
  if (uploaded) rows.push({ label: "Uploaded", value: uploaded });
  const updated = formatDate(file.updatedAt);
  if (updated && updated !== uploaded) rows.push({ label: "Last edited", value: updated });
  rows.push({ label: "Status", value: file.isPublished ? "Published" : "Private (not published)" });
  const protectedByPassword = file.hasPassword ?? !!file.password;
  const price = file.starsPrice ?? 0;
  rows.push({ label: "Access", value: [protectedByPassword ? "Password protected" : null, price > 0 ? `${price} Stars` : null].filter(Boolean).join(" · ") || "Free, no password" });
  rows.push({
    label: "Thumbnail",
    value: file.thumbnailUrl ? (file.thumbnailWidth && file.thumbnailHeight ? `Custom · ${file.thumbnailWidth}×${file.thumbnailHeight}` : "Custom image") : "None (default artwork)",
  });
  return rows;
}

/** Library ⋮ → File Details (also opened by tapping a card). Read-only; never shows ids, Telegram links or the password. */
export default function FileDetailsDialog({ file, onClose }: { file: FileItem; onClose: () => void }) {
  const [playlists, setPlaylists] = useState<{ name: "loading" } | { name: "ready"; titles: string[] } | { name: "error" }>({ name: "loading" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/files/${file.id}/playlists`, { cache: "no-store" });
        const data = (await res.json().catch(() => null)) as { playlists?: PlaylistMembershipRow[] } | null;
        if (cancelled) return;
        if (!res.ok || !data?.playlists) setPlaylists({ name: "error" });
        else setPlaylists({ name: "ready", titles: data.playlists.filter((p) => p.isMember).map((p) => p.title) });
      } catch {
        if (!cancelled) setPlaylists({ name: "error" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [file.id]);

  const rows = buildDetailRows(file);
  const description = file.description?.trim();

  return (
    <Modal open onClose={onClose} title="File Details" size="md">
      <div className="flex flex-col gap-4" data-testid="file-details">
        <div className="flex items-center gap-3">
          <div className="w-24 aspect-[4/3] rounded-xl bg-secondary relative overflow-hidden flex-shrink-0">
            <FileThumb url={file.thumbnailUrl} fileType={file.fileType} title={file.title} mimeType={file.mimeType} />
          </div>
          <p className="font-bold text-primary break-words min-w-0" data-testid="details-title">{file.title}</p>
        </div>

        {description && <p className="text-sm text-secondary whitespace-pre-wrap break-words" data-testid="details-description">{description}</p>}

        <dl className="rounded-xl bg-secondary divide-y divide-[var(--color-border)]">
          {rows.map(({ label, value }) => (
            <div key={label} className="flex items-start justify-between gap-4 px-3 py-2.5 text-sm">
              <dt className="text-secondary flex-shrink-0">{label}</dt>
              <dd className={cn("text-primary font-medium text-right break-words min-w-0")} data-testid={`details-${label.toLowerCase().replace(/\s+/g, "-")}`}>{value}</dd>
            </div>
          ))}
          <div className="flex items-start justify-between gap-4 px-3 py-2.5 text-sm">
            <dt className="text-secondary flex-shrink-0">Playlists</dt>
            <dd className="text-primary font-medium text-right break-words min-w-0" data-testid="details-playlists">
              {playlists.name === "loading" && <span className="text-muted font-normal">Loading…</span>}
              {playlists.name === "error" && <span className="text-muted font-normal">Unavailable right now</span>}
              {playlists.name === "ready" && (playlists.titles.length === 0 ? "Not in any playlist" : playlists.titles.join(", "))}
            </dd>
          </div>
        </dl>

        <div className="grid grid-cols-2 gap-3">
          {[
            { label: "Views", value: formatNumber(file.views ?? 0), icon: Eye },
            { label: "Downloads", value: formatNumber(file.downloads ?? 0), icon: Download },
          ].map(({ label, value, icon: Icon }) => (
            <div key={label} className="bg-secondary rounded-xl p-3 text-center">
              <Icon size={16} className="text-brand mx-auto mb-1" aria-hidden="true" />
              <p className="font-bold text-primary text-base">{value}</p>
              <p className="text-xs text-secondary">{label}</p>
            </div>
          ))}
        </div>

        <button type="button" onClick={onClose} className="w-full min-h-11 btn-secondary text-sm font-medium">Close</button>
      </div>
    </Modal>
  );
}
