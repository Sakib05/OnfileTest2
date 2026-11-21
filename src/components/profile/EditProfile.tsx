"use client";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Camera, Loader2, Lock, X } from "lucide-react";
import { useApp } from "@/contexts/AppContext";
import { useToast } from "@/components/ui/Toast";
import TelegramAvatar from "@/components/ui/TelegramAvatar";
import {
  checkProfileImageFile,
  DISPLAY_NAME_MAX,
  PROFILE_IMAGE_ACCEPT,
  PROFILE_IMAGE_MAX_LABEL,
  validateDisplayName,
} from "@/lib/profile";

/**
 * Edit Profile: Display Name (editable), profile picture (upload / change / preview / cancel / remove) and Telegram
 * username (read-only — there is deliberately no control and no API for changing it). All checks here are for fast
 * feedback; the server re-validates everything. Has no back control of its own (Telegram's native Back is used).
 */
export default function EditProfile({ onDone }: { onDone: () => void }) {
  const { user, refreshUser } = useApp();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const savedName = user?.firstName ?? "";
  const [name, setName] = useState(savedName);
  const [nameError, setNameError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Revoke the object URL when the selection changes or the screen closes.
  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- derived from the selected File, revoked on cleanup
    setPreview(url);
    return () => {
      URL.revokeObjectURL(url);
      setPreview(null);
    };
  }, [file]);

  const nameChanged = name.trim() !== savedName.trim();
  const dirty = nameChanged || !!file;

  const pickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file after a cancel
    if (!picked) return;
    const check = checkProfileImageFile(picked);
    if (!check.ok) {
      setFile(null);
      setImageError(check.error);
      return;
    }
    setImageError(null);
    setFormError(null);
    setFile(picked);
  };

  const cancelImage = () => {
    setFile(null);
    setImageError(null);
  };

  const save = useCallback(async () => {
    setFormError(null);
    let nameValue: string | null = null;
    if (nameChanged) {
      const check = validateDisplayName(name);
      if (!check.ok) {
        setNameError(check.error);
        return;
      }
      nameValue = check.value;
    }
    setNameError(null);
    setSaving(true);
    try {
      // 1) picture
      if (file) {
        const body = new FormData();
        body.append("file", file);
        const res = await fetch("/api/user/avatar", { method: "POST", body });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setImageError(data.error || "Profile picture upload failed. Please try again.");
          setFormError(data.error || "Profile picture upload failed. Please try again.");
          toast(data.error || "Profile picture upload failed", "error");
          return;
        }
        setFile(null);
      }
      // 2) name
      if (nameValue !== null) {
        const res = await fetch("/api/user/me", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ displayName: nameValue }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setNameError(data.error || "Couldn't save your name. Please try again.");
          toast(data.error || "Couldn't save your name", "error");
          await refreshUser(); // the picture may already have been saved
          return;
        }
      }
      await refreshUser();
      toast("Profile updated! ✅");
      onDone();
    } catch {
      setFormError("Network error. Please check your connection and try again.");
      toast("Network error. Please try again.", "error");
    } finally {
      setSaving(false);
    }
  }, [file, name, nameChanged, onDone, refreshUser, toast]);

  const removeUploaded = async () => {
    setRemoving(true);
    try {
      const res = await fetch("/api/user/avatar", { method: "DELETE" });
      if (!res.ok) {
        toast("Couldn't remove your picture. Please try again.", "error");
        return;
      }
      await refreshUser();
      toast("Profile picture removed");
    } catch {
      toast("Network error. Please try again.", "error");
    } finally {
      setRemoving(false);
    }
  };

  const busy = saving || removing;

  return (
    <div className="flex flex-col gap-5 animate-fade-in">
      <div>
        <h1 className="text-lg font-bold text-primary">Edit Profile</h1>
        <p className="text-xs text-secondary mt-0.5">Update how you appear to people who open your links</p>
      </div>

      {/* Picture */}
      <div className="bg-card rounded-2xl p-4 border border-app shadow-app-sm flex flex-col items-center gap-3">
        <div className="relative">
          {preview ? (
            // Local blob preview of the selected image (not yet saved).
            <div className="rounded-full overflow-hidden border border-app bg-secondary" style={{ width: 96, height: 96 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={preview} alt="Selected profile picture preview" className="w-full h-full object-cover" data-testid="avatar-preview" />
            </div>
          ) : (
            <TelegramAvatar photoUrl={user?.avatarUrl} firstName={user?.firstName} username={user?.username} size={96} />
          )}
          <button
            type="button"
            aria-label="Change profile photo"
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            className="absolute -bottom-1 -right-1 w-9 h-9 rounded-full gradient-brand flex items-center justify-center border-2 border-[var(--color-bg-card)] disabled:opacity-60"
          >
            <Camera size={15} color="white" />
          </button>
          <input ref={fileRef} type="file" accept={PROFILE_IMAGE_ACCEPT} className="hidden" onChange={pickFile} data-testid="avatar-input" />
        </div>

        {file ? (
          <div className="flex flex-col items-center gap-1">
            <p className="text-xs text-secondary max-w-[240px] truncate">{file.name}</p>
            <button type="button" onClick={cancelImage} disabled={busy} className="inline-flex items-center gap-1 text-xs font-semibold text-red-500 min-h-9 px-3">
              <X size={12} /> Cancel selection
            </button>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-0.5">
            <button type="button" onClick={() => fileRef.current?.click()} disabled={busy} className="text-sm font-semibold text-brand min-h-9 px-3">
              {user?.hasCustomAvatar ? "Change photo" : "Upload photo"}
            </button>
            {user?.hasCustomAvatar && (
              <button type="button" onClick={removeUploaded} disabled={busy} className="text-xs text-secondary min-h-9 px-3 inline-flex items-center gap-1">
                {removing && <Loader2 size={12} className="animate-spin" />} Remove uploaded photo
              </button>
            )}
          </div>
        )}
        <p className="text-xs text-muted text-center">JPG, PNG or WebP · up to {PROFILE_IMAGE_MAX_LABEL}</p>
        {imageError && (
          <p className="text-xs text-red-500 text-center" role="alert">
            {imageError}
          </p>
        )}
      </div>

      {/* Details */}
      <div className="bg-card rounded-2xl p-4 border border-app shadow-app-sm flex flex-col gap-4">
        <div>
          <label htmlFor="display-name" className="text-xs font-medium text-secondary mb-1.5 block">
            Display Name
          </label>
          <input
            id="display-name"
            className="input-app text-sm min-h-11"
            value={name}
            maxLength={DISPLAY_NAME_MAX + 20}
            onChange={(e) => {
              setName(e.target.value);
              setNameError(null);
            }}
            autoComplete="off"
            aria-invalid={!!nameError}
            aria-describedby="display-name-help"
            disabled={busy}
          />
          <div id="display-name-help" className="flex items-start justify-between gap-2 mt-1">
            <p className={nameError ? "text-xs text-red-500" : "text-xs text-muted"} role={nameError ? "alert" : undefined}>
              {nameError ?? "Shown on your files and playlists."}
            </p>
            <span className="text-xs text-muted flex-shrink-0">
              {Array.from(name.trim()).length}/{DISPLAY_NAME_MAX}
            </span>
          </div>
        </div>

        <div>
          <label htmlFor="tg-username" className="text-xs font-medium text-secondary mb-1.5 block">
            Telegram Username
          </label>
          <div className="relative">
            <input
              id="tg-username"
              className="input-app text-sm min-h-11 pr-9 opacity-80"
              value={user?.username ? `@${user.username}` : "Not set on Telegram"}
              readOnly
              aria-readonly="true"
              tabIndex={-1}
              onFocus={(e) => e.currentTarget.blur()}
            />
            <Lock size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted" />
          </div>
          <p className="text-xs text-muted mt-1">Read-only. Your username comes from your Telegram account and can’t be changed in Onfile.</p>
        </div>
      </div>

      {formError && (
        <p className="text-xs text-red-500 text-center" role="alert">
          {formError}
        </p>
      )}

      <button onClick={save} disabled={!dirty || busy} className="btn-primary min-h-12 py-3 text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50">
        {saving && <Loader2 size={15} className="animate-spin" />}
        {saving ? "Saving…" : "Save Changes"}
      </button>
    </div>
  );
}
