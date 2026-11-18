"use client";
import React, { useState } from "react";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import Modal from "@/components/ui/Modal";
import { cn } from "@/lib/utils";
import { REPORT_DETAILS_MAX, REPORT_REASONS, type ReportReason, type ReportTarget } from "@/lib/reports";

export interface ReportDialogProps {
  onClose: () => void;
  /** The currently selected file. */
  file: { slug: string; title: string };
  /** Present only in playlist mode: lets the visitor report the playlist itself instead of the selected file. */
  playlist?: { slug: string; title: string };
}

/**
 * Compact report dialog. The success screen is shown ONLY after the server answered 2xx — never optimistically.
 * Targets are public identifiers (file slug / playlist token); the server resolves and validates them.
 */
export default function ReportDialog({ onClose, file, playlist }: ReportDialogProps) {
  const [target, setTarget] = useState<ReportTarget>("file");
  const [reason, setReason] = useState<ReportReason | "">("");
  const [details, setDetails] = useState("");
  const [website, setWebsite] = useState(""); // honeypot: real visitors never see or fill this
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading || !reason) return;
    setLoading(true);
    setError("");
    try {
      const slug = target === "playlist" && playlist ? playlist.slug : file.slug;
      const res = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target, slug, reason, details: details.trim() || undefined, website }),
      });
      if (res.ok) {
        setSuccess(true);
      } else if (res.status === 429) {
        setError("You've sent several reports recently. Please try again later.");
      } else if (res.status === 404) {
        setError("This content is no longer available, so it can't be reported.");
      } else {
        setError("We couldn’t submit your report. Please try again.");
      }
    } catch {
      setError("Network error. Please check your connection and try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="Report" size="sm">
      {success ? (
        <div className="flex flex-col items-center gap-3 text-center py-1" role="status" data-testid="report-success">
          <CheckCircle2 size={40} className="text-green-500" aria-hidden="true" />
          <p className="font-semibold text-primary">Report received</p>
          <p className="text-sm text-secondary">Thanks for letting us know. We’ll review it.</p>
          <button type="button" onClick={onClose} className="btn-primary px-6 py-2.5 text-sm w-full">Done</button>
        </div>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-3.5" aria-label="Report content">
          {playlist && (
            <fieldset className="flex flex-col gap-1.5" data-testid="report-target">
              <legend className="text-xs font-medium text-secondary mb-1">What are you reporting?</legend>
              <TargetOption checked={target === "file"} onChange={() => setTarget("file")} label="This file" hint={file.title} />
              <TargetOption checked={target === "playlist"} onChange={() => setTarget("playlist")} label="The whole playlist" hint={playlist.title} />
            </fieldset>
          )}
          {!playlist && <p className="text-xs text-secondary truncate">Reporting: <span className="font-semibold text-primary">{file.title}</span></p>}

          <fieldset className="flex flex-col gap-1">
            <legend className="text-xs font-medium text-secondary mb-1">Reason</legend>
            {REPORT_REASONS.map((r) => (
              <label key={r.value} className={cn("flex items-center gap-2.5 min-h-10 px-3 rounded-xl border text-sm cursor-pointer", reason === r.value ? "border-[#FF6115] bg-brand-10 text-primary" : "border-app text-primary")}>
                <input type="radio" name="report-reason" value={r.value} checked={reason === r.value} onChange={() => setReason(r.value)} className="accent-[#FF6115]" />
                <span className="min-w-0 break-words">{r.label}</span>
              </label>
            ))}
          </fieldset>

          <div>
            <label htmlFor="report-details" className="text-xs font-medium text-secondary mb-1.5 block">Additional details (optional)</label>
            <textarea
              id="report-details"
              className="input-app text-sm resize-none"
              rows={3}
              maxLength={REPORT_DETAILS_MAX}
              placeholder="Anything that helps us review this…"
              value={details}
              onChange={(e) => setDetails(e.target.value)}
            />
          </div>

          <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
            <label>Website<input type="text" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} /></label>
          </div>

          {error && (
            <div role="alert" className="flex items-start gap-2 p-3 rounded-xl bg-red-50 dark:bg-red-900/20">
              <AlertCircle size={15} className="text-red-500 mt-px flex-shrink-0" aria-hidden="true" />
              <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
            </div>
          )}

          <div className="flex gap-3">
            <button type="button" onClick={onClose} className="flex-1 btn-secondary py-2.5 text-sm">Cancel</button>
            <button type="submit" disabled={loading || !reason} className="flex-1 py-2.5 rounded-xl bg-red-500 text-white text-sm font-semibold hover:bg-red-600 transition-colors disabled:opacity-60 inline-flex items-center justify-center gap-2">
              {loading && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
              {loading ? "Submitting…" : "Submit report"}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}

function TargetOption({ checked, onChange, label, hint }: { checked: boolean; onChange: () => void; label: string; hint: string }) {
  return (
    <label className={cn("flex items-center gap-2.5 min-h-11 px-3 py-1.5 rounded-xl border text-sm cursor-pointer", checked ? "border-[#FF6115] bg-brand-10" : "border-app")}>
      <input type="radio" name="report-target" checked={checked} onChange={onChange} className="accent-[#FF6115]" />
      <span className="min-w-0 flex-1">
        <span className="block font-medium text-primary">{label}</span>
        <span className="block text-xs text-secondary truncate">{hint}</span>
      </span>
    </label>
  );
}
