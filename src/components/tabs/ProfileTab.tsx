"use client";
import React, { useState, useCallback, useEffect } from "react";
import {
  User, Users, ChevronRight, Moon, Sun, Megaphone, HelpCircle, Copy, Gift, MessageCircle,
  Shield, CheckCircle2, Plus, XCircle, Clock, Pencil, IdCard, Wallet, FileText, Database,
} from "lucide-react";
import { cn, formatNumber, formatCurrency, timeAgo } from "@/lib/utils";
import { useTheme } from "@/contexts/ThemeContext";
import { useApp } from "@/contexts/AppContext";
import { useToast } from "@/components/ui/Toast";
import Modal from "@/components/ui/Modal";
import DeleteConfirmModal from "@/components/ui/DeleteConfirmModal";
import ChannelConnectFlow, { type ConnectedChannel } from "@/components/ChannelConnectFlow";
import Faq from "@/components/Faq";
import EditProfile from "@/components/profile/EditProfile";
import AccountInfo from "@/components/profile/AccountInfo";
import PrivacySecurityPage from "@/components/legal/PrivacySecurityPage";
import TermsPage from "@/components/legal/TermsPage";
import { MIN_WITHDRAWAL_USD } from "@/lib/money";
import { useTelegramBackButton } from "@/lib/useTelegramBackButton";
import TelegramAvatar from "@/components/ui/TelegramAvatar";
import Link from "next/link";

