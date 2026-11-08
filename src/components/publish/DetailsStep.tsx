"use client";
import React, { useState } from "react";
import { ArrowLeft, ArrowRight, Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { CATEGORIES, DESCRIPTION_MAX, FILE_TYPES, PASSWORD_MAX, TITLE_MAX } from "@/lib/publishing/constants";
import { validateDetails, type FieldErrors } from "@/lib/publishing/validation";
import { thumbnailStorage, type ThumbnailStorageService } from "@/lib/publishing/thumbnailStorage";
import ThumbnailField from "./ThumbnailField";
import PlaylistPicker, { type PlaylistOption } from "./PlaylistPicker";
import type { PublishDraft } from "./draft";

function Counter({ value, max }: { value: number; max: number }) {
  return (
    <span className={cn("text-[11px] tabular-nums", value > max ? "text-red-500" : value > max * 0.9 ? "text-yellow-600" : "text-muted")}>
      {value}/{max}
    </span>
  );
}

export default function DetailsStep({
  draft,
  onChange,
  playlists,
  onPlaylistsChanged,
  onBack,
  onContinue,
  serverErrors,
  storage = thumbnailStorage,
}: {
  draft: PublishDraft;
  onChange: (patch: Partial<PublishDraft>) => void;
  playlists: PlaylistOption[];
  onPlaylistsChanged: () => void | Promise<void>;
  onBack: () => void;
  onContinue: () => void;
  serverErrors?: FieldErrors;
  storage?: ThumbnailStorageService;
}) {
  const [submitted, setSubmitted] = useState(false);
  const clientErrors = validateDetails(draft);
  const errors: FieldErrors = submitted ? { ...serverErrors, ...clientErrors } : { ...serverErrors };

  const next = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (Object.keys(clientErrors).length === 0) onContinue();
  };

  const err = (msg?: string, id?: string) =>
    msg ? (
      <p id={id} role="alert" className="text-xs text-red-500 mt-1.5">
        {msg}
      </p>
    ) : null;

  return (
    <form onSubmit={next} className="flex flex-col gap-4" noValidate>
      <div>
        <h2 className="text-xl font-bold text-primary">Post Details</h2>
        <p className="text-sm text-secondary mt-1">Tell people what they&apos;re getting.</p>
      </div>

      <section className="bg-card rounded-2xl border border-app shadow-app-sm p-4 flex flex-col gap-4">
        {/* Title */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label htmlFor="post-title" className="text-xs font-semibold text-secondary">
              Title <span className="text-brand">*</span>
            </label>
            <Counter value={draft.title.length} max={TITLE_MAX} />
          </div>
          <input
            id="post-title"
            className={cn("input-app text-sm min-h-12", errors.title && "!border-red-500")}
            placeholder="e.g. Complete UI Design Course"
            value={draft.title}
            maxLength={TITLE_MAX + 20}
            onChange={(e) => onChange({ title: e.target.value })}
            aria-invalid={!!errors.title}
            aria-describedby={errors.title ? "post-title-err" : undefined}
          />
          {err(errors.title, "post-title-err")}
        </div>

        {/* Description */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label htmlFor="post-desc" className="text-xs font-semibold text-secondary">
              Description <span className="font-normal text-muted">(optional)</span>
            </label>
            <Counter value={draft.description.length} max={DESCRIPTION_MAX} />
          </div>
          <textarea
            id="post-desc"
            className={cn("input-app text-sm resize-none", errors.description && "!border-red-500")}
            rows={4}
            placeholder="Describe what's inside, who it's for, and why it's useful…"
            value={draft.description}
            onChange={(e) => onChange({ description: e.target.value })}
            aria-invalid={!!errors.description}
          />
          {err(errors.description)}
        </div>
      </section>

      <section className="bg-card rounded-2xl border border-app shadow-app-sm p-4">
        <ThumbnailField value={draft.thumbnail} onChange={(thumbnail) => onChange({ thumbnail })} service={storage} />
      </section>

      <section className="bg-card rounded-2xl border border-app shadow-app-sm p-4 flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="post-category" className="text-xs font-semibold text-secondary mb-1.5 block">
              Category
            </label>
            <select
              id="post-category"
              className="input-app text-sm min-h-12"
              value={draft.category}
              onChange={(e) => onChange({ category: e.target.value })}
            >
              <option value="">Select…</option>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            {err(errors.category)}
          </div>
          <div>
            <label htmlFor="post-type" className="text-xs font-semibold text-secondary mb-1.5 block">
              File type
            </label>
            <select
              id="post-type"
              className="input-app text-sm min-h-12"
              value={draft.fileType}
              onChange={(e) => onChange({ fileType: e.target.value })}
            >
              {FILE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </option>
              ))}
            </select>
            {err(errors.fileType)}
          </div>
        </div>

        <PlaylistPicker
          playlists={playlists}
          value={draft.playlistId}
          onChange={(playlistId) => onChange({ playlistId })}
          onCreated={onPlaylistsChanged}
        />
        {err(errors.playlistId)}

        {/* Existing access control: optional password */}
        <div>
          <label htmlFor="post-password" className="text-xs font-semibold text-secondary mb-1.5 flex items-center gap-1.5">
            <Lock size={12} className="text-brand" />
            Password protection <span className="font-normal text-muted">(optional)</span>
          </label>
          <input
            id="post-password"
            className={cn("input-app text-sm min-h-12", errors.password && "!border-red-500")}
            type="password"
            autoComplete="new-password"
            placeholder="Leave empty for no password"
            value={draft.password}
            maxLength={PASSWORD_MAX + 20}
            onChange={(e) => onChange({ password: e.target.value })}
          />
          {err(errors.password)}
        </div>
      </section>

      <div className="flex gap-3 pt-1">
        <button
          type="button"
          onClick={onBack}
          className="btn-secondary min-h-12 flex items-center justify-center gap-1.5 text-sm font-semibold !px-5"
        >
          <ArrowLeft size={16} />
          Back
        </button>
        <button type="submit" className="btn-primary min-h-12 flex-1 flex items-center justify-center gap-2 text-sm font-semibold">
          Continue
          <ArrowRight size={16} />
        </button>
      </div>
    </form>
  );
}
