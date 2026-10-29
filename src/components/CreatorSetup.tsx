"use client";
import React, { useEffect, useRef, useState } from "react";
import { Loader2, ShieldCheck, AlertCircle } from "lucide-react";
import { useApp } from "@/contexts/AppContext";
import { isRunningInsideTelegram } from "@/lib/telegramWebApp";
import ChannelConnectFlow from "@/components/ChannelConnectFlow";

/**
 * The dedicated Channel Connect screen, shown right after onboarding (and
 * whenever a returning creator has no verified channel yet). It silently
 * establishes the Telegram session (no separate "Continue with Telegram"
 * popup to tap through — Telegram's `initData` is already available the
 * moment the Mini App launches, so sign-in happens automatically) and then
 * renders the native two-step Telegram channel connection flow.
 */
export default function CreatorSetup() {
  const { authStatus, startTelegramLogin, refreshUser } = useApp();
  const [loginError, setLoginError] = useState<string | null>(null);
  const attemptedLogin = useRef(false);

  useEffect(() => {
    // One-time, automatic Telegram sign-in attempt when the Mini App first
    // launches signed-out inside Telegram — this replaces the old "Continue
    // with Telegram" tap-through screen with a silent background call,
    // since `initData` is already available the moment Telegram launches
    // the Mini App. Reading an external system (startTelegramLogin) and
    // only calling setState from its async callback (not synchronously in
    // the effect body) avoids cascading renders.
    if (authStatus === "guest" && isRunningInsideTelegram() && !attemptedLogin.current) {
      attemptedLogin.current = true;
      startTelegramLogin().then((result) => {
        if (!result.ok) {
          setLoginError(result.error ?? "Could not sign in with Telegram.");
          attemptedLogin.current = false;
        }
      });
    }
  }, [authStatus, startTelegramLogin]);

  const retryLogin = () => {
    attemptedLogin.current = false;
    setLoginError(null);
  };

  return (
    <div className="min-h-[100dvh] flex flex-col items-center justify-center px-6 bg-app gap-6">
      <div className="w-14 h-14 rounded-2xl gradient-brand flex items-center justify-center shadow-lg">
        <ShieldCheck size={26} color="white" />
      </div>

      {!isRunningInsideTelegram() ? (
        <div className="flex flex-col items-center gap-4 text-center max-w-sm">
          <h1 className="text-xl font-bold text-primary">Become an Onfile creator</h1>
          <div className="flex items-start gap-2 text-left text-xs text-secondary bg-secondary rounded-xl p-3">
            <AlertCircle size={14} className="mt-0.5 flex-shrink-0 text-brand" />
            <span>Open Onfile from inside Telegram to sign in and connect your channel. This screen cannot verify your identity in a regular browser tab.</span>
          </div>
        </div>
      ) : authStatus === "guest" ? (
        <div className="flex flex-col items-center gap-4 text-center max-w-sm">
          <h1 className="text-xl font-bold text-primary">Setting up your account</h1>
          {loginError ? (
            <>
              <p className="text-xs text-red-500">{loginError}</p>
              <button onClick={retryLogin} className="btn-primary w-full py-3 text-sm">
                Try Again
              </button>
            </>
          ) : (
            <div className="flex items-center gap-2 text-sm text-secondary">
              <Loader2 size={16} className="animate-spin" />
              Signing in with Telegram...
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-4 w-full max-w-sm">
          <div className="text-center">
            <h1 className="text-xl font-bold text-primary">Connect your channel</h1>
            <p className="text-sm text-secondary mt-1">
              Select the Telegram channel you want to share files from, then add Onfile as an administrator so it can post on your behalf.
            </p>
          </div>
          <ChannelConnectFlow onConnected={() => refreshUser()} />
        </div>
      )}
    </div>
  );
}