type SubPage = null | "referrals" | "advertise" | "channel" | "editProfile" | "account" | "faq" | "privacy" | "terms";

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
  const { user, refreshUser, refreshChannels, profileEntry, setProfileEntry, setActiveTab } = useApp();
  const { toast } = useToast();
  // A notification tap can ask the Profile tab to open directly on a sub-page.
  const [subPage, setSubPage] = useState<SubPage>(() => profileEntry);
  useEffect(() => {
    if (profileEntry) setProfileEntry(null); // one-shot: consumed
  }, [profileEntry, setProfileEntry]);
  // Telegram's native Back Button is the ONLY back control: it returns from any Profile
  // sub-page to the Profile root, and stays hidden on the Profile root itself.
  useTelegramBackButton(() => setSubPage(null), subPage !== null);
  useEffect(() => {
    window.scrollTo?.(0, 0);
  }, [subPage]);
  const [referralData, setReferralData] = useState<ReferralData | null>(null);
  const [referralLoading, setReferralLoading] = useState(false);
  const [channels, setChannels] = useState<ConnectedChannel[] | null>(null);
  const [channelsError, setChannelsError] = useState<string | null>(null);
  const [channelsLoading, setChannelsLoading] = useState(false);
  const [showConnectNew, setShowConnectNew] = useState(false);
  const [disconnectTarget, setDisconnectTarget] = useState<ConnectedChannel | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);
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

  const fetchChannels = useCallback(async () => {
    setChannelsLoading(true);
    setChannelsError(null);
    try {
      const res = await fetch("/api/channels");
      if (!res.ok) throw new Error("request_failed");
      const data = await res.json();
      setChannels(Array.isArray(data.channels) ? data.channels : []);
    } catch {
      setChannelsError("Couldn't load your channels. Please try again.");
    } finally {
      setChannelsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (subPage === "channel") {
      setShowConnectNew(false);
      fetchChannels();
    }
  }, [subPage, fetchChannels]);

  const handleChannelConnected = () => {
    setShowConnectNew(false);
    fetchChannels();
    refreshUser();
    refreshChannels();
    toast("Channel connected! ✅");
  };

  const handleDisconnectConfirm = async () => {
    if (!disconnectTarget) return;
    setDisconnecting(true);
    try {
      const res = await fetch(`/api/channels?id=${disconnectTarget.id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(data.error || "Failed to disconnect channel", "error");
        return;
      }
      setChannels((prev) => (prev ? prev.map((c) => (c.id === disconnectTarget.id ? data.channel : c)) : prev));
      toast(data.botRemoved ? "Channel disconnected and bot removed" : "Channel disconnected");
      refreshChannels();
    } catch {
      toast("Network error. Please try again.", "error");
    } finally {
      setDisconnecting(false);
      setDisconnectTarget(null);
    }
  };

  const referralLink = `https://onfile.app/ref/${user?.referralCode || "CODE"}`;

  const copyReferralLink = () => {
    navigator.clipboard.writeText(referralLink);
    toast("Referral link copied! 🔗");
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
    const activeChannels = (channels ?? []).filter((c) => c.status !== "disconnected");
    return (
      <div className="flex flex-col gap-5 animate-fade-in">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-bold text-primary">Channel Management</h1>
        </div>

        {/* Connected channels list */}
        <div className="bg-card rounded-2xl p-4 border border-app shadow-app-sm flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-primary">Connected Channels</h3>
            <button onClick={() => setSubPage("faq")} className="text-xs font-semibold text-brand">
              Why private channel?
            </button>
          </div>

          {channelsLoading && (
            <div className="animate-pulse-brand h-16 rounded-xl bg-secondary" />
          )}

          {!channelsLoading && channelsError && (
            <div className="flex flex-col items-center gap-2 text-center py-4">
              <p className="text-xs text-red-500">{channelsError}</p>
              <button onClick={fetchChannels} className="btn-secondary px-4 py-2 text-xs">Retry</button>
            </div>
          )}

          {!channelsLoading && !channelsError && activeChannels.length === 0 && (
            <div className="flex items-center gap-3 p-3 rounded-xl bg-secondary">
              <div className="w-10 h-10 rounded-xl gradient-brand flex items-center justify-center">
                <MessageCircle size={18} color="white" />
              </div>
              <div>
                <p className="text-sm font-semibold text-primary">No channel connected</p>
                <p className="text-xs text-secondary">Connect your Telegram channel below</p>
              </div>
            </div>
          )}

          {!channelsLoading && !channelsError && activeChannels.map((channel) => (
            <div key={channel.id} className="flex items-center gap-3 p-3 rounded-xl bg-secondary">
              <div className="w-10 h-10 rounded-xl gradient-brand flex items-center justify-center flex-shrink-0">
                <MessageCircle size={18} color="white" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-primary truncate">
                  {channel.channelName || channel.channelUsername || `Channel #${channel.id}`}
                </p>
                <ChannelStatusBadge status={channel.status} />
              </div>
              {channel.status === "verified" && (
                <button
                  onClick={() => setDisconnectTarget(channel)}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold text-red-500 bg-red-50 dark:bg-red-900/20 flex-shrink-0"
                >
                  Disconnect
                </button>
              )}
            </div>
          ))}
        </div>

        {/* Connect new channel */}
        <div className="bg-card rounded-2xl p-4 border border-app shadow-app-sm flex flex-col gap-3">
          {showConnectNew ? (
            <>
              <h3 className="text-sm font-semibold text-primary">Connect New Channel</h3>
              <ChannelConnectFlow onConnected={handleChannelConnected} />
            </>
          ) : (
            <button
              onClick={() => setShowConnectNew(true)}
              className="btn-primary py-3 text-sm flex items-center justify-center gap-2"
            >
              <Plus size={16} />
              Connect New Channel
            </button>
          )}
        </div>

        <DeleteConfirmModal
          open={!!disconnectTarget}
          onClose={() => setDisconnectTarget(null)}
          onConfirm={handleDisconnectConfirm}
          loading={disconnecting}
          title="Disconnect Channel"
          description={`Are you sure you want to disconnect ${disconnectTarget?.channelName || disconnectTarget?.channelUsername || "this channel"}? Onfile will no longer be able to deliver files through it.`}
        />
      </div>
    );
  }

  if (subPage === "faq") {
    return <Faq />;
  }

  if (subPage === "editProfile") {
    return <EditProfile onDone={() => setSubPage(null)} />;
  }

  if (subPage === "account") {
    return <AccountInfo onEditProfile={() => setSubPage("editProfile")} />;
  }

  if (subPage === "privacy") {
    return <PrivacySecurityPage />;
  }

  if (subPage === "terms") {
    return <TermsPage />;
  }

  // Main Profile Page — creator account dashboard
  const displayName = user?.firstName?.trim() || "Creator";
  return (
    <div className="flex flex-col gap-5" data-testid="me-root">
      {/* Profile header */}
      <section className="bg-card rounded-2xl p-4 border border-app shadow-app-sm" aria-label="Profile">
        <div className="flex items-center gap-4">
          <TelegramAvatar photoUrl={user?.avatarUrl} firstName={user?.firstName} username={user?.username} size="lg" />
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-bold text-primary truncate">{displayName}</h2>
            <p className="text-sm text-secondary truncate">{user?.username ? `@${user.username}` : "No Telegram username"}</p>
          </div>
        </div>
        <button
          onClick={() => setSubPage("editProfile")}
          className="btn-secondary w-full min-h-11 mt-4 text-sm font-semibold flex items-center justify-center gap-2"
        >
          <Pencil size={14} />
          Edit Profile
        </button>
        <div className="grid grid-cols-2 gap-3 mt-4 pt-4 border-t border-app">
          {[
            { label: "Downloads", value: formatNumber(user?.totalDownloads ?? 0) },
            { label: "Earned", value: `$${Number(user?.totalEarnings ?? 0).toFixed(2)}` },
          ].map(({ label, value }) => (
            <div key={label} className="text-center">
              <p className="text-lg font-bold text-primary">{value}</p>
              <p className="text-xs text-secondary">{label}</p>
            </div>
          ))}
        </div>
      </section>

      <Group title="Account">
        <ProfileRow icon={Pencil} label="Edit Profile" onClick={() => setSubPage("editProfile")} />
        <ProfileRow icon={IdCard} label="Account Information" onClick={() => setSubPage("account")} />
      </Group>

      <Group title="Creator">
        <ProfileRow icon={MessageCircle} label="Channel Management" onClick={() => setSubPage("channel")} />
        <ProfileRow
          icon={Wallet}
          label="Earnings & Withdrawals"
          value={`Min $${MIN_WITHDRAWAL_USD}`}
          onClick={() => setActiveTab("wallet")}
        />
        <ProfileRow icon={Gift} label="Referral Program" value={user?.referralCode || undefined} onClick={() => setSubPage("referrals")} />
        <ProfileRow icon={Megaphone} label="Advertise with Us" onClick={() => setSubPage("advertise")} />
        {/* Admin-only: thumbnail storage status (shown only when the server says this session is an admin) */}
        {user?.isAdmin && <ProfileRow icon={Database} label="Thumbnail Storage (admin)" href="/admin/storage" />}
      </Group>

      <Group title="Support & Information">
        <ProfileRow icon={HelpCircle} label="FAQ & Help" onClick={() => setSubPage("faq")} />
        <ProfileRow icon={Shield} label="Privacy & Security" onClick={() => setSubPage("privacy")} />
        <ProfileRow icon={FileText} label="Terms & Conditions" onClick={() => setSubPage("terms")} />
      </Group>

      <Group title="Other">
        <ProfileRow
          icon={dark ? Sun : Moon}
          label={dark ? "Switch to Light Mode" : "Switch to Dark Mode"}
          onClick={toggle}
          role="switch"
          checked={dark}
          action={
            <span
              aria-hidden
              className={cn("w-11 h-6 rounded-full transition-colors relative flex-shrink-0", dark ? "bg-brand" : "bg-gray-200 dark:bg-gray-700")}
            >
              <span className={cn("absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform", dark ? "translate-x-5" : "translate-x-0.5")} />
            </span>
          }
          noChevron
        />
      </Group>

      <div className="text-center">
        <p className="text-xs text-muted">Onfile v1.0.0</p>
      </div>
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-2">
      <h3 className="px-1 text-xs font-semibold text-secondary uppercase tracking-wide">{title}</h3>
      <div className="bg-card rounded-2xl border border-app shadow-app-sm overflow-hidden">{children}</div>
    </section>
  );
}

function ChannelStatusBadge({ status }: { status: ConnectedChannel["status"] }) {
  const config: Record<ConnectedChannel["status"], { label: string; className: string; icon: React.ReactNode }> = {
    verified: { label: "Connected", className: "text-green-600 dark:text-green-400", icon: <CheckCircle2 size={11} /> },
    pending: { label: "Verifying...", className: "text-yellow-600 dark:text-yellow-400", icon: <Clock size={11} /> },
    failed: { label: "Verification failed", className: "text-red-500", icon: <XCircle size={11} /> },
    disconnected: { label: "Disconnected", className: "text-secondary", icon: <XCircle size={11} /> },
  };
  const { label, className, icon } = config[status];
  return (
    <span className={cn("text-xs flex items-center gap-1", className)}>
      {icon}
      {label}
    </span>
  );
}

function ProfileRow({
  icon: Icon,
  label,
  value,
  action,
  onClick,
  href,
  noChevron,
  role,
  checked,
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
  value?: string;
  action?: React.ReactNode;
  onClick?: () => void;
  href?: string;
  noChevron?: boolean;
  role?: "switch";
  checked?: boolean;
}) {
  const classes = "w-full flex items-center gap-3 px-4 min-h-[52px] py-2.5 border-b border-app last:border-0 text-left transition-colors active:bg-secondary hover:bg-secondary";
  const inner = (
    <>
      <span className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 bg-brand-10">
        <Icon size={15} className="text-brand" />
      </span>
      <span className="flex-1 min-w-0 text-sm font-medium text-primary truncate">{label}</span>
      {value && <span className="text-xs text-secondary flex-shrink-0 max-w-[40%] truncate">{value}</span>}
      {action}
      {!noChevron && !action && <ChevronRight size={14} className="text-muted flex-shrink-0" />}
    </>
  );
  if (href) {
    return (
      <Link href={href} className={classes}>
        {inner}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} className={classes} role={role} aria-checked={role === "switch" ? checked : undefined}>
      {inner}
    </button>
  );
}
