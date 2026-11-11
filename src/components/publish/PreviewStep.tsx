"use client";
import React from "react";
import { AlertCircle, AlertTriangle, ArrowLeft, FolderOpen, Lock, Loader2, Pencil, Rocket, Save, Star, Tag } from "lucide-react";
import FileTypeArt from "@/components/ui/FileTypeArt";
import { PAID_PUBLISHING_UNAVAILABLE_MESSAGE } from "@/lib/publishing/payments";
import type { PublishMode } from "@/lib/publishing/constants";
import type { PublishDraft, StepIndex } from "./draft";

export default function PreviewStep({
  draft,
  playlistTitle,
  paidPublishingAvailable,
  publishing,
  error,
  onBack,
  onEdit,
  onPublish,
  onSwitchToFree,
}: {
  draft: PublishDraft;
  playlistTitle: string | null;
  paidPublishingAvailable: boolean | null;
  publishing: PublishMode | null;
  error: string | null;
  onBack: () => void;
  onEdit: (step: StepIndex) => void;
  onPublish: (mode: PublishMode) => void;
  onSwitchToFree: () => void;
}) {
  const paid = draft.monetization === "paid";
  const blockedPaid = paid && paidPublishingAvailable !== true;
  const busy = publishing !== null;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-xl font-bold text-primary">Preview &amp; Publish</h2>
        <p className="text-sm text-secondary mt-1">This is how your content page will look.</p>
      </div>

      {/* Content page preview */}
      <article className="bg-card rounded-2xl border border-app shadow-app-md overflow-hidden" aria-label="Content page preview">
        <div className="relative aspect-video w-full bg-secondary flex items-center justify-center overflow-hidden">
          {draft.thumbnail ? (
            // eslint-disable-next-line @next/next/no-img-element -- staged preview from the storage service
            <img src={draft.thumbnail.previewUrl} alt="Thumbnail" className="absolute inset-0 w-full h-full object-cover" />
          ) : (
            <>
              <FileTypeArt fileType={draft.fileType} title={draft.title} />
              <span className="absolute bottom-2 left-0 right-0 text-center text-[11px] font-semibold text-white/90 drop-shadow">Default thumbnail</span>
            </>
          )}
          <span
            className={`absolute top-3 right-3 px-2.5 py-1 rounded-full text-xs font-bold flex items-center gap-1 ${
              paid ? "bg-yellow-400 text-black" : "bg-green-500 text-white"
            }`}
          >
            {paid ? (
              <>
                <Star size={12} fill="currentColor" /> {Number(draft.starsPrice).toLocaleString("en-US")} Stars
              </>
            ) : (
              "Free"
            )}
          </span>
        </div>

        <div className="p-4 flex flex-col gap-3">
          <h3 className="text-lg font-bold text-primary leading-snug break-words">{draft.title.trim() || "Untitled"}</h3>

          <div className="flex flex-wrap gap-2 text-xs">
            {draft.category && (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-brand-10 text-brand font-semibold">
                <Tag size={11} /> {draft.category}
              </span>
            )}
            {playlistTitle && (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-secondary text-secondary font-medium">
                <FolderOpen size={11} /> {playlistTitle}
              </span>
            )}
            {draft.password && (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-secondary text-secondary font-medium">
                <Lock size={11} /> Password protected
              </span>
            )}
          </div>

          {draft.description.trim() ? (
            <p className="text-sm text-secondary whitespace-pre-wrap break-words">{draft.description.trim()}</p>
          ) : (
            <p className="text-sm text-muted italic">No description</p>
          )}
        </div>
      </article>

      {/* Summary with edit shortcuts */}
      <section className="bg-card rounded-2xl border border-app shadow-app-sm divide-y divide-[var(--color-border)]">
        {[
          { label: "Post", value: draft.verified?.canonicalLink ?? draft.link, step: 0 as StepIndex },
          { label: "Details", value: `${draft.title.trim() || "Untitled"}`, step: 1 as StepIndex },
          { label: "Access", value: paid ? `Paid · ${Number(draft.starsPrice).toLocaleString("en-US")} Stars` : "Free", step: 2 as StepIndex },
        ].map((row) => (
          <div key={row.label} className="flex items-center gap-3 px-4 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-semibold text-muted uppercase tracking-wide">{row.label}</p>
              <p className="text-sm text-primary truncate">{row.value}</p>
            </div>
            <button
              type="button"
              onClick={() => onEdit(row.step)}
              disabled={busy}
              className="min-h-11 px-3 text-xs font-semibold text-brand flex items-center gap-1 disabled:opacity-50"
              aria-label={`Edit ${row.label.toLowerCase()}`}
            >
              <Pencil size={12} /> Edit
            </button>
          </div>
        ))}
      </section>

      {blockedPaid && (
        <div className="flex items-start gap-2.5 rounded-xl p-3 bg-yellow-500/10 border border-yellow-500/30" role="note">
          <AlertTriangle size={16} className="text-yellow-600 mt-0.5 flex-shrink-0" />
          <div className="text-xs text-secondary">
            <p>{paidPublishingAvailable === null ? "Checking payment availability…" : PAID_PUBLISHING_UNAVAILABLE_MESSAGE}</p>
            <button type="button" onClick={onSwitchToFree} disabled={busy} className="mt-1.5 font-semibold text-brand min-h-11 disabled:opacity-50">
              Switch to free content
            </button>
          </div>
        </div>
      )}

      {error && (
        <div role="alert" className="flex items-start gap-2.5 rounded-xl p-3 bg-red-500/10 border border-red-500/30 animate-fade-in">
          <AlertCircle size={16} className="text-red-500 mt-0.5 flex-shrink-0" />
          <p className="text-sm text-red-600 dark:text-red-400 font-medium">{error}</p>
        </div>
      )}

      <div className="flex flex-col gap-3 pt-1">
        {blockedPaid ? (
          <button
            type="button"
            onClick={() => onPublish("draft")}
            disabled={busy || paidPublishingAvailable === null}
            className="btn-primary min-h-12 text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-60"
          >
            {publishing === "draft" ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
            {publishing === "draft" ? "Saving…" : "Save as Unpublished Draft"}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => onPublish("publish")}
            disabled={busy}
            className="btn-primary min-h-12 text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-60"
          >
            {publishing === "publish" ? <Loader2 size={16} className="animate-spin" /> : <Rocket size={16} />}
            {publishing === "publish" ? "Publishing…" : "Publish"}
          </button>
        )}
        <button
          type="button"
          onClick={onBack}
          disabled={busy}
          className="btn-secondary min-h-12 flex items-center justify-center gap-1.5 text-sm font-semibold disabled:opacity-60"
        >
          <ArrowLeft size={16} />
          Back
        </button>
      </div>
    </div>
  );
}
