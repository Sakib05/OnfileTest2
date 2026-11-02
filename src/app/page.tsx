"use client";
import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Onboarding from "@/components/Onboarding";
import CreatorSetup from "@/components/CreatorSetup";
import BottomNav from "@/components/layout/BottomNav";
import HomeTab from "@/components/tabs/HomeTab";
import FilesTab from "@/components/tabs/FilesTab";
import CreateTab from "@/components/tabs/CreateTab";
import WalletTab from "@/components/tabs/WalletTab";
import ProfileTab from "@/components/tabs/ProfileTab";
import { useApp } from "@/contexts/AppContext";
import { getTelegramStartParam, initTelegramMiniApp } from "@/lib/telegramWebApp";
import { parseFileStartParam } from "@/lib/miniAppLink";

export default function HomePage() {
  const { activeTab, setActiveTab, authStatus, channelStatus } = useApp();
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [onboardingChecked, setOnboardingChecked] = useState(false);
  const router = useRouter();
  // Set when this launch is a "open file" Mini App deep link
  // (t.me/<bot>/<app>?startapp=f_<slug>); we render nothing while redirecting
  // so the creator dashboard / onboarding never flashes for a file visitor.
  const [fileLaunchSlug, setFileLaunchSlug] = useState<string | null>(null);

  useEffect(() => {
    // Mini App deep link -> File Access page, inside this same Telegram
    // Mini App WebView. The start param is untrusted, so it is strictly
    // validated; anything that is not `f_<slug>` is ignored and the normal
    // entry flow runs unchanged. All access checks stay on /f/[slug].
    const slug = parseFileStartParam(getTelegramStartParam());
    if (!slug) return;
    initTelegramMiniApp();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time read of a browser-only launch parameter
    setFileLaunchSlug(slug);
    router.replace(`/f/${slug}`);
  }, [router]);

  useEffect(() => {
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
  }, []);

  const completeOnboarding = () => {
    localStorage.setItem("onfile_onboarding_done", "1");
    setShowOnboarding(false);
  };

  if (fileLaunchSlug) return null;
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
