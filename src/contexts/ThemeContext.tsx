"use client";
import React, { createContext, useContext, useEffect, useState, useCallback } from "react";

interface ThemeContextValue {
  dark: boolean;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue>({ dark: false, toggle: () => {} });

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem("onfile_dark_mode");
    const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches;
    const isDark = stored !== null ? stored === "true" : prefersDark;
    // One-time mount check reading browser-only APIs (localStorage/
    // matchMedia); cannot be computed during render/SSR.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDark(isDark);
    if (isDark) document.documentElement.classList.add("dark");
    else document.documentElement.classList.remove("dark");
  }, []);

  const toggle = useCallback(() => {
    setDark((prev) => {
      const next = !prev;
      localStorage.setItem("onfile_dark_mode", String(next));
      if (next) document.documentElement.classList.add("dark");
      else document.documentElement.classList.remove("dark");
      return next;
    });
  }, []);

  return (
    <ThemeContext.Provider value={{ dark, toggle }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
