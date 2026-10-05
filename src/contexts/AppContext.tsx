"use client";
import React, { createContext, useContext, useState, useEffect, useCallback } from "react";

export interface UserProfile {
  id: number;
  telegramId?: string;
  username?: string;
  firstName?: string;
  lastName?: string;
  avatarUrl?: string;
  balance: string;
  pendingBalance: string;
  referralEarnings: string;
  totalDownloads: number;
  totalEarnings: string;
  referralCode?: string;
  darkMode?: boolean;
  language?: string;
}

interface AppContextValue {
  user: UserProfile | null;
  setUser: (u: UserProfile | null) => void;
  activeTab: string;
  setActiveTab: (t: string) => void;
  refreshUser: () => Promise<void>;
}

const AppContext = createContext<AppContextValue>({
  user: null,
  setUser: () => {},
  activeTab: "home",
  setActiveTab: () => {},
  refreshUser: async () => {},
});

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [activeTab, setActiveTab] = useState("home");

  const refreshUser = useCallback(async () => {
    try {
      const res = await fetch("/api/user/me");
      if (res.ok) {
        const data = await res.json();
        setUser(data.user);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    refreshUser();
  }, [refreshUser]);

  return (
    <AppContext.Provider value={{ user, setUser, activeTab, setActiveTab, refreshUser }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  return useContext(AppContext);
}
