"use client";
import React, { useState, useEffect, useCallback, use } from "react";
import {
  Download, Lock, Star, Eye, Shield, Flag, Clock, CheckCircle2, AlertCircle,
  Play, FileText, Music, Image as ImageIcon, Archive, Film, ArrowLeft, Share2
} from "lucide-react";
import { formatBytes, getFileTypeIcon, cn } from "@/lib/utils";
import Modal from "@/components/ui/Modal";

interface FileInfo {
  id: number;
  title: string;
  description?: string;
  fileType: string;
  fileSize?: number;
  starsPrice?: number;
  hasPassword?: boolean;
  views?: number;
  downloads?: number;
  slug: string;
}

const REPORT_REASONS = [
  { value: "copyright", label: "Copyright Infringement" },
  { value: "nsfw", label: "Adult / NSFW Content" },
  { value: "malware", label: "Malware / Harmful Content" },
  { value: "broken_link", label: "Broken Link" },
  { value: "spam", label: "Spam" },
  { value: "other", label: "Other" },
];

export default function SmartLinkPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const [file, setFile] = useState<FileInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [downloadLink, setDownloadLink] = useState<string | null>(null);

  // Countdown Ad
  const [countdown, setCountdown] = useState(10);
  const [countdownActive, setCountdownActive] = useState(false);
  const [adWatched, setAdWatched] = useState(false);

  // Password
  const [password, setPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [passwordLoading, setPasswordLoading] = useState(false);

  // Report
  const [showReport, setShowReport] = useState(false);
  const [reportForm, setReportForm] = useState({ reason: "copyright", description: "" });
  const [reportLoading, setReportLoading] = useState(false);
  const [reportSuccess, setReportSuccess] = useState(false);

  // Active unlock tab
  const [unlockTab, setUnlockTab] = useState<"ad" | "password" | "stars">("ad");

  const fetchFile = useCallback(async () => {
    try {
      const res = await fetch(`/api/link/${slug}`);
      if (res.ok) {
        const data = await res.json();
        setFile(data.file);
        if (!data.file.hasPassword && !data.file.starsPrice) {
          // Default to ad unlock
          setUnlockTab("ad");
        } else if (data.file.hasPassword) {
          setUnlockTab("password");
        }
      } else {
        setNotFound(true);
      }
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => { fetchFile(); }, [fetchFile]);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval>;
    if (countdownActive && countdown > 0) {
      timer = setInterval(() => setCountdown((c) => c - 1), 1000);
    } else if (countdownActive && countdown === 0) {
      setAdWatched(true);
      setCountdownActive(false);
    }
    return () => clearInterval(timer);
  }, [countdownActive, countdown]);

  const handleAdUnlock = async () => {
    if (!adWatched) {
      setCountdownActive(true);
      return;
    }
    await unlockFile();
  };

  const handlePasswordUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError("");
    setPasswordLoading(true);
    const result = await unlockFile(password);
    if (!result) {
      setPasswordError("Incorrect password. Please try again.");
    }
    setPasswordLoading(false);
  };

  const unlockFile = async (pwd?: string): Promise<boolean> => {
    try {
      const res = await fetch(`/api/link/${slug}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: pwd || "" }),
      });
      if (res.ok) {
        const data = await res.json();
        setDownloadLink(data.telegramMessageLink);
        setUnlocked(true);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  };

  const handleReport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return;
    setReportLoading(true);
    try {
      const res = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileId: file.id, ...reportForm }),
      });
      if (res.ok) setReportSuccess(true);
    } finally {
      setReportLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-app flex items-center justify-center">
        <div className="w-10 h-10 rounded-full border-3 border-brand border-t-transparent animate-spin" style={{ borderWidth: 3 }} />
      </div>
    );
  }

  if (notFound || !file) {
    return (
      <div className="min-h-screen bg-app flex flex-col items-center justify-center gap-4 px-6 text-center">
        <div className="w-20 h-20 rounded-2xl bg-secondary flex items-center justify-center text-4xl">🔍</div>
        <h1 className="text-xl font-bold text-primary">File Not Found</h1>
        <p className="text-sm text-secondary">This link may have expired or been removed.</p>
        <a href="/" className="btn-primary px-6 py-3 text-sm">Go Home</a>
      </div>
    );
  }

  if (unlocked) {
    return (
      <div className="min-h-screen bg-app flex flex-col items-center justify-center px-4 py-8">
        <div className="w-full max-w-md">
          {/* Success */}
          <div className="bg-card rounded-3xl border border-app shadow-app-lg p-6 text-center flex flex-col items-center gap-4 animate-scale-in">
            <div className="w-20 h-20 rounded-2xl bg-green-100 dark:bg-green-900/30 flex items-center justify-center text-4xl">
              {getFileTypeIcon(file.fileType)}
            </div>
            <div className="w-14 h-14 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center -mt-8 border-4 border-card">
              <CheckCircle2 size={28} className="text-green-500" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-primary mb-1">File Unlocked! 🎉</h1>
              <p className="text-sm text-secondary">{file.title}</p>
              <p className="text-xs text-muted mt-1">{formatBytes(file.fileSize)}</p>
            </div>
            {downloadLink ? (
              <a
                href={downloadLink}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-primary w-full py-4 text-sm flex items-center justify-center gap-2"
              >
                <Download size={16} />
                Open in Telegram
              </a>
            ) : (
              <div className="p-3 rounded-xl bg-secondary text-sm text-secondary text-center">
                The file will be sent to you via Telegram bot shortly.
              </div>
            )}
            <button
              onClick={() => setShowReport(true)}
              className="flex items-center gap-1.5 text-xs text-muted hover:text-red-500 transition-colors"
            >
              <Flag size={11} />
              Report this file
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-app px-4 py-6 flex flex-col items-center">
      <div className="w-full max-w-md flex flex-col gap-5">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg gradient-brand flex items-center justify-center text-white text-xs font-black">O</div>
            <span className="font-bold text-primary text-sm">Onfile</span>
          </div>
          <button
            onClick={() => setShowReport(true)}
            className="flex items-center gap-1.5 text-xs text-muted hover:text-red-500 transition-colors"
          >
            <Flag size={12} />
            Report
          </button>
        </div>

        {/* File Card */}
        <div className="bg-card rounded-3xl border border-app shadow-app-lg p-5">
          <div className="flex items-center gap-4 mb-4">
            <div className="w-16 h-16 rounded-2xl bg-secondary flex items-center justify-center text-3xl flex-shrink-0">
              {getFileTypeIcon(file.fileType)}
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="font-bold text-primary text-base leading-snug">{file.title}</h1>
              {file.description && (
                <p className="text-xs text-secondary mt-0.5 line-clamp-2">{file.description}</p>
              )}
              <div className="flex items-center gap-2 mt-1.5">
                <span className="text-xs text-muted">{file.fileType}</span>
                {file.fileSize && <span className="text-xs text-muted">· {formatBytes(file.fileSize)}</span>}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-4 pt-3 border-t border-app">
            <div className="flex items-center gap-1.5 text-xs text-secondary">
              <Eye size={12} />
              {file.views ?? 0} views
            </div>
            <div className="flex items-center gap-1.5 text-xs text-secondary">
              <Download size={12} />
              {file.downloads ?? 0} downloads
            </div>
            <div className="flex items-center gap-1.5 text-xs text-green-500">
              <Shield size={12} />
              Verified
            </div>
          </div>
        </div>

        {/* Unlock Options */}
        <div className="bg-card rounded-3xl border border-app shadow-app-lg overflow-hidden">
          {/* Tab Headers */}
          <div className="flex border-b border-app">
            {[
              { id: "ad" as const, label: "🎬 Watch Ad", available: true },
              { id: "password" as const, label: "🔐 Password", available: !!file.hasPassword },
              { id: "stars" as const, label: "⭐ Stars", available: (file.starsPrice ?? 0) > 0 },
            ]
              .filter((t) => t.available || t.id === "ad")
              .map(({ id, label }) => (
                <button
                  key={id}
                  onClick={() => setUnlockTab(id)}
                  className={cn(
                    "flex-1 py-3 text-xs font-semibold transition-colors border-b-2",
                    unlockTab === id
                      ? "text-brand border-brand"
                      : "text-secondary border-transparent"
                  )}
                >
                  {label}
                </button>
              ))}
          </div>

          <div className="p-5">
            {/* Ad Countdown */}
            {unlockTab === "ad" && (
              <div className="flex flex-col items-center gap-4 text-center">
                {!countdownActive && !adWatched ? (
                  <>
                    <div className="w-20 h-20 rounded-2xl bg-brand-10 border-2 border-brand border-dashed flex items-center justify-center">
                      <Play size={32} className="text-brand" />
                    </div>
                    <div>
                      <p className="font-semibold text-primary">Watch a short ad</p>
                      <p className="text-sm text-secondary mt-0.5">Watch a 10-second ad to unlock this file for free</p>
                    </div>
                    <button onClick={handleAdUnlock} className="btn-primary w-full py-3.5 text-sm">
                      Watch Ad to Unlock
                    </button>
                  </>
                ) : countdownActive ? (
                  <>
                    {/* Simulated Ad */}
                    <div className="w-full h-36 rounded-2xl gradient-brand flex flex-col items-center justify-center gap-2 text-white relative">
                      <p className="font-bold text-lg">Ad Space</p>
                      <p className="text-sm opacity-80">Powered by Adsgram</p>
                      <div className="absolute top-3 right-3 w-8 h-8 rounded-full bg-white/20 flex items-center justify-center">
                        <span className="text-sm font-bold">{countdown}</span>
                      </div>
                    </div>
                    <p className="text-sm text-secondary">Please wait {countdown} seconds...</p>
                  </>
                ) : (
                  <>
                    <div className="w-20 h-20 rounded-2xl bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                      <CheckCircle2 size={36} className="text-green-500" />
                    </div>
                    <div>
                      <p className="font-semibold text-primary">Ad completed! ✅</p>
                      <p className="text-sm text-secondary">Click below to unlock your file</p>
                    </div>
                    <button onClick={handleAdUnlock} className="btn-primary w-full py-3.5 text-sm">
                      Unlock File Now
                    </button>
                  </>
                )}
              </div>
            )}

            {/* Password Unlock */}
            {unlockTab === "password" && (
              <form onSubmit={handlePasswordUnlock} className="flex flex-col gap-4">
                <div className="flex flex-col items-center gap-2 text-center mb-2">
                  <div className="w-14 h-14 rounded-2xl bg-brand-10 border border-brand/30 flex items-center justify-center">
                    <Lock size={24} className="text-brand" />
                  </div>
                  <p className="font-semibold text-primary">Password Protected</p>
                  <p className="text-sm text-secondary">Enter the password to unlock this file</p>
                </div>
                <input
                  className={cn("input-app text-sm text-center font-mono tracking-widest", passwordError && "border-red-500")}
                  type="password"
                  placeholder="Enter password..."
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
                {passwordError && (
                  <div className="flex items-center gap-2 p-2 rounded-xl bg-red-50 dark:bg-red-900/20">
                    <AlertCircle size={13} className="text-red-500" />
                    <p className="text-xs text-red-500">{passwordError}</p>
                  </div>
                )}
                <button type="submit" disabled={passwordLoading} className="btn-primary py-3.5 text-sm">
                  {passwordLoading ? "Verifying..." : "Unlock with Password"}
                </button>
              </form>
            )}

            {/* Stars Unlock */}
            {unlockTab === "stars" && (
              <div className="flex flex-col items-center gap-4 text-center">
                <div className="w-14 h-14 rounded-2xl bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 flex items-center justify-center text-3xl">
                  ⭐
                </div>
                <div>
                  <p className="font-semibold text-primary">Instant Access with Stars</p>
                  <p className="text-sm text-secondary mt-0.5">Pay {file.starsPrice} Telegram Stars for instant, ad-free access</p>
                </div>
                <div className="w-full p-3 rounded-xl bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800">
                  <p className="text-2xl font-black text-yellow-600 dark:text-yellow-400">⭐ {file.starsPrice}</p>
                  <p className="text-xs text-secondary mt-1">≈ ${((file.starsPrice ?? 0) * 0.013).toFixed(2)} USD</p>
                </div>
                <button className="btn-primary w-full py-3.5 text-sm flex items-center justify-center gap-2">
                  <Star size={16} />
                  Pay {file.starsPrice} Stars
                </button>
                <p className="text-xs text-muted">Telegram Stars payment via Telegram bot</p>
              </div>
            )}
          </div>
        </div>

        {/* Security Badge */}
        <div className="flex items-center justify-center gap-3 text-xs text-muted py-2">
          <div className="flex items-center gap-1.5">
            <Shield size={12} />
            Secure delivery
          </div>
          <span>·</span>
          <div className="flex items-center gap-1.5">
            <CheckCircle2 size={12} />
            Zero storage
          </div>
          <span>·</span>
          <div className="flex items-center gap-1.5">
            <Shield size={12} />
            Protected
          </div>
        </div>
      </div>

      {/* Report Modal */}
      <Modal open={showReport} onClose={() => setShowReport(false)} title="Report File" size="sm">
        {reportSuccess ? (
          <div className="flex flex-col items-center gap-3 text-center py-2">
            <CheckCircle2 size={40} className="text-green-500" />
            <p className="font-semibold text-primary">Report Submitted</p>
            <p className="text-sm text-secondary">Our team will review this content within 24 hours.</p>
            <button onClick={() => setShowReport(false)} className="btn-primary px-6 py-2.5 text-sm w-full">
              Done
            </button>
          </div>
        ) : (
          <form onSubmit={handleReport} className="flex flex-col gap-4">
            <div>
              <label className="text-xs font-medium text-secondary mb-1.5 block">Reason *</label>
              <select
                className="input-app text-sm"
                value={reportForm.reason}
                onChange={(e) => setReportForm((prev) => ({ ...prev, reason: e.target.value }))}
              >
                {REPORT_REASONS.map(({ value, label }) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-secondary mb-1.5 block">Additional Details</label>
              <textarea
                className="input-app text-sm resize-none"
                rows={3}
                placeholder="Provide more details about the issue..."
                value={reportForm.description}
                onChange={(e) => setReportForm((prev) => ({ ...prev, description: e.target.value }))}
              />
            </div>
            <div className="flex gap-3">
              <button type="button" onClick={() => setShowReport(false)} className="flex-1 btn-secondary py-2.5 text-sm">
                Cancel
              </button>
              <button type="submit" disabled={reportLoading} className="flex-1 py-2.5 rounded-xl bg-red-500 text-white text-sm font-semibold hover:bg-red-600 transition-colors">
                {reportLoading ? "Submitting..." : "Submit Report"}
              </button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
