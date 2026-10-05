"use client";
import React, { useState, useEffect } from "react";
import Onboarding from "@/components/Onboarding";
import BottomNav from "@/components/layout/BottomNav";
import HomeTab from "@/components/tabs/HomeTab";
import FilesTab from "@/components/tabs/FilesTab";
import CreateTab from "@/components/tabs/CreateTab";
import WalletTab from "@/components/tabs/WalletTab";
import ProfileTab from "@/components/tabs/ProfileTab";
import { useApp } from "@/contexts/AppContext";

export default function HomePage() {
  const { activeTab, setActiveTab } = useApp();
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [onboardingChecked, setOnboardingChecked] = useState(false);

  useEffect(() => {
    const done = localStorage.getItem("onfile_onboarding_done");
    if (!done) {
      setShowOnboarding(true);
    }
    setOnboardingChecked(true);
  }, []);

  const completeOnboarding = () => {
    localStorage.setItem("onfile_onboarding_done", "1");
    setShowOnboarding(false);
  };

  if (!onboardingChecked) return null;

  if (showOnboarding) {
    return <Onboarding onComplete={completeOnboarding} />;
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
