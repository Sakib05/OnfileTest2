"use client";
import React, { useEffect, useRef, useState } from "react";
import { Loader2, ShieldCheck, AlertCircle } from "lucide-react";
import { useApp } from "@/contexts/AppContext";
import { isRunningInsideTelegram } from "@/lib/telegramWebApp";
import type { ConnectedChannel } from "@/lib/useChannelConnect";
import TelegramUserInfoScreen from "@/components/setup/TelegramUserInfoScreen";
import ChannelConnectScreen from "@/components/setup/ChannelConnectScreen";
import BotConnectInstructions from "@/components/setup/BotConnectInstructions";
import HowToConnectGuide from "@/components/setup/HowToConnectGuide";
import ChannelConnectSuccessScreen from "@/components/setup/ChannelConnectSuccessScreen";
import Faq from "@/components/Faq";

type SetupStep = "telegram_info" | "channel_connect" | "bot_instructions" | "how_to" | "faq" | "success";

/**
 * Orchestrates the required onboarding journey once Telegram sign-in has
 * resolved: Telegram User Information -> Channel Connect -> Channel
 * Verification -> Success -> Main Application (src/app/page.tsx takes over
 * once a verified channel exists). Shown right after onboarding for
 * brand-new creators, and whenever a returning creator currently has no
 * verified channel (e.g. they disconnected it, or setup was interrupted).
 *
 * It silently establishes the Telegram session (no separate "Continue with
 * Telegram" popup to tap through — `initData` is already available the
 * moment the Mini App launches) and then walks the creator through the
 * screens below.
 */
export default function CreatorSetup() {
  const { authStatus, user, setupProfile, startTelegramLogin, refreshUser } = useApp();
  const [loginError, setLoginError] = useState<string | null>(null);
  const attemptedLogin = useRef(false);

  const [step, setStep] = useState<SetupStep>("channel_connect");
  const [connectedChannel, setConnectedChannel] = useState<ConnectedChannel | null>(null);
  const initializedStep = useRef(false);

  useEffect(() => {
    // One-time, automatic Telegram sign-in attempt when the Mini App first
    // launches signed-out inside Telegram — this replaces the old "Continue
    // with Telegram" tap-through screen with a silent background call,
    // since `initData` is already available the moment Telegram launches
    // the Mini App.
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

  useEffect(() => {
    // Decide where a creator who just became identifiable (either a brand
    // new Telegram identity, or a returning account missing a verified
    // channel) should start. New identities see the Telegram User
    // Information screen first (part of the required onboarding journey);
    // returning accounts (who have already seen it before) go straight to
    // Channel Connect — never repeating a step unnecessarily.
    if (initializedStep.current) return;
    if (authStatus === "setup_required") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStep("telegram_info");
      initializedStep.current = true;
    } else if (authStatus === "authenticated") {
      setStep("channel_connect");
      initializedStep.current = true;
    }
  }, [authStatus]);

  const retryLogin = () => {
    attemptedLogin.current = false;
    setLoginError(null);
  };

  const handleManualOrBotConnected = (channel: ConnectedChannel) => {
    setConnectedChannel(channel);
    setStep("success");
  };

  const handleContinueToOnfile = () => {
    // Only now — after the success screen has been explicitly acknowledged
    // — do we refresh the authenticated/channel state, which flips
    // src/app/page.tsx over to the main application.
    refreshUser();
  };

  if (!isRunningInsideTelegram()) {
    return (
      <div className="min-h-[100dvh] flex flex-col items-center justify-center px-6 bg-app gap-6">
        <div className="w-14 h-14 rounded-2xl gradient-brand flex items-center justify-center shadow-lg">
          <ShieldCheck size={26} color="white" />
        </div>
        <div className="flex flex-col items-center gap-4 text-center max-w-sm">
          <h1 className="text-xl font-bold text-primary">Become an Onfile creator</h1>
          <div className="flex items-start gap-2 text-left text-xs text-secondary bg-secondary rounded-xl p-3">
            <AlertCircle size={14} className="mt-0.5 flex-shrink-0 text-brand" />
            <span>Open Onfile from inside Telegram to sign in and connect your channel. This screen cannot verify your identity in a regular browser tab.</span>
          </div>
        </div>
      </div>
    );
  }

  if (authStatus === "guest" || authStatus === "loading") {
    return (
      <div className="min-h-[100dvh] flex flex-col items-center justify-center px-6 bg-app gap-6">
        <div className="w-14 h-14 rounded-2xl gradient-brand flex items-center justify-center shadow-lg">
          <ShieldCheck size={26} color="white" />
        </div>
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
      </div>
    );
  }

  const telegramProfile = {
    firstName: setupProfile?.firstName ?? user?.firstName ?? null,
    lastName: setupProfile?.lastName ?? user?.lastName ?? null,
    username: setupProfile?.username ?? user?.username ?? null,
  };

  return (
    <div className="min-h-[100dvh] flex flex-col items-center justify-center px-6 bg-app gap-6 py-10">
      {step === "telegram_info" && (
        <TelegramUserInfoScreen profile={telegramProfile} onNext={() => setStep("channel_connect")} />
      )}

      {step === "channel_connect" && (
        <ChannelConnectScreen
          onConnectViaBot={() => setStep("bot_instructions")}
          onManualConnected={handleManualOrBotConnected}
          onWhyConnect={() => setStep("faq")}
          onHowToConnect={() => setStep("how_to")}
        />
      )}

      {step === "bot_instructions" && (
        <BotConnectInstructions onBack={() => setStep("channel_connect")} onSuccess={handleManualOrBotConnected} />
      )}

      {step === "how_to" && <HowToConnectGuide onBack={() => setStep("channel_connect")} />}

      {step === "faq" && (
        <div className="w-full max-w-sm">
          <Faq
            onBack={() => setStep("channel_connect")}
            highlightSection="connect"
            backLabel="Back to Channel Connect"
          />
        </div>
      )}

      {step === "success" && connectedChannel && (
        <ChannelConnectSuccessScreen channel={connectedChannel} onContinue={handleContinueToOnfile} />
      )}
    </div>
  );
}
