"use client";
import React, { useState } from "react";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import Modal from "@/components/ui/Modal";

const REPORT_REASONS = [
  { value: "copyright", label: "Copyright Infringement" },
  { value: "nsfw", label: "Adult / NSFW Content" },
  { value: "malware", label: "Malware / Harmful Content" },
  { value: "broken_link", label: "Broken Link" },
  { value: "spam", label: "Spam" },
  { value: "other", label: "Other" },
];

/** Report-a-file dialog (POST /api/reports, unchanged). Surfaces failures instead of silently ignoring them. */
export default function ReportModal({ open, fileId, onClose }: { open: boolean; fileId: number; onClose: () => void }) {
  const [form, setForm] = useState({ reason: "copyright", description: "" });
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileId, ...form }),
      });
      if (res.ok) setSuccess(true);
      else setError("We couldn’t submit your report. Please try again.");
    } catch {
      setError("Network error. Please check your connection and try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Report File" size="sm">
      {success ? (
        <div className="flex flex-col items-center gap-3 text-center py-2">
          <CheckCircle2 size={40} className="text-green-500" />
          <p className="font-semibold text-primary">Report Submitted</p>
          <p className="text-sm text-secondary">Our team will review this content within 24 hours.</p>
          <button onClick={onClose} className="btn-primary px-6 py-2.5 text-sm w-full">Done</button>
        </div>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div>
            <label htmlFor="report-reason" className="text-xs font-medium text-secondary mb-1.5 block">Reason *</label>
            <select id="report-reason" className="input-app text-sm" value={form.reason} onChange={(e) => setForm((p) => ({ ...p, reason: e.target.value }))}>
              {REPORT_REASONS.map(({ value, label }) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="report-details" className="text-xs font-medium text-secondary mb-1.5 block">Additional Details</label>
            <textarea
              id="report-details"
              className="input-app text-sm resize-none"
              rows={3}
              placeholder="Provide more details about the issue..."
              value={form.description}
              onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
            />
          </div>
          {error && (
            <div role="alert" className="flex items-start gap-2 p-3 rounded-xl bg-red-50 dark:bg-red-900/20">
              <AlertCircle size={15} className="text-red-500 mt-px flex-shrink-0" />
              <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
            </div>
          )}
          <div className="flex gap-3">
            <button type="button" onClick={onClose} className="flex-1 btn-secondary py-2.5 text-sm">Cancel</button>
            <button type="submit" disabled={loading} className="flex-1 py-2.5 rounded-xl bg-red-500 text-white text-sm font-semibold hover:bg-red-600 transition-colors disabled:opacity-60 inline-flex items-center justify-center gap-2">
              {loading && <Loader2 size={14} className="animate-spin" />}
              {loading ? "Submitting..." : "Submit Report"}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
