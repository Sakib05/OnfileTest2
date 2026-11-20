"use client";
import React, { useState } from "react";
import { Loader2 } from "lucide-react";
import Modal from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { cn } from "@/lib/utils";
import { DESCRIPTION_MAX, TITLE_MAX } from "@/lib/publishing/constants";
import type { FileItem } from "@/components/library/types";

export interface EditedDetails {
  title: string;
  description: string | null;
  updatedAt?: string | null;
}

/** Client-side mirror of the server rules (the server re-validates). Returns field errors, empty when valid. */
export function validateDetails(title: string, description: string, titleMax: number): { title?: string; description?: string } {
  const errors: { title?: string; description?: string } = {};
  const t = title.trim();
  if (!t) errors.title = "Title is required.";
  else if (t.length > titleMax) errors.title = `Title must be ${titleMax} characters or fewer.`;
  if (description.trim().length > DESCRIPTION_MAX) errors.description = `Description must be ${DESCRIPTION_MAX} characters or fewer.`;
  return errors;
}

/**
 * Library ⋮ → Edit Details. Edits ONLY the title and description stored by Onfile (PATCH /api/files/:id with just those
 * two keys — so published state, password, price, link, thumbnail and the Telegram post are left exactly as they are).
 */
export default function EditDetailsDialog({ file, onClose, onSaved }: { file: FileItem; onClose: () => void; onSaved: (d: EditedDetails) => void }) {
  const { toast } = useToast();
  const [title, setTitle] = useState(file.title);
  const [description, setDescription] = useState(file.description ?? "");
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  // Legacy titles may exceed the publish-flow limit; never block saving an unchanged long title.
  const titleMax = Math.max(TITLE_MAX, file.title.length);
  const errors = validateDetails(title, description, titleMax);
  const changed = title.trim() !== file.title || description.trim() !== (file.description ?? "").trim();
  const invalid = !!errors.title || !!errors.description;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (saving || invalid || !changed) return;
    setSaving(true);
    setServerError(null);
    try {
      const body: Record<string, unknown> = {};
      if (title.trim() !== file.title) body.title = title.trim();
      if (description.trim() !== (file.description ?? "").trim()) body.description = description.trim();
      const res = await fetch(`/api/files/${file.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = (await res.json().catch(() => null)) as { file?: { title?: string; description?: string | null; updatedAt?: string | null }; error?: string } | null;
      if (!res.ok || !data?.file) {
        setServerError(data?.error ?? "Couldn't save your changes. Please try again.");
        return;
      }
      onSaved({ title: data.file.title ?? title.trim(), description: data.file.description ?? null, updatedAt: data.file.updatedAt ?? null });
      toast("Details saved");
      onClose();
    } catch {
      setServerError("Network error. Please check your connection and try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={() => !saving && onClose()} title="Edit Details" size="md">
      <form onSubmit={save} className="flex flex-col gap-4" noValidate data-testid="edit-details-form">
        <div>
          <label htmlFor="edit-file-title" className="text-xs font-semibold text-secondary mb-1.5 block">Title</label>
          <input
            id="edit-file-title"
            data-autofocus
            className={cn("input-app text-sm min-h-11", touched && errors.title && "!border-red-500")}
            value={title}
            maxLength={titleMax + 20}
            onChange={(e) => setTitle(e.target.value)}
            disabled={saving}
            aria-invalid={touched && !!errors.title}
            aria-describedby="edit-file-title-err"
          />
          <div className="flex justify-between gap-2 mt-1">
            <p id="edit-file-title-err" role={touched && errors.title ? "alert" : undefined} className="text-xs text-red-500">{touched ? errors.title : ""}</p>
            <p className="text-[11px] text-muted tabular-nums ml-auto">{title.trim().length}/{titleMax}</p>
          </div>
        </div>

        <div>
          <label htmlFor="edit-file-description" className="text-xs font-semibold text-secondary mb-1.5 block">Description <span className="font-normal text-muted">(optional)</span></label>
          <textarea
            id="edit-file-description"
            className={cn("input-app text-sm resize-none", errors.description && "!border-red-500")}
            rows={4}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={saving}
            aria-invalid={!!errors.description}
            aria-describedby="edit-file-description-err"
          />
          <div className="flex justify-between gap-2 mt-1">
            <p id="edit-file-description-err" role={errors.description ? "alert" : undefined} className="text-xs text-red-500">{errors.description ?? ""}</p>
            <p className="text-[11px] text-muted tabular-nums ml-auto">{description.trim().length}/{DESCRIPTION_MAX}</p>
          </div>
        </div>

        <p className="text-[11px] text-muted -mt-1">Only the details shown in Onfile change. The original file in your Telegram channel isn&apos;t touched, and its published status stays the same.</p>

        {serverError && (
          <p role="alert" className="text-xs text-red-500 bg-red-50 dark:bg-red-900/20 rounded-xl px-3 py-2" data-testid="edit-details-error">{serverError}</p>
        )}

        <div className="flex gap-3">
          <button type="button" onClick={onClose} disabled={saving} className="flex-1 min-h-11 btn-secondary text-sm font-medium disabled:opacity-60">Cancel</button>
          <button type="submit" disabled={saving || !changed} data-testid="edit-details-save" className="flex-1 min-h-11 btn-primary text-sm flex items-center justify-center gap-2 disabled:opacity-60">
            {saving ? <><Loader2 size={15} className="animate-spin" aria-hidden="true" /> Saving…</> : "Save changes"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
