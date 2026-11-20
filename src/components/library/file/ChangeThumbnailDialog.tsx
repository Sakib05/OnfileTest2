"use client";
import React, { useState } from "react";
import Modal from "@/components/ui/Modal";
import ThumbnailManager from "@/components/ThumbnailManager";
import { useToast } from "@/components/ui/Toast";
import type { FileItem } from "@/components/library/types";

export interface ThumbChange {
  url: string | null;
  width: number | null;
  height: number | null;
}

/**
 * Library ⋮ → Change Thumbnail. Reuses the existing ThumbnailManager (choose → preview → "Replace thumbnail" / Cancel,
 * plus "Remove thumbnail") which talks to POST/DELETE /api/files/:id/thumbnail. Only the small optimized preview image
 * goes to Onfile's thumbnail storage (DBByte); the original file stays in the creator's Telegram channel.
 * Library cards and the public /f/<slug> page read the same stored thumbnail, so one save updates both.
 */
export default function ChangeThumbnailDialog({ file, onClose, onChanged }: { file: FileItem; onClose: () => void; onChanged: (t: ThumbChange) => void }) {
  const { toast } = useToast();
  const [current, setCurrent] = useState<string | null>(file.thumbnailUrl ?? null);

  return (
    <Modal open onClose={onClose} title="Change Thumbnail" size="md">
      <div className="flex flex-col gap-3" data-testid="change-thumbnail">
        <p className="text-sm text-secondary break-words line-clamp-2">{file.title}</p>
        <ThumbnailManager
          fileId={file.id}
          fileType={file.fileType}
          fileTitle={file.title}
          currentUrl={current}
          onChanged={(t) => {
            setCurrent(t.url);
            onChanged(t);
          }}
          onToast={toast}
        />
        <button type="button" onClick={onClose} className="w-full min-h-11 btn-secondary text-sm font-medium">Done</button>
      </div>
    </Modal>
  );
}
