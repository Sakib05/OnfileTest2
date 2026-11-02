import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { ThemeProvider } from "@/contexts/ThemeContext";
import Script from "next/script";
import { AppProvider } from "@/contexts/AppContext";
import { ToastProvider } from "@/components/ui/Toast";

export const metadata: Metadata = {
  title: "Onfile – File Sharing & Creator Monetization",
  description: "Share files, monetize content, and earn from Telegram. Connect your channel, set prices, and publish smart links.",
  keywords: ["file sharing", "telegram", "monetization", "creator", "smart links"],
  openGraph: {
    title: "Onfile",
    description: "File sharing & creator monetization platform",
    type: "website",
    images: ["/og-image.png"],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#FF6115",
};

/**
 * The floating round "menu" control some visitors see on Onfile pages is the
 * Vercel Toolbar. It is NOT part of this codebase (no @vercel/toolbar, no
 * toolbar script/component here): Vercel's edge injects a
 * <vercel-live-feedback> custom element into HTML responses for signed-in
 * Vercel team members on environments where the toolbar is enabled.
 * The authoritative switch is the Vercel dashboard (Project -> Settings ->
 * General -> Vercel Toolbar -> Production: Off). As defence in depth we also
 * hide that element on PRODUCTION builds only, so Preview deployments and
 * local development keep the toolbar / Next.js dev tools for developers.
 */
const hideVercelToolbar = process.env.VERCEL_ENV === "production";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <Script
          src="https://telegram.org/js/telegram-web-app.js"
          strategy="beforeInteractive"
        />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="apple-mobile-web-app-title" content="Onfile" />
        <link rel="icon" href="/favicon.ico" />
        {hideVercelToolbar && <style>{"vercel-live-feedback{display:none!important}"}</style>}
      </head>
      <body className="bg-app text-primary antialiased" suppressHydrationWarning>
        <ThemeProvider>
          <AppProvider>
            <ToastProvider>
              {children}
            </ToastProvider>
          </AppProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
