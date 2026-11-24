"use client";
import React, { useMemo, useRef, useState } from "react";
import { Loader2, Lock } from "lucide-react";
import TelegramAvatar from "@/components/ui/TelegramAvatar";
import { useToast } from "@/components/ui/Toast";
import { useApp } from "@/contexts/AppContext";
import { DISPLAY_NAME_MAX, validateDisplayName } from "@/lib/profile/identity";
import { saveDisplayName } from "@/lib/profile/avatarClient";

/**
 * Edit Profile (opened from the pencil on the Profile Card).
 *
 *   • name     — custom display name (empty → the Telegram name again). The ONLY editable field.
 *   • username — read-only (managed by Telegram), shown with a small lock icon.
 *   • picture  — display only: Telegram photo → initial-letter avatar. Custom picture upload is intentionally
 *                not offered for now (the backend avatar endpoints/columns are kept, but have no UI entry point).
 *
 * Saving goes through the existing authenticated PATCH /api/user/me. Back navigation is handled by Telegram's
 * native BackButton registered in ProfileTab.
 */
export default function EditProfile({ onDone }: { onDone: () => void }) {
  const { user, refreshUser } = useApp();
  const { toast } = useToast();

  const [name, setName] = useState(user?.displayName ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const savingRef = useRef(false); // synchronous guard against double-taps / duplicate submissions

  const telegramName = user?.firstName?.trim() || null;
  const customNow = user?.displayNameCustom?.trim() || null;

  const nameCheck = useMemo(() => validateDisplayName(name), [name]);
  const nameError = nameCheck.ok ? null : nameCheck.error;
  // A custom name equal to the Telegram name is pointless → treated as "no custom name".
  const desiredCustom = nameCheck.ok ? (nameCheck.value && nameCheck.value === telegramName ? null : nameCheck.value) : customNow;
  const dirty = nameCheck.ok && desiredCustom !== customNow;
  const canSave = dirty && !nameError && !saving;

  const onSave = async () => {
    if (!canSave || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      await saveDisplayName(desiredCustom ?? "");
      await refreshUser(); // the Profile Card updates immediately
      toast("Profile updated ✅");
      onDone();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Couldn't save your changes. Please try again.";
      setError(message);
      toast(message, "error");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-5 animate-fade-in" data-testid="edit-profile-page">
      <h1 className="text-lg font-bold text-primary">Edit Profile</h1>

      {/* Avatar (display only): Telegram photo → initials */}
      <section className="bg-card rounded-3xl border border-app shadow-app-sm p-5 flex flex-col items-center gap-3">
        <div style={{ boxShadow: "0 0 0 4px var(--color-bg-card), 0 0 0 5.5px rgba(255, 97, 21, 0.35)" }} className="rounded-full">
          <TelegramAvatar
            photoUrl={user?.avatarUrl}
            firstName={name.trim() || user?.displayName || user?.firstName}
            username={user?.username}
            size={104}
            className="border-0"
          />
        </div>
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
            className="flex min-h-11 items-center gap-1.5 rounded-xl border border-app bg-secondary px-3.5 text-sm"
            data-testid="username-readonly"
          >
            <span className="truncate text-secondary">{user?.username ? `@${user.username}` : "Not set on Telegram"}</span>
            <Lock size={13} strokeWidth={2} className="flex-shrink-0 text-muted" aria-label="Read-only" data-testid="username-lock" />
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
    </div>
  );
}
