"use client";
import React from "react";
import { Copy, EyeOff, Lock, QrCode, Send, Share2 } from "lucide-react";
import Modal from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { canNativeShare, copyText, nativeShare, openTelegramShare } from "@/lib/playlistShareClient";
import { fileShareAvailability, fileShareUrl } from "@/lib/fileShare";
import type { FileItem } from "@/components/library/types";

/**
 * Library ⋮ → Share. Uses the file's public smart link (/f/<slug>) with the same actions as the playlist share sheet:
 * Copy · Share on Telegram (native Telegram share dialog) · system share sheet. A private (unpublished) file gets an
 * explanation instead of a link; a password stays a password (people are asked for it on the page — it's not in the URL).
 */
export default function ShareFileDialog({ file, onClose, onQr }: { file: FileItem; onClose: () => void; onQr?: () => void }) {
  const { toast } = useToast();
  const availability = fileShareAvailability(file);
  const url = typeof window !== "undefined" ? fileShareUrl(window.location.origin, file) : null;
  const text = `Check out “${file.title}” on Onfile`;
  const hasPassword = file.hasPassword ?? !!file.password;

  return (
    <Modal open onClose={onClose} title="Share file" size="sm">
      <div className="flex flex-col gap-4" data-testid="share-file">
        <p className="text-sm font-semibold text-primary break-words line-clamp-2">{file.title}</p>

        {!availability.ok || !url ? (
          <div className="flex items-start gap-3 rounded-xl bg-secondary p-3" data-testid="share-file-blocked">
            <EyeOff size={18} className="text-muted flex-shrink-0 mt-0.5" aria-hidden="true" />
            <p className="text-sm text-primary">{availability.ok ? "Couldn't build the share link." : availability.message}</p>
          </div>
        ) : (
          <>
            <div>
              <label htmlFor="file-share-url" className="text-xs font-semibold text-secondary mb-1.5 block">File link</label>
              <input id="file-share-url" readOnly className="input-app text-sm" value={url} onFocus={(e) => e.currentTarget.select()} data-testid="share-file-url" />
            </div>

            {hasPassword && (
              <p className="text-xs text-secondary flex items-start gap-2" data-testid="share-file-password-note">
                <Lock size={13} className="flex-shrink-0 mt-0.5" aria-hidden="true" /> This file is password protected. People who open the link are asked for the password — it isn&apos;t part of the link.
              </p>
            )}

            <div className="grid gap-2">
              <button
                type="button"
                className="btn-primary min-h-11 text-sm flex items-center justify-center gap-2"
                data-testid="share-file-copy"
                onClick={async () => {
                  const ok = await copyText(url);
                  toast(ok ? "Link copied to clipboard" : "Couldn't copy the link. Select it and copy manually.", ok ? "success" : "error");
                }}
              >
                <Copy size={15} aria-hidden="true" /> Copy link
              </button>
              <button
                type="button"
                className="btn-secondary min-h-11 text-sm flex items-center justify-center gap-2"
                data-testid="share-file-telegram"
                onClick={() => {
                  openTelegramShare(url, text);
                  toast("Opening Telegram…", "info");
                }}
              >
                <Send size={15} aria-hidden="true" /> Share on Telegram
              </button>
              {canNativeShare() && (
                <button
                  type="button"
                  className="btn-secondary min-h-11 text-sm flex items-center justify-center gap-2"
                  data-testid="share-file-native"
                  onClick={async () => {
                    const r = await nativeShare({ title: file.title, text, url });
                    if (r === "shared") toast("Shared");
                    else if (r === "failed") toast("Couldn't open the share sheet. Copy the link instead.", "error");
                  }}
                >
                  <Share2 size={15} aria-hidden="true" /> More options…
                </button>
              )}
              {onQr && (
                <button type="button" className="btn-secondary min-h-11 text-sm flex items-center justify-center gap-2" data-testid="share-file-qr" onClick={onQr}>
                  <QrCode size={15} aria-hidden="true" /> Show QR code
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
