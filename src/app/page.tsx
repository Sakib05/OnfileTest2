"use client";
import React, { useState, useEffect } from "react";
import Onboarding from "@/components/Onboarding";
import CreatorSetup from "@/components/CreatorSetup";
import BottomNav from "@/components/layout/BottomNav";
import HomeTab from "@/components/tabs/HomeTab";
import FilesTab from "@/components/tabs/FilesTab";
import CreateTab from "@/components/tabs/CreateTab";
import WalletTab from "@/components/tabs/WalletTab";
import ProfileTab from "@/components/tabs/ProfileTab";
import { useApp } from "@/contexts/AppContext";
import { getLaunchConnectRef } from "@/lib/botConnectClient";

export default function HomePage() {
  const { activeTab, setActiveTab, setProfileEntry, authStatus, channelStatus } = useApp();
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [onboardingChecked, setOnboardingChecked] = useState(false);

  useEffect(() => {
    // Launched by the bot's "Return to Onfile" button (`/?connect=<ref>`): the user is mid-way
    // through connecting a channel, so never interrupt them with onboarding (the Mini App may
    // be running with fresh browser storage), and — for an existing creator — land on the
    // channel connection screen instead of the dashboard. It only picks the SCREEN; the
    // request itself is verified server-side against the authenticated Telegram user.
    if (getLaunchConnectRef() !== null) {
      localStorage.setItem("onfile_onboarding_done", "1");
      setProfileEntry("channel");
      setActiveTab("profile");
    }
    const done = localStorage.getItem("onfile_onboarding_done");
    // One-time mount check reading a browser-only API (localStorage);
    // cannot be computed during render/SSR. This only gates which screen we
    // render first — it never grants authentication or creator status on
    // its own (that always comes from the server-side session / channel
    // checks below).
    if (!done) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setShowOnboarding(true);
    }
    setOnboardingChecked(true);
    // Mount-only: reads browser-only state exactly once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const completeOnboarding = () => {
    localStorage.setItem("onfile_onboarding_done", "1");
    setShowOnboarding(false);
  };

  if (!onboardingChecked || authStatus === "loading") return null;

  if (showOnboarding) {
    // Onboarding completion navigates straight into the Channel Connect
    // screen below (via CreatorSetup) — there is no separate intermediate
    // popup in between.
    return <Onboarding onComplete={completeOnboarding} />;
  }

  // Visitors never get a dashboard (and never get a persistent creator
  // account) until Telegram sign-in + channel verification succeed.
  if (authStatus !== "authenticated") {
    return <CreatorSetup />;
  }

  // Returning creator with a session, but no verified channel yet (e.g. they
  // disconnected their only channel, or setup was interrupted). Resume at
  // the Channel Connect screen instead of the dashboard — never trusted
  // from localStorage, always derived from the live `channels` table.
  if (channelStatus === "unknown") return null;
  if (channelStatus === "no_channel") {
    return <CreatorSetup />;
  }

  return (
    <div className="min-h-screen bg-app flex flex-col">
      {/* Main Content */}
      <main className="flex-1 max-w-lg mx-auto w-full px-4 pt-6 pb-28">
        {activeTab === "home" && (
          <HomeTab onTabChange={setActiveTab} />
        )}
        {activeTab === "files" && (
          <FilesTab onCreateClick={() => setActiveTab("create")} />
        )}
        {activeTab === "create" && (
          <CreateTab onSuccess={() => setActiveTab("files")} />
        )}
        {activeTab === "wallet" && (
          <WalletTab />
        )}
        {activeTab === "profile" && (
          <ProfileTab />
        )}
      </main>

      {/* Bottom Navigation */}
      <BottomNav />
    </div>
  );
}
