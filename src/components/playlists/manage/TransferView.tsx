"use client";
import React, { useState } from "react";
import { ArrowRightLeft, CopyPlus, Loader2 } from "lucide-react";
import FileThumb from "@/components/ui/FileThumb";
import PlaylistThumb from "@/components/ui/PlaylistThumb";
import { useToast } from "@/components/ui/Toast";
import { cn } from "@/lib/utils";
import { JSON_HEADERS, readJson, type MemberFile, type PlaylistSummary } from "./types";

/** Add a file to — or move it to — another of the creator's playlists (existing transfer endpoint). */
export default function TransferView({
  fromPlaylistId,
  file,
  playlists,
  initialMode = "move",
  onDone,
}: {
  fromPlaylistId: number;
  file: MemberFile;
  playlists: PlaylistSummary[];
  initialMode?: "add" | "move";
  onDone: () => Promise<void>;
}) {
  const { toast } = useToast();
  const [mode, setMode] = useState<"add" | "move">(initialMode);
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
        <p className="text-sm font-semibold text-primary line-clamp-2 min-w-0 break-words">{file.title}</p>
      </div>
      <div role="group" aria-label="Action" className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-secondary">
        {([["move", "Move", ArrowRightLeft], ["add", "Also add", CopyPlus]] as const).map(([m, label, Icon]) => (
          <button
            key={m}
            type="button"
            aria-pressed={mode === m}
            onClick={() => setMode(m)}
            className={cn("flex items-center justify-center gap-1.5 rounded-lg min-h-11 px-2 text-xs font-semibold transition-colors", mode === m ? "bg-card text-primary shadow-app-sm" : "text-secondary")}
          >
            <Icon size={14} className={mode === m ? "text-brand" : undefined} aria-hidden="true" /> {label}
          </button>
        ))}
      </div>
      <p className="text-sm text-secondary">
        {mode === "move"
          ? "Move: the file leaves this playlist and is added to the one you choose."
          : "Also add: the file stays in this playlist and is added to the one you choose."}{" "}
        Either way, the original file stays in your Library and your Telegram channel.
      </p>
      {playlists.length === 0 ? (
        <p className="text-sm text-secondary text-center py-6">You have no other playlists yet. Create one from the Create tab first.</p>
      ) : (
        <ul className="flex flex-col gap-2 max-h-[45vh] overflow-y-auto overscroll-contain" role="radiogroup" aria-label="Destination playlist">
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
      <button type="button" onClick={() => void submit()} disabled={target === null || saving} className="btn-primary w-full min-h-11 py-3 text-sm flex items-center justify-center gap-2 disabled:opacity-60">
        {saving ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : mode === "move" ? <ArrowRightLeft size={15} aria-hidden="true" /> : <CopyPlus size={15} aria-hidden="true" />}
        {saving ? "Working…" : mode === "move" ? "Move here" : "Add here"}
      </button>
    </div>
  );
}
