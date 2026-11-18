"use client";
import React from "react";
import { AlertTriangle } from "lucide-react";
import Modal from "@/components/ui/Modal";
import { cn } from "@/lib/utils";

/**
 * Confirmation for a consequential action. Cancel is focused first (safe default), Escape / backdrop cancel,
 * and nothing can be dismissed while the request is running.
 */
export default function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  busyLabel,
  destructive = false,
  loading = false,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  description: React.ReactNode;
  confirmLabel: string;
  busyLabel?: string;
  destructive?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal open={open} onClose={() => !loading && onClose()} title={undefined} size="sm" hideClose>
      <div className="flex flex-col items-center text-center gap-4" aria-live="polite">
        <div className={cn("w-12 h-12 rounded-2xl flex items-center justify-center", destructive ? "bg-red-100 dark:bg-red-900/30" : "bg-brand-10")}>
          <AlertTriangle size={24} className={destructive ? "text-red-500" : "text-brand"} aria-hidden="true" />
        </div>
        <div>
          <h3 className="text-lg font-bold text-primary mb-1">{title}</h3>
          <div className="text-sm text-secondary leading-relaxed">{description}</div>
        </div>
        <div className="flex gap-3 w-full">
          <button type="button" data-autofocus onClick={onClose} disabled={loading} className="flex-1 min-h-11 py-3 rounded-xl font-medium text-sm btn-secondary disabled:opacity-60">
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            data-testid="confirm-action"
            className={cn("flex-1 min-h-11 py-3 rounded-xl font-semibold text-sm text-white transition-colors disabled:opacity-50", destructive ? "bg-red-500 hover:bg-red-600" : "bg-[var(--color-primary)] hover:bg-[var(--color-primary-dark)]")}
          >
            {loading ? busyLabel ?? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}
