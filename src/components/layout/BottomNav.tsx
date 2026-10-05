"use client";
import React from "react";
import { Home, Files, PlusCircle, Wallet, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { useApp } from "@/contexts/AppContext";

const tabs = [
  { id: "home", icon: Home, label: "Home" },
  { id: "files", icon: Files, label: "Files" },
  { id: "create", icon: PlusCircle, label: "Create" },
  { id: "wallet", icon: Wallet, label: "Wallet" },
  { id: "profile", icon: User, label: "Me" },
];

export default function BottomNav() {
  const { activeTab, setActiveTab } = useApp();

  return (
    <div className="fixed bottom-4 left-0 right-0 z-40 flex justify-center px-4 safe-bottom">
      <div
        className="floating-nav rounded-full px-3 py-2 flex items-center gap-1"
        style={{ maxWidth: 340, width: "100%" }}
      >
        {tabs.map(({ id, icon: Icon, label }) => {
          const isActive = activeTab === id;
          return (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={cn(
                "relative flex flex-col items-center justify-center transition-all duration-200 rounded-full flex-1",
                isActive ? "py-2" : "py-2 hover:opacity-70"
              )}
            >
              {isActive ? (
                <div className="w-10 h-10 rounded-full gradient-brand flex items-center justify-center shadow-lg"
                  style={{ boxShadow: "0 4px 14px rgba(255,97,21,0.4)" }}>
                  <Icon size={20} color="white" strokeWidth={2.5} />
                </div>
              ) : (
                <div className="w-10 h-10 flex items-center justify-center">
                  <Icon size={20} style={{ color: "var(--color-text-secondary)" }} strokeWidth={1.8} />
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
