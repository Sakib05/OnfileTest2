"use client";
import React from "react";
import { Lock } from "lucide-react";
import { useApp } from "@/contexts/AppContext";

function formatMemberSince(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

/** Account Information: the creator's own account details, read-only (edit name/picture in Edit Profile). */
export default function AccountInfo({ onEditProfile }: { onEditProfile: () => void }) {
  const { user } = useApp();
  const rows: { label: string; value: string; locked?: boolean }[] = [
    { label: "Display name", value: user?.firstName || "Creator" },
    { label: "Telegram username", value: user?.username ? `@${user.username}` : "Not set on Telegram", locked: true },
    { label: "Telegram ID", value: user?.telegramId ?? "—", locked: true },
    { label: "Member since", value: formatMemberSince(user?.createdAt) },
    { label: "Referral code", value: user?.referralCode ?? "—" },
  ];
  return (
    <div className="flex flex-col gap-5 animate-fade-in">
      <div>
        <h1 className="text-lg font-bold text-primary">Account Information</h1>
        <p className="text-xs text-secondary mt-0.5">Details of your Onfile creator account</p>
      </div>
      <div className="bg-card rounded-2xl border border-app shadow-app-sm overflow-hidden">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center justify-between gap-3 px-4 py-3.5 border-b border-app last:border-0">
            <span className="text-sm text-secondary flex-shrink-0">{r.label}</span>
            <span className="text-sm font-medium text-primary truncate flex items-center gap-1.5">
              {r.value}
              {r.locked && <Lock size={12} className="text-muted flex-shrink-0" aria-label="Read-only" />}
            </span>
          </div>
        ))}
      </div>
      <p className="text-xs text-muted px-1">
        Your Telegram username and ID come from Telegram and can’t be edited in Onfile. You can change your display name and
        profile picture in Edit Profile.
      </p>
      <button onClick={onEditProfile} className="btn-secondary min-h-12 py-3 text-sm font-semibold">
        Edit Profile
      </button>
    </div>
  );
}
