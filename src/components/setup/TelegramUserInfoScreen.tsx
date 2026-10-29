"use client";
import React from "react";
import { UserRound, AtSign, ShieldCheck } from "lucide-react";

export interface TelegramDisplayProfile {
  firstName: string | null;
  lastName: string | null;
  username: string | null;
}

/**
 * Step A of the required onboarding journey: shows the Telegram identity
 * Onfile already trusts (verified server-side via `initData`'s HMAC
 * signature — see src/lib/auth.ts). Both fields are strictly read-only;
 * this screen never lets the user edit their Telegram name/username, and
 * never asks them to sign in again — it only reflects the already-verified
 * session/setup state back to them before they continue.
 */
export default function TelegramUserInfoScreen({
  profile,
  onNext,
}: {
  profile: TelegramDisplayProfile;
  onNext: () => void;
}) {
  const fullName = [profile.firstName, profile.lastName].filter(Boolean).join(" ").trim();
  const displayName = fullName || "Telegram User";
  const hasUsername = !!profile.username;

  return (
    <div className="flex flex-col gap-6 w-full max-w-sm">
      <div className="text-center">
        <div className="w-14 h-14 rounded-2xl gradient-brand flex items-center justify-center shadow-lg mx-auto mb-4">
          <UserRound size={26} color="white" />
        </div>
        <h1 className="text-xl font-bold text-primary">Your Telegram account</h1>
        <p className="text-sm text-secondary mt-1">
          Onfile uses the Telegram account you&apos;re signed in with. Review it below, then continue.
        </p>
      </div>

      <div className="bg-card rounded-2xl border border-app shadow-app-sm p-4 flex flex-col gap-3">
        <InfoRow icon={UserRound} label="Name" value={displayName} />
        <div className="h-px bg-app" />
        <InfoRow
          icon={AtSign}
          label="Username"
          value={hasUsername ? `@${profile.username}` : "No username set on Telegram"}
          muted={!hasUsername}
        />
      </div>

      <div className="flex items-start gap-2 text-left text-[11px] text-muted px-1">
        <ShieldCheck size={13} className="mt-0.5 flex-shrink-0" />
        <span>This information comes from your verified Telegram sign-in and can&apos;t be edited here.</span>
      </div>

      <button onClick={onNext} className="btn-primary w-full py-3.5 text-sm font-semibold">
        Next
      </button>
    </div>
  );
}

function InfoRow({
  icon: Icon,
  label,
  value,
  muted,
}: {
  icon: React.FC<{ size: number; className?: string }>;
  label: string;
  value: string;
  muted?: boolean;
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="w-9 h-9 rounded-xl bg-secondary flex items-center justify-center flex-shrink-0">
        <Icon size={16} className="text-brand" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-secondary">{label}</p>
        <p className={`text-sm font-semibold truncate ${muted ? "text-muted italic" : "text-primary"}`}>{value}</p>
      </div>
    </div>
  );
}
