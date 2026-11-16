"use client";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Copy, EyeOff, Globe, Link2, Loader2, Lock, Send, Share2 } from "lucide-react";
import Modal from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { canNativeShare, copyText, nativeShare, openTelegramShare, requestShareLink, type ShareInfo, type ShareLinkResult } from "@/lib/playlistShareClient";

type State = { name: "loading" } | { name: "ready"; share: ShareInfo } | { name: "blocked"; reason: "private" | "paid_unavailable" | "error"; message: string };

/**
 * Share dialog: shows the playlist's real public link with Copy · Telegram · native Share.
 * The link comes from the server (POST /api/playlists/:id/share) — it is never built from the numeric id.
 * Private playlists get a clear "Make public" step (existing PATCH isPublished); public ones can be made private again,
 * which immediately disables the link. Password-protected playlists stay protected (recipients must enter the password).
 */
export default function ShareSheet({
  open,
  onClose,
  playlistId,
  title,
  onPublishedChange,
}: {
  open: boolean;
  onClose: () => void;
  playlistId: number;
  title: string;
  onPublishedChange?: (published: boolean) => void;
}) {
  const { toast } = useToast();
  const [state, setState] = useState<State>({ name: "loading" });
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    setState({ name: "loading" });
    const r: ShareLinkResult = await requestShareLink(playlistId);
    if (mine !== seq.current) return;
    setState(r.ok ? { name: "ready", share: r.share } : { name: "blocked", reason: r.reason, message: r.message });
  }, [playlistId]);

  useEffect(() => {
    // Fetch (or create) the link each time the dialog opens — network → state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (open) void load();
    else seq.current++;
  }, [open, load]);

  const setPublished = async (published: boolean) => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/playlists/${playlistId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isPublished: published }) });
      if (!res.ok) throw new Error("failed");
      onPublishedChange?.(published);
      if (published) {
        toast("Playlist is now public");
        await load();
      } else {
        toast("Playlist is now private. The link no longer works.");
        onClose();
      }
    } catch {
      toast("Couldn't change the playlist's visibility. Please try again.", "error");
    } finally {
      setBusy(false);
    }
  };

  const share = state.name === "ready" ? state.share : null;
  const text = `Check out “${title}” on Onfile`;

  return (
    <Modal open={open} onClose={onClose} title="Share playlist" size="sm">
      <div className="flex flex-col gap-4" data-testid="share-sheet">
        {state.name === "loading" && (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-secondary" role="status">
            <Loader2 size={16} className="animate-spin" /> Preparing your link…
          </div>
        )}

        {state.name === "blocked" && (
          <div className="flex flex-col gap-3" data-testid="share-blocked">
            <div className="flex items-start gap-3 rounded-xl bg-secondary p-3">
              {state.reason === "private" ? <EyeOff size={18} className="text-muted flex-shrink-0 mt-0.5" /> : <Lock size={18} className="text-muted flex-shrink-0 mt-0.5" />}
              <p className="text-sm text-primary">{state.message}</p>
            </div>
            {state.reason === "private" && (
              <button type="button" className="btn-primary w-full min-h-11 text-sm flex items-center justify-center gap-2 disabled:opacity-60" disabled={busy} onClick={() => void setPublished(true)}>
                {busy ? <Loader2 size={15} className="animate-spin" /> : <Globe size={15} />} Make public &amp; share
              </button>
            )}
            {state.reason === "error" && (
              <button type="button" className="btn-primary w-full min-h-11 text-sm" onClick={() => void load()}>Try again</button>
            )}
          </div>
        )}

        {share && (
          <>
            <div>
              <label htmlFor="pl-share-url" className="text-xs font-semibold text-secondary mb-1.5 block">Playlist link</label>
              <input
                id="pl-share-url"
                readOnly
                className="input-app text-sm"
                value={share.url}
                onFocus={(e) => e.currentTarget.select()}
                data-testid="share-url"
              />
            </div>

            {share.hasPassword && (
              <p className="text-xs text-secondary flex items-start gap-2" data-testid="share-password-note">
                <Lock size={13} className="flex-shrink-0 mt-0.5" /> This playlist is password protected. People who open the link are asked for the password — it isn&apos;t part of the link.
              </p>
            )}

            <div className="grid gap-2">
              <button
                type="button"
                className="btn-primary min-h-11 text-sm flex items-center justify-center gap-2"
                data-testid="share-copy"
                onClick={async () => {
                  const ok = await copyText(share.url);
                  toast(ok ? "Playlist link copied" : "Couldn't copy the link. Select it and copy manually.", ok ? "success" : "error");
                }}
              >
                <Copy size={15} /> Copy link
              </button>
              <button
                type="button"
                className="btn-secondary min-h-11 text-sm flex items-center justify-center gap-2"
                data-testid="share-telegram"
                onClick={() => {
                  openTelegramShare(share.url, text);
                  toast("Opening Telegram…", "info");
                }}
              >
                <Send size={15} /> Share on Telegram
              </button>
              {canNativeShare() && (
                <button
                  type="button"
                  className="btn-secondary min-h-11 text-sm flex items-center justify-center gap-2"
                  data-testid="share-native"
                  onClick={async () => {
                    const r = await nativeShare({ title, text, url: share.url });
                    if (r === "shared") toast("Shared");
                    else if (r === "failed") toast("Couldn't open the share sheet. Copy the link instead.", "error");
                  }}
                >
                  <Share2 size={15} /> More options…
                </button>
              )}
            </div>

            <button
              type="button"
              disabled={busy}
              onClick={() => void setPublished(false)}
              className="self-center min-h-11 px-3 text-xs font-medium text-secondary flex items-center gap-1.5 disabled:opacity-60"
              data-testid="share-make-private"
            >
              <Link2 size={13} /> Make private (turns the link off)
            </button>
          </>
        )}
      </div>
    </Modal>
  );
}
