"use client";
import React, { useState } from "react";
import { MessageCircle, Loader2, ShieldCheck, AlertCircle } from "lucide-react";
import { useApp } from "@/contexts/AppContext";
import { isRunningInsideTelegram } from "@/lib/telegramWebApp";

/**
 * Shown after onboarding when there is no authenticated creator session.
 * Handles both halves of account setup:
 *   1. Telegram sign-in (initData -> session or setup cookie)
 *   2. Channel connection + verification (which is what actually finalizes
 *      a brand-new creator account — see /api/channels)
 */
export default function CreatorSetup() {
  const { authStatus, setupProfile, startTelegramLogin, refreshUser } = useApp();
  const [loggingIn, setLoggingIn] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  const [channelInput, setChannelInput] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);

  const handleTelegramLogin = async () => {
    setLoggingIn(true);
    setLoginError(null);
    const result = await startTelegramLogin();
    if (!result.ok) {
      setLoginError(result.error ?? "Could not sign in with Telegram.");
    }
    setLoggingIn(false);
  };

  const handleConnectChannel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!channelInput.trim()) return;
    setConnecting(true);
    setConnectError(null);
    try {
      const res = await fetch("/api/channels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channelIdentifier: channelInput.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setConnectError(data.error || "Channel verification failed.");
        setConnecting(false);
        return;
      }
      await refreshUser();
    } catch {
      setConnectError("Network error. Please try again.");
    }
    setConnecting(false);
  };

  return (
    <div className="min-h-[100dvh] flex flex-col items-center justify-center px-6 bg-app gap-6">
      <div className="w-14 h-14 rounded-2xl gradient-brand flex items-center justify-center shadow-lg">
        <ShieldCheck size={26} color="white" />
      </div>

      {authStatus !== "setup_required" ? (
        <div className="flex flex-col items-center gap-4 text-center max-w-sm">
          <h1 className="text-xl font-bold text-primary">Become an Onfile creator</h1>
          <p className="text-sm text-secondary">
            Sign in with your Telegram account to start sharing and monetizing files from your own channel.
          </p>
          {!isRunningInsideTelegram() && (
            <div className="flex items-start gap-2 text-left text-xs text-secondary bg-secondary rounded-xl p-3">
              <AlertCircle size={14} className="mt-0.5 flex-shrink-0 text-brand" />
              <span>Open Onfile from inside Telegram to sign in securely. This screen cannot verify your identity in a regular browser tab.</span>
            </div>
          )}
          <button
            onClick={handleTelegramLogin}
            disabled={loggingIn}
            className="btn-primary w-full py-3 text-sm flex items-center justify-center gap-2"
          >
            {loggingIn ? <Loader2 size={16} className="animate-spin" /> : <MessageCircle size={16} />}
            {loggingIn ? "Signing in..." : "Continue with Telegram"}
          </button>
          {loginError && <p className="text-xs text-red-500">{loginError}</p>}
        </div>
      ) : (
        <div className="flex flex-col gap-4 w-full max-w-sm">
          <div className="text-center">
            <h1 className="text-xl font-bold text-primary">
              {setupProfile?.firstName ? `Hi ${setupProfile.firstName}, almost there` : "Almost there"}
            </h1>
            <p className="text-sm text-secondary mt-1">
              Connect the Telegram channel you want to share files from. Our bot must be an administrator of that channel.
            </p>
          </div>
          <ol className="flex flex-col gap-2 text-xs text-secondary list-decimal list-inside bg-secondary rounded-xl p-3">
            <li>Add our Onfile bot as an administrator of your channel.</li>
            <li>Make sure it can post messages.</li>
            <li>Enter your channel username or link below.</li>
          </ol>
          <form onSubmit={handleConnectChannel} className="flex flex-col gap-3">
            <input
              className="input-app text-sm"
              placeholder="@your_channel or https://t.me/your_channel"
              value={channelInput}
              onChange={(e) => setChannelInput(e.target.value)}
            />
            <button type="submit" disabled={connecting} className="btn-primary py-3 text-sm flex items-center justify-center gap-2">
              {connecting ? <Loader2 size={16} className="animate-spin" /> : null}
              {connecting ? "Verifying..." : "Connect & Verify Channel"}
            </button>
          </form>
          {connectError && <p className="text-xs text-red-500 text-center">{connectError}</p>}
        </div>
      )}
    </div>
  );
}
