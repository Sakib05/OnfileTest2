"use client";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Camera, Loader2, Lock, Trash2 } from "lucide-react";
import TelegramAvatar from "@/components/ui/TelegramAvatar";
import { useToast } from "@/components/ui/Toast";
import { useApp } from "@/contexts/AppContext";
import { DISPLAY_NAME_MAX, validateDisplayName } from "@/lib/profile/identity";
import AvatarCropper from "@/components/profile/AvatarCropper";
import {
  AVATAR_ACCEPT,
  precheckAvatar,
  removeAvatar,
  saveDisplayName,
  uploadAvatar,
} from "@/lib/profile/avatarClient";
import { AvatarError } from "@/lib/profile/avatarErrors";
import { loadCropImage, type CropImage } from "@/lib/profile/avatarImage";

interface PendingPicture {
  file: File;
  previewUrl: string;
}

/**
 * ⚠️ DISABLED — NOT RENDERED ANYWHERE. Kept only so the custom profile picture feature can be restored.
 * The active Edit Profile is `./EditProfile.tsx` (Display name + read-only Username only).
 * To restore: see docs/PROFILE_PICTURE_TEMPORARILY_DISABLED.md (flip CUSTOM_PROFILE_PICTURE_ENABLED and render this
 * component from ProfileTab instead of EditProfile).
 *
 * Edit Profile with picture (previously opened from the pencil on the Profile Card). Everything is staged locally and written only when
 * "Save Changes" is pressed:
 *   • picture  — choose a photo → interactive 1:1 crop editor → Apply Crop stages the result (square preview);
 *                or remove the CUSTOM picture. Selecting / cropping NEVER uploads — only Save Changes does.
 *   • name     — custom display name (empty → Telegram name again)
 *   • username — read-only (lock icon only)
 * Back navigation is handled by Telegram's native BackButton registered in ProfileTab.
 */
