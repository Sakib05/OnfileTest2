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
