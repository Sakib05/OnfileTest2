"use client";
import React, { useState, useCallback, useEffect } from "react";
import {
  User, Users, Download, DollarSign, ChevronRight, Moon, Sun, Globe, Megaphone,
  HelpCircle, Copy, Share2, Gift, Star, ExternalLink, MessageCircle, Settings,
  Shield, LogOut, ArrowLeft, CheckCircle2, Building2, Zap, BarChart2, Plus
} from "lucide-react";
import { cn, formatNumber, formatCurrency, timeAgo } from "@/lib/utils";
import { useTheme } from "@/contexts/ThemeContext";
import { useApp } from "@/contexts/AppContext";
import { useToast } from "@/components/ui/Toast";
import Modal from "@/components/ui/Modal";

type SubPage = null | "referrals" | "advertise" | "channel" | "settings";

interface ReferralData {
  referrals: Array<{
    id: number;
    refereeUsername?: string;
    refereeFirstName?: string;
    commissionEarned: string;
    createdAt: string;
  }>;
  totals: {
    totalCommission: string;
    totalReferrals: number;
  };
}

export default function ProfileTab() {
  const { dark, toggle } = useTheme();
  const { user, refreshUser, logout } = useApp();
  const { toast } = useToast();
  const [loggingOut, setLoggingOut] = useState(false);
  const [subPage, setSubPage] = useState<SubPage>(null);
  const [referralData, setReferralData] = useState<ReferralData | null>(null);
  const [referralLoading, setReferralLoading] = useState(false);
  const [editForm, setEditForm] = useState({ firstName: user?.firstName || "", username: user?.username || "" });
  const [saving, setSaving] = useState(false);
  const [adForm, setAdForm] = useState({
    advertiserName: "", advertiserEmail: "", network: "adsgram",
    campaignName: "", budget: "", targetUrl: "", message: ""
  });
  const [adLoading, setAdLoading] = useState(false);
  const [adSuccess, setAdSuccess] = useState(false);

  const fetchReferrals = useCallback(async () => {
    setReferralLoading(true);
    try {
      const res = await fetch("/api/referrals");
      if (res.ok) setReferralData(await res.json());
    } finally {
      setReferralLoading(false);
    }
  }, []);

  useEffect(() => {
    if (subPage === "referrals") fetchReferrals();
  }, [subPage, fetchReferrals]);

  const referralLink = `https://onfile.app/ref/${user?.referralCode || "CODE"}`;

  const copyReferralLink = () => {
    navigator.clipboard.writeText(referralLink);
    toast("Referral link copied! 🔗");
  };

  const handleSaveProfile = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/user/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editForm),
      });
      if (res.ok) {
        toast("Profile updated! ✅");
        refreshUser();
      } else {
        toast("Failed to update profile", "error");
      }
    } finally {
      setSaving(false);
    }
  };

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      await logout();
    } finally {
      setLoggingOut(false);
    }
  };

  const handleAdSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAdLoading(true);
    try {
      const res = await fetch("/api/advertise", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(adForm),
      });
      if (res.ok) {
        setAdSuccess(true);
        toast("Campaign request submitted! 🎉");
      } else {
        toast("Failed to submit campaign", "error");
      }
    } finally {
      setAdLoading(false);
    }
  };

  // Sub Pages
  if (subPage === "referrals") {
    return (
      <div className="flex flex-col gap-5 animate-fade-in">
        <div className="flex items-center gap-3">
          <button onClick={() => setSubPage(null)} className="w-9 h-9 rounded-xl bg-secondary flex items-center justify-center">
            <ArrowLeft size={16} style={{ color: "var(--color-text)" }} />
          </button>
          <h1 className="text-lg font-bold text-primary">Referral Program</h1>
        </div>

        {/* Hero */}
        <div className="gradient-brand rounded-2xl p-5 text-white text-center relative overflow-hidden">
          <div className="absolute -top-4 -right-4 w-16 h-16 rounded-full bg-white/10" />
          <div className="absolute -bottom-3 -left-3 w-12 h-12 rounded-full bg-white/10" />
          <div className="relative z-10">
            <Gift size={32} className="mx-auto mb-2" />
            <h2 className="text-xl font-bold mb-1">Earn 5% Commission</h2>
            <p className="text-sm opacity-80">For every creator you refer, earn 5% of their lifetime earnings!</p>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-card rounded-2xl p-4 border border-app text-center">
            <p className="text-2xl font-bold text-brand">{referralData?.totals?.totalReferrals ?? 0}</p>
            <p className="text-xs text-secondary mt-1">Total Referred</p>
          </div>
          <div className="bg-card rounded-2xl p-4 border border-app text-center">
            <p className="text-2xl font-bold text-green-500">
              ${Number(referralData?.totals?.totalCommission ?? 0).toFixed(2)}
            </p>
            <p className="text-xs text-secondary mt-1">Total Earned</p>
          </div>
        </div>

        {/* Referral Link */}
        <div className="bg-card rounded-2xl p-4 border border-app shadow-app-sm">
          <p className="text-xs font-semibold text-secondary mb-2 uppercase tracking-wide">Your Referral Link</p>
          <div className="flex gap-2">
            <div className="flex-1 bg-secondary rounded-xl px-3 py-2.5 text-xs text-brand font-mono truncate">
              {referralLink}
            </div>
            <button
              onClick={copyReferralLink}
              className="w-10 h-10 rounded-xl gradient-brand flex items-center justify-center flex-shrink-0"
            >
              <Copy size={14} color="white" />
            </button>
          </div>
        </div>

        {/* How it works */}
        <div className="bg-card rounded-2xl p-4 border border-app shadow-app-sm">
          <h3 className="text-sm font-semibold text-primary mb-3">How it works</h3>
          <div className="flex flex-col gap-3">
            {[
              { step: "1", text: "Share your unique referral link with other creators" },
              { step: "2", text: "They sign up and start publishing files on Onfile" },
              { step: "3", text: "You earn 5% of their lifetime earnings, forever!" },
            ].map(({ step, text }) => (
              <div key={step} className="flex items-start gap-3">
                <div className="w-6 h-6 rounded-full gradient-brand text-white text-xs font-bold flex items-center justify-center flex-shrink-0">
                  {step}
                </div>
                <p className="text-sm text-secondary">{text}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Referred Users */}
        <div>
          <h3 className="text-sm font-semibold text-primary mb-3">Referred Creators ({referralData?.totals?.totalReferrals ?? 0})</h3>
          {referralLoading ? (
            <div className="bg-card rounded-2xl p-4 border border-app animate-pulse-brand h-20" />
          ) : (referralData?.referrals ?? []).length === 0 ? (
            <div className="bg-card rounded-2xl p-6 border border-app text-center">
              <Users size={28} className="text-muted mx-auto mb-2 opacity-40" />
              <p className="text-sm text-secondary">No referrals yet. Start sharing your link!</p>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {(referralData?.referrals ?? []).map((ref) => (
                <div key={ref.id} className="bg-card rounded-xl p-3 border border-app flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full gradient-brand flex items-center justify-center text-white text-sm font-bold">
                    {(ref.refereeFirstName || ref.refereeUsername || "?")[0]?.toUpperCase()}
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-primary">@{ref.refereeUsername || ref.refereeFirstName || "Unknown"}</p>
                    <p className="text-xs text-secondary">Joined {timeAgo(ref.createdAt)}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold text-green-500">+${Number(ref.commissionEarned).toFixed(2)}</p>
                    <p className="text-xs text-secondary">earned</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  if (subPage === "advertise") {
    return (
      <div className="flex flex-col gap-5 animate-fade-in">
        <div className="flex items-center gap-3">
          <button onClick={() => setSubPage(null)} className="w-9 h-9 rounded-xl bg-secondary flex items-center justify-center">
            <ArrowLeft size={16} style={{ color: "var(--color-text)" }} />
          </button>
          <h1 className="text-lg font-bold text-primary">Advertise with Us</h1>
        </div>

        {/* Stats Banner */}
        <div className="gradient-brand rounded-2xl p-4 text-white">
          <h2 className="font-bold text-lg mb-3">Reach Millions of Users</h2>
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: "Monthly Views", value: "2.4M+" },
              { label: "Active Users", value: "180K+" },
              { label: "Countries", value: "120+" },
            ].map(({ label, value }) => (
              <div key={label} className="bg-white/10 rounded-xl p-2 text-center">
                <p className="font-bold text-base">{value}</p>
                <p className="text-xs opacity-80">{label}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Ad Networks */}
        <div className="bg-card rounded-2xl p-4 border border-app shadow-app-sm">
          <h3 className="text-sm font-semibold text-primary mb-3">Supported Ad Networks</h3>
          <div className="flex flex-col gap-2">
            {[
              { name: "Adsgram", desc: "Telegram-native rewarded ads", color: "bg-blue-500" },
              { name: "Adsonar", desc: "Performance-based ad network", color: "bg-purple-500" },
              { name: "Monitag TG Ads", desc: "Telegram Ads platform", color: "bg-green-500" },
              { name: "Direct Campaign", desc: "Work directly with Onfile", color: "gradient-brand" },
            ].map(({ name, desc, color }) => (
              <div key={name} className="flex items-center gap-3 p-3 rounded-xl bg-secondary">
                <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center text-white text-xs font-bold flex-shrink-0", color)}>
                  {name[0]}
                </div>
                <div>
                  <p className="text-sm font-semibold text-primary">{name}</p>
                  <p className="text-xs text-secondary">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Ad Form */}
        {adSuccess ? (
          <div className="bg-card rounded-2xl p-6 border border-app text-center flex flex-col items-center gap-3">
            <div className="w-16 h-16 rounded-2xl bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
              <CheckCircle2 size={32} className="text-green-500" />
            </div>
            <h3 className="font-bold text-primary">Campaign Request Submitted!</h3>
            <p className="text-sm text-secondary">Our team will review your request and contact you within 24-48 hours.</p>
            <button onClick={() => { setAdSuccess(false); setSubPage(null); }} className="btn-primary px-6 py-2.5 text-sm">
              Done
            </button>
          </div>
        ) : (
          <form onSubmit={handleAdSubmit} className="bg-card rounded-2xl p-4 border border-app shadow-app-sm flex flex-col gap-3">
            <h3 className="text-sm font-semibold text-primary">Submit Campaign Request</h3>
            {[
              { key: "advertiserName", label: "Company / Advertiser Name *", placeholder: "Your company name", type: "text" },
              { key: "advertiserEmail", label: "Contact Email *", placeholder: "email@company.com", type: "email" },
              { key: "campaignName", label: "Campaign Name", placeholder: "e.g. Winter Sale 2025", type: "text" },
              { key: "budget", label: "Budget (USD)", placeholder: "e.g. 500", type: "number" },
              { key: "targetUrl", label: "Landing Page URL", placeholder: "https://your-website.com", type: "url" },
            ].map(({ key, label, placeholder, type }) => (
              <div key={key}>
                <label className="text-xs font-medium text-secondary mb-1.5 block">{label}</label>
                <input
                  className="input-app text-sm"
                  type={type}
                  placeholder={placeholder}
                  value={adForm[key as keyof typeof adForm]}
                  onChange={(e) => setAdForm((prev) => ({ ...prev, [key]: e.target.value }))}
                  required={label.endsWith("*")}
                />
              </div>
            ))}
            <div>
              <label className="text-xs font-medium text-secondary mb-1.5 block">Ad Network Preference</label>
              <select
                className="input-app text-sm"
                value={adForm.network}
                onChange={(e) => setAdForm((prev) => ({ ...prev, network: e.target.value }))}
              >
                <option value="adsgram">Adsgram</option>
                <option value="adsonar">Adsonar</option>
                <option value="monitag">Monitag TG Ads</option>
                <option value="direct">Direct Campaign</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-secondary mb-1.5 block">Message / Notes</label>
              <textarea
                className="input-app text-sm resize-none"
                rows={3}
                placeholder="Tell us about your campaign goals..."
                value={adForm.message}
                onChange={(e) => setAdForm((prev) => ({ ...prev, message: e.target.value }))}
              />
            </div>
            <button type="submit" disabled={adLoading} className="btn-primary py-3 text-sm">
              {adLoading ? "Submitting..." : "Submit Campaign Request"}
            </button>
          </form>
        )}
      </div>
    );
  }

  if (subPage === "channel") {
    return (
      <div className="flex flex-col gap-5 animate-fade-in">
        <div className="flex items-center gap-3">
          <button onClick={() => setSubPage(null)} className="w-9 h-9 rounded-xl bg-secondary flex items-center justify-center">
            <ArrowLeft size={16} style={{ color: "var(--color-text)" }} />
          </button>
          <h1 className="text-lg font-bold text-primary">Channel Management</h1>
        </div>
        <div className="bg-card rounded-2xl p-4 border border-app shadow-app-sm flex flex-col gap-4">
          <div className="flex items-center gap-3 p-3 rounded-xl bg-secondary">
            <div className="w-10 h-10 rounded-xl gradient-brand flex items-center justify-center">
              <MessageCircle size={18} color="white" />
            </div>
            <div>
              <p className="text-sm font-semibold text-primary">No channel connected</p>
              <p className="text-xs text-secondary">Connect your Telegram channel</p>
            </div>
          </div>
          <h3 className="text-sm font-semibold text-primary">How to connect your channel:</h3>
          {[
            "Add @OnfileBot as an administrator to your Telegram channel",
            "Grant the bot permission to read messages and post content",
            "Paste your channel link below to verify the connection",
            "Once verified, import posts directly from your channel",
          ].map((step, i) => (
            <div key={i} className="flex items-start gap-3">
              <div className="w-6 h-6 rounded-full gradient-brand text-white text-xs font-bold flex items-center justify-center flex-shrink-0">
                {i + 1}
              </div>
              <p className="text-sm text-secondary">{step}</p>
            </div>
          ))}
          <input className="input-app text-sm" placeholder="https://t.me/your_channel" />
          <button className="btn-primary py-3 text-sm">Connect Channel</button>
        </div>
      </div>
    );
  }

  if (subPage === "settings") {
    return (
      <div className="flex flex-col gap-5 animate-fade-in">
        <div className="flex items-center gap-3">
          <button onClick={() => setSubPage(null)} className="w-9 h-9 rounded-xl bg-secondary flex items-center justify-center">
            <ArrowLeft size={16} style={{ color: "var(--color-text)" }} />
          </button>
          <h1 className="text-lg font-bold text-primary">Account Settings</h1>
        </div>
        <div className="bg-card rounded-2xl p-4 border border-app shadow-app-sm flex flex-col gap-3">
          <h3 className="text-sm font-semibold text-primary">Edit Profile</h3>
          <div>
            <label className="text-xs font-medium text-secondary mb-1.5 block">Display Name</label>
            <input
              className="input-app text-sm"
              value={editForm.firstName}
              onChange={(e) => setEditForm((prev) => ({ ...prev, firstName: e.target.value }))}
            />
          </div>
          <div>
            <label className="text-xs font-medium text-secondary mb-1.5 block">Username</label>
            <input
              className="input-app text-sm"
              value={editForm.username}
              onChange={(e) => setEditForm((prev) => ({ ...prev, username: e.target.value }))}
            />
          </div>
          <button onClick={handleSaveProfile} disabled={saving} className="btn-primary py-2.5 text-sm">
            {saving ? "Saving..." : "Save Changes"}
          </button>
        </div>
        <button
          onClick={handleLogout}
          disabled={loggingOut}
          className="bg-card rounded-2xl p-4 border border-app shadow-app-sm flex items-center justify-center gap-2 text-sm font-semibold text-red-500 disabled:opacity-50"
        >
          <LogOut size={15} />
          {loggingOut ? "Logging out..." : "Log Out"}
        </button>
      </div>
    );
  }

  // Main Profile Page
  return (
    <div className="flex flex-col gap-5">
      {/* Profile Header */}
      <div className="bg-card rounded-2xl p-4 border border-app shadow-app-sm">
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-2xl gradient-brand flex items-center justify-center text-white text-2xl font-bold flex-shrink-0">
            {(user?.firstName || user?.username || "C")[0]?.toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-bold text-primary">{user?.firstName || "Creator"}</h2>
            <p className="text-sm text-secondary">@{user?.username || "creator"}</p>
            <div className="flex items-center gap-2 mt-1.5">
              <span className="chip bg-brand-10 text-brand text-xs">Creator</span>
            </div>
          </div>
          <button onClick={() => setSubPage("settings")} className="w-9 h-9 rounded-xl bg-secondary flex items-center justify-center">
            <Settings size={16} style={{ color: "var(--color-text-secondary)" }} />
          </button>
        </div>
        <div className="grid grid-cols-3 gap-3 mt-4 pt-4 border-t border-app">
          {[
            { label: "Files", value: "—" },
            { label: "Downloads", value: formatNumber(user?.totalDownloads ?? 0) },
            { label: "Earned", value: `$${Number(user?.totalEarnings ?? 0).toFixed(0)}` },
          ].map(({ label, value }) => (
            <div key={label} className="text-center">
              <p className="text-lg font-bold text-primary">{value}</p>
              <p className="text-xs text-secondary">{label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Referral Banner */}
      <button
        onClick={() => setSubPage("referrals")}
        className="bg-card rounded-2xl p-4 border border-app shadow-app-sm flex items-center gap-3 w-full text-left"
        style={{ background: "linear-gradient(135deg, rgba(255,97,21,0.05) 0%, rgba(255,140,74,0.08) 100%)", borderColor: "rgba(255,97,21,0.2)" }}
      >
        <div className="w-10 h-10 rounded-xl gradient-brand flex items-center justify-center flex-shrink-0">
          <Gift size={18} color="white" />
        </div>
        <div className="flex-1">
          <p className="text-sm font-semibold text-primary">Referral Program</p>
          <p className="text-xs text-secondary">Earn 5% lifetime commission. Referral code: <span className="text-brand font-bold">{user?.referralCode || "..."}</span></p>
        </div>
        <ChevronRight size={16} className="text-brand flex-shrink-0" />
      </button>

      {/* Advertise */}
      <button
        onClick={() => setSubPage("advertise")}
        className="bg-card rounded-2xl p-4 border border-app shadow-app-sm flex items-center gap-3 w-full text-left"
      >
        <div className="w-10 h-10 rounded-xl bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center flex-shrink-0">
          <Megaphone size={18} className="text-purple-600 dark:text-purple-400" />
        </div>
        <div className="flex-1">
          <p className="text-sm font-semibold text-primary">Advertise with Us</p>
          <p className="text-xs text-secondary">Adsgram · Adsonar · Monitag TG Ads</p>
        </div>
        <ChevronRight size={16} className="text-secondary flex-shrink-0" />
      </button>

      {/* Sections */}
      <div className="bg-card rounded-2xl border border-app shadow-app-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-app">
          <p className="text-xs font-semibold text-secondary uppercase tracking-wide">Preferences</p>
        </div>
        <ProfileRow
          icon={dark ? Sun : Moon}
          iconBg="bg-indigo-50 dark:bg-indigo-900/20"
          iconColor="text-indigo-500"
          label={dark ? "Light Mode" : "Dark Mode"}
          action={
            <div
              onClick={toggle}
              className={cn(
                "w-11 h-6 rounded-full transition-colors relative cursor-pointer flex-shrink-0",
                dark ? "bg-brand" : "bg-gray-200 dark:bg-gray-700"
              )}
            >
              <div className={cn(
                "absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform",
                dark ? "translate-x-5" : "translate-x-0.5"
              )} />
            </div>
          }
          noChevron
        />
        <ProfileRow
          icon={Globe}
          iconBg="bg-blue-50 dark:bg-blue-900/20"
          iconColor="text-blue-500"
          label="Language"
          value="English"
          onClick={() => {}}
        />
      </div>

      <div className="bg-card rounded-2xl border border-app shadow-app-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-app">
          <p className="text-xs font-semibold text-secondary uppercase tracking-wide">Management</p>
        </div>
        <ProfileRow
          icon={MessageCircle}
          iconBg="bg-cyan-50 dark:bg-cyan-900/20"
          iconColor="text-cyan-500"
          label="Channel Management"
          onClick={() => setSubPage("channel")}
        />
        <ProfileRow
          icon={Shield}
          iconBg="bg-green-50 dark:bg-green-900/20"
          iconColor="text-green-500"
          label="Privacy & Security"
          onClick={() => {}}
        />
      </div>

      <div className="bg-card rounded-2xl border border-app shadow-app-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-app">
          <p className="text-xs font-semibold text-secondary uppercase tracking-wide">Support</p>
        </div>
        <ProfileRow
          icon={HelpCircle}
          iconBg="bg-yellow-50 dark:bg-yellow-900/20"
          iconColor="text-yellow-500"
          label="FAQ & Help"
          onClick={() => {}}
        />
        <ProfileRow
          icon={MessageCircle}
          iconBg="bg-teal-50 dark:bg-teal-900/20"
          iconColor="text-teal-500"
          label="Contact Support"
          onClick={() => {}}
        />
      </div>

      <div className="text-center">
        <p className="text-xs text-muted">Onfile v1.0.0 · Made with ❤️</p>
      </div>
    </div>
  );
}

function ProfileRow({
  icon: Icon,
  iconBg,
  iconColor,
  label,
  value,
  action,
  onClick,
  noChevron,
}: {
  icon: React.FC<{ size: number; className: string }>;
  iconBg: string;
  iconColor: string;
  label: string;
  value?: string;
  action?: React.ReactNode;
  onClick?: () => void;
  noChevron?: boolean;
}) {
  return (
    <div
      className={cn("flex items-center gap-3 px-4 py-3.5 border-b border-app last:border-0 transition-colors", onClick && "hover:bg-secondary cursor-pointer")}
      onClick={onClick}
    >
      <div className={cn("w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0", iconBg)}>
        <Icon size={15} className={iconColor} />
      </div>
      <span className="flex-1 text-sm font-medium text-primary">{label}</span>
      {value && <span className="text-xs text-secondary">{value}</span>}
      {action}
      {!noChevron && !action && <ChevronRight size={14} className="text-muted flex-shrink-0" />}
    </div>
  );
}
