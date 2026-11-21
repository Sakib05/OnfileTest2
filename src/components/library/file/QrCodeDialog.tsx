"use client";
import React from "react";
import QrCodeModal from "@/components/ui/QrCodeModal";
import { fileShareAvailability, fileShareUrl } from "@/lib/fileShare";
import type { FileItem } from "@/components/library/types";

/**
 * Library ⋮ → Share → Show QR code. Encodes EXACTLY the file's public smart link (the same URL Copy Link / Share use),
 * so a scan lands on /f/<slug> where the existing access rules apply (password, Stars, unpublished → not found).
 * Private files get no QR at all. Rendering is shared with the playlist QR via `QrCodeModal`.
 */
export default function QrCodeDialog({ file, onClose }: { file: FileItem; onClose: () => void }) {
  const availability = fileShareAvailability(file);
  const url = typeof window !== "undefined" && availability.ok ? fileShareUrl(window.location.origin, file) : null;
  return (
    <QrCodeModal
      title={file.title}
      url={url}
      blockedMessage={availability.ok ? "Couldn't generate the QR code." : availability.message}
      hasPassword={file.hasPassword ?? !!file.password}
      noun="file"
      onClose={onClose}
    />
  );
}
