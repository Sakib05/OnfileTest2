"use client";
import React, { useEffect, useRef, useState } from "react";
import { BadgeCheck, Check, Copy, Pencil } from "lucide-react";
import TelegramAvatar from "@/components/ui/TelegramAvatar";
import { useToast } from "@/components/ui/Toast";
import { copyText } from "@/lib/playlistShareClient";
import { DISPLAY_NAME_FALLBACK } from "@/lib/profile/identity";
import { cn } from "@/lib/utils";
import type { UserProfile } from "@/contexts/AppContext";

interface ProfileCardProps {
  user: UserProfile | null;
  /** Shown only for users with a verified, connected channel (i.e. active creators). */
  isCreator: boolean;
  onEdit: () => void;
}

/**
 * Account identity card at the top of the Me tab: picture, display name, Creator badge, Telegram User ID
 * (+ copy) and an Edit Profile pencil. Deliberately NO statistics.
 *
 * - The ID shown/copied is `user.telegramId` (the real Telegram id from the server session) — never `user.id`.
 * - Avatar priority is handled by <TelegramAvatar/>: Telegram photo → initials (a custom picture would come first,
 *   but custom pictures are temporarily disabled — see src/lib/profile/featureFlags.ts).
 * - Fixed avatar size + a skeleton while `user` is null keep the card height stable during load.
 */
export default function ProfileCard({ user, isCreator, onEdit }: ProfileCardProps) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (resetTimer.current) clearTimeout(resetTimer.current); }, []);

  const telegramId = user?.telegramId ? String(user.telegramId) : null;
  const name = user?.displayName?.trim() || user?.firstName?.trim() || DISPLAY_NAME_FALLBACK;

  const handleCopy = async () => {
    if (!telegramId) return;
    // Copies ONLY the digits — no "ID:" label, no whitespace.
    const ok = await copyText(telegramId);
    if (ok) {
      setCopied(true);
      toast("Telegram ID copied");
      if (resetTimer.current) clearTimeout(resetTimer.current);
      resetTimer.current = setTimeout(() => setCopied(false), 1600);
    } else {
      toast("Couldn't copy automatically. Press and hold the ID to copy it.", "error");
    }
  };

  return (
    <section
      aria-label="Your profile"
      data-testid="profile-card"
      className="bg-card rounded-3xl border border-app shadow-app-sm p-4"
    >
      <div className="flex items-center gap-3.5">
        {/* Avatar with a soft brand ring (inset gap keeps it crisp on light + dark cards). */}
        <div
          className="rounded-full flex-shrink-0"
          style={{ boxShadow: "0 0 0 3px var(--color-bg-card), 0 0 0 4.5px rgba(255, 97, 21, 0.35)" }}
        >
          <TelegramAvatar
            customUrl={user?.customAvatarUrl}
            photoUrl={user?.avatarUrl}
            firstName={user?.displayName || user?.firstName}
            username={user?.username}
            size={68}
            className="border-0"
          />
        </div>

        <div className="flex-1 min-w-0">
          {user ? (
            <h2 data-testid="profile-name" className="text-[19px] leading-tight font-bold text-primary truncate">
              {name}
            </h2>
          ) : (
            <div className="h-5 w-32 rounded-md bg-secondary animate-pulse" aria-hidden="true" />
          )}

          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
            {isCreator && (
              <span
                data-testid="creator-badge"
                className="inline-flex items-center gap-1 rounded-full bg-brand-10 px-2 py-0.5 text-[11px] font-semibold leading-4 text-brand"
              >
                <BadgeCheck size={12} strokeWidth={2.5} aria-hidden="true" />
                Creator
              </span>
            )}

            {user && (
              <span className="inline-flex items-center min-w-0">
                <span data-testid="profile-id" className="text-[13px] leading-5 text-secondary tabular-nums select-text">
                  ID: {telegramId ?? "—"}
                </span>
                {telegramId && (
                  <button
                    type="button"
                    onClick={handleCopy}
                    aria-label={copied ? "Telegram ID copied" : "Copy Telegram ID"}
                    data-testid="copy-id"
                    // 36px tap target; negative margins keep the visual footprint of a small inline icon.
                    className="ml-0.5 -my-1.5 inline-flex h-9 w-9 items-center justify-center rounded-full text-secondary active:bg-secondary transition-colors"
                  >
                    {copied ? (
                      <Check size={14} strokeWidth={2.5} className="text-green-500" aria-hidden="true" />
                    ) : (
                      <Copy size={14} aria-hidden="true" />
                    )}
                  </button>
                )}
              </span>
            )}
          </div>
        </div>

        <button
          type="button"
          onClick={onEdit}
          aria-label="Edit profile"
          data-testid="edit-profile"
          className={cn(
            "flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full",
            "bg-brand-10 text-brand active:scale-95 transition-transform"
          )}
        >
          <Pencil size={18} aria-hidden="true" />
        </button>
      </div>
    </section>
  );
}
