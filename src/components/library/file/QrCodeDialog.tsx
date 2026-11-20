"use client";
import React, { useMemo, useState } from "react";
import { Copy, Download, EyeOff, Loader2, Lock } from "lucide-react";
import Modal from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { copyText } from "@/lib/playlistShareClient";
import { fileShareAvailability, fileShareUrl } from "@/lib/fileShare";
import { buildQr, qrFileName, qrSvgPath, qrToPngBlob } from "@/lib/qrCode";
import type { FileItem } from "@/components/library/types";

/**
 * Library ⋮ → Generate QR Code. Encodes EXACTLY the file's public smart link (the same URL Copy Link / Share use), so a
 * scan lands on /f/<slug> where the existing access rules apply (password, Stars, unpublished → not found). Private
 * files get no QR at all. The code is drawn locally (no third-party QR service sees the URL) on a white tile in both themes.
 */
export default function QrCodeDialog({ file, onClose }: { file: FileItem; onClose: () => void }) {
  const { toast } = useToast();
  const [downloading, setDownloading] = useState(false);
  const availability = fileShareAvailability(file);
  const url = typeof window !== "undefined" ? fileShareUrl(window.location.origin, file) : null;
  const hasPassword = file.hasPassword ?? !!file.password;

  const svg = useMemo(() => {
    if (!url) return null;
    try {
      return qrSvgPath(buildQr(url));
    } catch {
      return null; // e.g. data too long — never happens for /f/<slug>, but fail closed
    }
  }, [url]);

  const download = async () => {
    if (!url || downloading) return;
    setDownloading(true);
    try {
      const blob = await qrToPngBlob(url);
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = qrFileName(file.title);
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(href), 10_000);
      toast("QR code saved");
    } catch {
      toast("Couldn't save the QR code image. Take a screenshot instead.", "error");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="QR Code" size="sm">
      <div className="flex flex-col items-center gap-4" data-testid="qr-dialog">
        <p className="text-sm font-semibold text-primary text-center break-words line-clamp-2 w-full" data-testid="qr-title">{file.title}</p>

        {!availability.ok || !url || !svg ? (
          <div className="flex items-start gap-3 rounded-xl bg-secondary p-3 w-full" data-testid="qr-blocked">
            <EyeOff size={18} className="text-muted flex-shrink-0 mt-0.5" aria-hidden="true" />
            <p className="text-sm text-primary">{availability.ok ? "Couldn't generate the QR code." : availability.message}</p>
          </div>
        ) : (
          <>
            {/* Always dark-on-white: required for reliable scanning, regardless of the app theme. */}
            <div className="bg-white rounded-2xl p-2 shadow-app-sm w-full max-w-[17rem] aspect-square">
              <svg
                viewBox={`0 0 ${svg.viewBox} ${svg.viewBox}`}
                className="w-full h-full block"
                role="img"
                aria-label={`QR code for ${file.title}`}
                shapeRendering="crispEdges"
                data-testid="qr-svg"
                data-qr-url={url}
              >
                <rect width={svg.viewBox} height={svg.viewBox} fill="#ffffff" />
                <path d={svg.d} fill="#000000" />
              </svg>
            </div>
            <p className="text-[11px] text-muted text-center break-all w-full" data-testid="qr-url">{url}</p>
            {hasPassword && (
              <p className="text-xs text-secondary flex items-start gap-2 w-full" data-testid="qr-password-note">
                <Lock size={13} className="flex-shrink-0 mt-0.5" aria-hidden="true" /> Password protected: anyone who scans this is still asked for the password.
              </p>
            )}
            <div className="grid gap-2 w-full">
              <button type="button" onClick={() => void download()} disabled={downloading} data-testid="qr-download" className="btn-primary min-h-11 text-sm flex items-center justify-center gap-2 disabled:opacity-60">
                {downloading ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <Download size={15} aria-hidden="true" />} Download QR Code
              </button>
              <button
                type="button"
                data-testid="qr-copy"
                className="btn-secondary min-h-11 text-sm flex items-center justify-center gap-2"
                onClick={async () => {
                  const ok = await copyText(url);
                  toast(ok ? "Link copied to clipboard" : "Couldn't copy the link. Please try again.", ok ? "success" : "error");
                }}
              >
                <Copy size={15} aria-hidden="true" /> Copy link
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