export default function EditProfileWithPicture({ onDone }: { onDone: () => void }) {
  const { user, refreshUser } = useApp();
  const { toast } = useToast();

  const [name, setName] = useState(user?.displayName ?? "");
  const [pending, setPending] = useState<PendingPicture | null>(null);
  const [removeRequested, setRemoveRequested] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [cropImage, setCropImage] = useState<CropImage | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const savingRef = useRef(false); // synchronous guard against double-taps / duplicate submissions
  const fileRef = useRef<HTMLInputElement>(null);
  const pendingRef = useRef<PendingPicture | null>(null);
  const cropImageRef = useRef<CropImage | null>(null);

  // Revoke the blob preview URL on replace / unmount.
  useEffect(() => {
    pendingRef.current = pending;
  }, [pending]);
  useEffect(() => {
    cropImageRef.current = cropImage;
  }, [cropImage]);
  useEffect(
    () => () => {
      if (pendingRef.current) URL.revokeObjectURL(pendingRef.current.previewUrl);
      cropImageRef.current?.release(); // free the working canvas if we unmount mid-crop
    },
    []
  );

  const hasCustom = !!user?.customAvatarUrl;
  const telegramName = user?.firstName?.trim() || null;
  const customNow = user?.displayNameCustom?.trim() || null;

  const nameCheck = useMemo(() => validateDisplayName(name), [name]);
  const nameError = nameCheck.ok ? null : nameCheck.error;
  // A custom name equal to the Telegram name is pointless → treated as "no custom name".
  const desiredCustom = nameCheck.ok ? (nameCheck.value && nameCheck.value === telegramName ? null : nameCheck.value) : customNow;
  const nameDirty = nameCheck.ok && desiredCustom !== customNow;
  const pictureDirty = !!pending || (removeRequested && hasCustom);
  const dirty = nameDirty || pictureDirty;
  const canSave = dirty && !nameError && !saving && !preparing;

  // What the preview shows right now (priority: staged upload → current custom → [Telegram → initials]).
  const previewCustom = pending ? pending.previewUrl : removeRequested ? null : (user?.customAvatarUrl ?? null);
  const showRemove = !!pending || (hasCustom && !removeRequested);

  const onPickFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target;
    const file = input.files?.[0];
    if (!file) return;
    setError(null);
    const problem = precheckAvatar(file);
    if (problem) {
      input.value = "";
      setError(problem.message);
      return;
    }
    setPreparing(true);
    try {
      // Reads the file's bytes first, checks the REAL format, decodes, and builds the cropper's working copy.
      // Nothing is uploaded and nothing is staged until the user applies a crop.
      const img = await loadCropImage(file);
      setCropImage((prev) => {
        prev?.release();
        return img;
      });
    } catch (err) {
      if (err instanceof AvatarError) {
        // Diagnostic only (no user data): which stage failed and which decoders were tried.
        console.warn("avatar_open_failed", err.kind, err.detail ?? "");
      }
      setError(err instanceof AvatarError ? err.message : "We couldn't open this image. Please choose a different one.");
    } finally {
      input.value = ""; // allow re-selecting the same file later (after its bytes were read)
      setPreparing(false);
    }
  }, []);

  const closeCropper = useCallback(() => {
    setCropImage((prev) => {
      prev?.release();
      return null;
    });
  }, []);

  const onCropApplied = useCallback(
    (file: File) => {
      setPending((prev) => {
        if (prev) URL.revokeObjectURL(prev.previewUrl);
        return { file, previewUrl: URL.createObjectURL(file) };
      });
      setRemoveRequested(false);
      setError(null);
      closeCropper();
    },
    [closeCropper]
  );

  const onRemove = () => {
    setError(null);
    if (pending) {
      // Discard the staged picture; the saved picture (if any) is shown again.
      URL.revokeObjectURL(pending.previewUrl);
      setPending(null);
      return;
    }
    if (hasCustom) setRemoveRequested(true);
  };

  const onSave = async () => {
    if (!canSave || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      // Picture first, then name. Each step clears its own staged flag on success so a retry after a
      // partial failure never re-sends something that already succeeded.
      if (pending) {
        await uploadAvatar(pending.file);
        URL.revokeObjectURL(pending.previewUrl);
        setPending(null);
      } else if (removeRequested && hasCustom) {
        await removeAvatar();
        setRemoveRequested(false);
      }
      if (nameDirty) await saveDisplayName(desiredCustom ?? "");

      await refreshUser(); // the Profile Card updates immediately
      toast("Profile updated ✅");
      onDone();
    } catch (err) {
      // AvatarError messages are already user-safe and say which stage failed (validation / storage / network…).
      const message = err instanceof Error ? err.message : "Couldn't save your changes. Please try again.";
      setError(message);
      toast(message, "error");
      await refreshUser(); // reflect whatever part did succeed
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-5 animate-fade-in" data-testid="edit-profile-page">
      <h1 className="text-lg font-bold text-primary">Edit Profile</h1>

      {/* Picture */}
      <section className="bg-card rounded-3xl border border-app shadow-app-sm p-5 flex flex-col items-center gap-4">
        <div className="relative">
          <div style={{ boxShadow: "0 0 0 4px var(--color-bg-card), 0 0 0 5.5px rgba(255, 97, 21, 0.35)" }} className="rounded-full">
            <TelegramAvatar
              customUrl={previewCustom}
              photoUrl={user?.avatarUrl}
              firstName={name.trim() || user?.displayName || user?.firstName}
              username={user?.username}
              size={104}
              className="border-0"
            />
          </div>
          {preparing && (
            <div className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40">
              <Loader2 size={24} className="animate-spin text-white" aria-label="Preparing picture" />
            </div>
          )}
        </div>

        <input ref={fileRef} type="file" accept={AVATAR_ACCEPT} className="hidden" onChange={onPickFile} data-testid="avatar-input" />
        <div className="flex w-full items-center justify-center gap-2">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={saving || preparing}
            className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-brand-10 px-4 text-sm font-semibold text-brand disabled:opacity-50"
          >
            <Camera size={16} aria-hidden="true" />
            {hasCustom || pending ? "Change photo" : "Upload photo"}
          </button>
          {showRemove && (
            <button
              type="button"
              onClick={onRemove}
              disabled={saving || preparing}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-secondary px-4 text-sm font-semibold text-secondary disabled:opacity-50"
            >
              <Trash2 size={16} aria-hidden="true" />
              {pending ? "Discard" : "Remove"}
            </button>
          )}
        </div>
        <p className="text-center text-xs text-muted">
          {removeRequested && hasCustom
            ? user?.avatarUrl
              ? "Your Telegram photo will be used after you save."
              : "Your initials will be shown after you save."
            : "JPEG, PNG or WebP. You choose which part of the photo to show."}
        </p>
      </section>

      {/* Name + username */}
      <section className="bg-card rounded-3xl border border-app shadow-app-sm p-4 flex flex-col gap-4">
        <div>
          <label htmlFor="display-name" className="mb-1.5 block text-xs font-medium text-secondary">
            Display name
          </label>
          <input
            id="display-name"
            className="input-app text-base"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={telegramName ?? "Your name"}
            autoComplete="off"
            maxLength={DISPLAY_NAME_MAX * 2}
            aria-invalid={!!nameError}
            aria-describedby="display-name-help"
            disabled={saving}
          />
          <div id="display-name-help" className="mt-1.5 flex items-start justify-between gap-3 text-xs">
            <span className={nameError ? "text-red-500" : "text-muted"}>
              {nameError ?? "Shown on your profile and on your shared links. Leave empty to use your Telegram name."}
            </span>
            <span className="flex-shrink-0 tabular-nums text-muted">
              {Array.from(name.trim()).length}/{DISPLAY_NAME_MAX}
            </span>
          </div>
        </div>

        <div>
          <p className="mb-1.5 text-xs font-medium text-secondary">Username</p>
          <div
            className="flex min-h-11 items-center justify-between gap-3 rounded-xl border border-app bg-secondary px-3.5 text-sm"
            data-testid="username-readonly"
          >
            <span className="truncate text-secondary">{user?.username ? `@${user.username}` : "Not set on Telegram"}</span>
            <Lock size={14} className="flex-shrink-0 text-muted" role="img" aria-label="Username can't be changed" />
          </div>
        </div>
      </section>

      <div role="status" aria-live="polite" className="min-h-0">
        {error && (
          <p className="rounded-xl bg-red-50 px-3.5 py-2.5 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400" data-testid="edit-profile-error">
            {error}
          </p>
        )}
      </div>

      <button
        type="button"
        onClick={onSave}
        disabled={!canSave}
        className="btn-primary py-3 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
        data-testid="save-profile"
      >
        {saving ? (
          <span className="inline-flex items-center justify-center gap-2">
            <Loader2 size={16} className="animate-spin" aria-hidden="true" />
            Saving…
          </span>
        ) : (
          "Save Changes"
        )}
      </button>

      {cropImage && <AvatarCropper image={cropImage} onCancel={closeCropper} onApply={onCropApplied} />}
    </div>
  );
}
