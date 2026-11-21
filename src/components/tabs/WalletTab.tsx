"use client";
import React, { useState, useEffect, useCallback } from "react";
import {
  Wallet, ArrowDownLeft, ArrowUpRight, Clock, CheckCircle2, XCircle,
  Copy, AlertCircle, ChevronDown, ChevronUp, Gift, TrendingUp, Loader2
} from "lucide-react";
import { cn, formatCurrency, timeAgo } from "@/lib/utils";
import Modal from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { useApp } from "@/contexts/AppContext";

interface Transaction {
  id: number;
  type: string;
  amount: string;
  currency: string;
  status: string;
  description?: string;
  createdAt: string;
}

interface Withdrawal {
  id: number;
  amount: string;
  currency: string;
  walletAddress: string;
  network?: string;
  status: string;
  rejectionReason?: string;
  txHash?: string;
  createdAt: string;
}

const STATUS_COLORS: Record<string, string> = {
  available: "status-completed",
  completed: "status-completed",
  pending: "status-pending",
  processing: "status-processing",
  refunded: "status-processing",
  cancelled: "status-rejected",
  rejected: "status-rejected",
};

const STATUS_ICONS: Record<string, React.ReactNode> = {
  available: <CheckCircle2 size={12} />,
  completed: <CheckCircle2 size={12} />,
  pending: <Clock size={12} />,
  processing: <Loader2 size={12} className="animate-spin" />,
  refunded: <ArrowDownLeft size={12} />,
  cancelled: <XCircle size={12} />,
  rejected: <XCircle size={12} />,
};

export default function WalletTab() {
  const { toast } = useToast();
  const { user, refreshUser } = useApp();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);
  const [loading, setLoading] = useState(true);
  const [showWithdrawModal, setShowWithdrawModal] = useState(false);
  const [activeSection, setActiveSection] = useState<"transactions" | "withdrawals">("transactions");
  const [withdrawForm, setWithdrawForm] = useState({
    amount: "",
    walletAddress: "",
    network: "TRC20",
    currency: "USDT",
  });
  const [withdrawLoading, setWithdrawLoading] = useState(false);

  const fetchWallet = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/wallet");
      if (res.ok) {
        const data = await res.json();
        setTransactions(data.transactions || []);
        setWithdrawals(data.withdrawals || []);
      }
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchWallet(); }, [fetchWallet]);

  const handleWithdraw = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!withdrawForm.amount || !withdrawForm.walletAddress) {
      toast("Please fill all required fields", "error");
      return;
    }
    setWithdrawLoading(true);
    try {
      const res = await fetch("/api/wallet/withdraw", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(withdrawForm),
      });
      const data = await res.json();
      if (res.ok) {
        toast("Withdrawal request submitted! ✅");
        setShowWithdrawModal(false);
        setWithdrawForm({ amount: "", walletAddress: "", network: "TRC20", currency: "USDT" });
        fetchWallet();
        refreshUser();
      } else {
        toast(data.error || "Withdrawal failed", "error");
      }
    } catch {
      toast("Network error. Please retry.", "error");
    } finally {
      setWithdrawLoading(false);
    }
  };

  const copyAddress = (address: string) => {
    navigator.clipboard.writeText(address);
    toast("Address copied!");
  };

  const balance = Number(user?.balance ?? 0);
  const pending = Number(user?.pendingBalance ?? 0);
  const referralEarnings = Number(user?.referralEarnings ?? 0);
  const totalEarnings = Number(user?.totalEarnings ?? 0);

  return (
    <div className="flex flex-col gap-5">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-primary">Wallet</h1>
        <p className="text-xs text-secondary mt-0.5">Manage your earnings and payouts</p>
      </div>

      {/* Balance Cards */}
      <div className="rounded-2xl gradient-brand text-white p-5 relative overflow-hidden">
        <div className="absolute -top-6 -right-6 w-24 h-24 rounded-full bg-white/10" />
        <div className="absolute -bottom-4 right-8 w-14 h-14 rounded-full bg-white/10" />
        <div className="relative z-10">
          <div className="flex items-center gap-2 mb-1">
            <Wallet size={14} className="opacity-80" />
            <span className="text-sm opacity-80">Available Balance</span>
          </div>
          <p className="text-3xl font-bold">{balance.toFixed(4)} USDT</p>
          <p className="text-sm opacity-70 mt-1">≈ ${(balance * 1).toFixed(2)} USD</p>
          <button
            onClick={() => setShowWithdrawModal(true)}
            className="mt-4 px-5 py-2.5 rounded-xl bg-white text-brand font-semibold text-sm hover:bg-opacity-90 transition-all"
            style={{ color: "#FF6115" }}
          >
            Withdraw Now
          </button>
        </div>
      </div>

      {/* Balance Breakdown */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Pending", value: `${pending.toFixed(4)}`, icon: Clock, color: "text-yellow-500", bg: "bg-yellow-50 dark:bg-yellow-900/20" },
          { label: "Referral", value: `${referralEarnings.toFixed(4)}`, icon: Gift, color: "text-purple-500", bg: "bg-purple-50 dark:bg-purple-900/20" },
          { label: "All Time", value: `${totalEarnings.toFixed(2)}`, icon: TrendingUp, color: "text-brand", bg: "bg-brand-10" },
        ].map(({ label, value, icon: Icon, color, bg }) => (
          <div key={label} className="bg-card rounded-2xl p-3 border border-app shadow-app-sm text-center">
            <div className={cn("w-8 h-8 rounded-xl mx-auto flex items-center justify-center mb-2", bg)}>
              <Icon size={15} className={color} />
            </div>
            <p className="text-sm font-bold text-primary">{value}</p>
            <p className="text-xs text-secondary">{label}</p>
          </div>
        ))}
      </div>

      {/* Withdrawal Methods */}
      <div className="bg-card rounded-2xl p-4 border border-app shadow-app-sm">
        <h3 className="text-sm font-semibold text-primary mb-3">Withdrawal Methods</h3>
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-3 p-3 rounded-xl border-2 border-brand bg-brand-10">
            <div className="w-9 h-9 rounded-lg gradient-brand flex items-center justify-center text-sm font-bold text-white">₮</div>
            <div className="flex-1">
              <p className="text-sm font-semibold text-primary">USDT / TON Crypto</p>
              <p className="text-xs text-secondary">TRC20, ERC20, TON network</p>
            </div>
            <div className="chip bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">Active</div>
          </div>
          <div className="flex items-center gap-3 p-3 rounded-xl border border-app opacity-60">
            <div className="w-9 h-9 rounded-lg bg-blue-500/10 flex items-center justify-center text-sm font-bold text-blue-600">P</div>
            <div className="flex-1">
              <p className="text-sm font-semibold text-primary">PayPal</p>
              <p className="text-xs text-secondary">Coming soon...</p>
            </div>
            <div className="chip bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400">Soon</div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2">
        {[
          { key: "transactions" as const, label: "Transactions" },
          { key: "withdrawals" as const, label: "Withdrawals" },
        ].map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setActiveSection(key)}
            className={cn(
              "flex-1 py-2 rounded-xl text-sm font-semibold transition-all",
              activeSection === key ? "tab-active" : "bg-secondary text-secondary"
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {/* List */}
      {loading ? (
        <div className="flex flex-col gap-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-card rounded-2xl p-4 border border-app h-16 animate-pulse-brand" />
          ))}
        </div>
      ) : activeSection === "transactions" ? (
        <div className="flex flex-col gap-2">
          {transactions.length === 0 ? (
            <EmptyState label="No transactions yet" />
          ) : (
            transactions.map((tx) => (
              <div key={tx.id} className="bg-card rounded-2xl p-4 border border-app shadow-app-sm flex items-center gap-3">
                <div className={cn(
                  "w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0",
                  tx.type === "withdrawal" ? "bg-red-50 dark:bg-red-900/20"
                    : tx.type === "referral" ? "bg-purple-50 dark:bg-purple-900/20"
                      : "bg-green-50 dark:bg-green-900/20"
                )}>
                  {tx.type === "withdrawal" ? (
                    <ArrowUpRight size={16} className="text-red-500" />
                  ) : tx.type === "referral" ? (
                    <Gift size={16} className="text-purple-500" />
                  ) : (
                    <ArrowDownLeft size={16} className="text-green-500" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-primary line-clamp-1">{tx.description || tx.type}</p>
                  <p className="text-xs text-secondary">{timeAgo(tx.createdAt)}</p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className={cn(
                    "text-sm font-bold",
                    tx.type === "withdrawal" ? "text-red-500" : "text-green-500"
                  )}>
                    {tx.type === "withdrawal" ? "-" : "+"}{Number(tx.amount).toFixed(4)} {tx.currency}
                  </p>
                  <span className={cn("chip text-xs", STATUS_COLORS[tx.status] ?? "status-pending")}>
                    {tx.status}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {withdrawals.length === 0 ? (
            <EmptyState label="No withdrawal history" />
          ) : (
            withdrawals.map((wd) => (
              <div key={wd.id} className="bg-card rounded-2xl p-4 border border-app shadow-app-sm">
                <div className="flex items-center gap-3">
                  <div className={cn(
                    "w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 font-bold text-sm text-white",
                    wd.status === "completed" ? "gradient-brand" : "bg-secondary"
                  )}>
                    ₮
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-primary">
                      {Number(wd.amount).toFixed(4)} {wd.currency}
                    </p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <p className="text-xs text-secondary truncate max-w-[120px]">
                        {wd.walletAddress}
                      </p>
                      <button onClick={() => copyAddress(wd.walletAddress)}>
                        <Copy size={10} className="text-muted" />
                      </button>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className={cn("chip", STATUS_COLORS[wd.status] ?? "status-pending")}>
                      {STATUS_ICONS[wd.status]}
                      {wd.status}
                    </span>
                    <p className="text-xs text-secondary mt-1">{timeAgo(wd.createdAt)}</p>
                  </div>
                </div>
                {wd.status === "rejected" && wd.rejectionReason && (
                  <div className="mt-2 p-2 rounded-lg bg-red-50 dark:bg-red-900/20 flex items-start gap-2">
                    <AlertCircle size={12} className="text-red-500 mt-0.5 flex-shrink-0" />
                    <p className="text-xs text-red-600 dark:text-red-400">{wd.rejectionReason}</p>
                  </div>
                )}
                {wd.txHash && (
                  <p className="text-xs text-brand mt-2 truncate">Tx: {wd.txHash}</p>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {/* Withdraw Modal */}
      <Modal
        open={showWithdrawModal}
        onClose={() => setShowWithdrawModal(false)}
        title="Withdraw Funds"
        size="md"
      >
        <form onSubmit={handleWithdraw} className="flex flex-col gap-4">
          <div className="p-3 rounded-xl bg-brand-10 border border-brand text-xs">
            <p className="font-semibold text-brand mb-0.5">Available: {balance.toFixed(4)} USDT</p>
            <p className="text-secondary">Minimum withdrawal: 1 USDT</p>
          </div>

          <div>
            <label className="text-xs font-medium text-secondary mb-1.5 block">Amount (USDT) *</label>
            <input
              className="input-app text-sm"
              type="number"
              step="0.0001"
              min="1"
              max={balance}
              placeholder="0.0000"
              value={withdrawForm.amount}
              onChange={(e) => setWithdrawForm((prev) => ({ ...prev, amount: e.target.value }))}
              required
            />
          </div>

          <div>
            <label className="text-xs font-medium text-secondary mb-1.5 block">Network</label>
            <select
              className="input-app text-sm"
              value={withdrawForm.network}
              onChange={(e) => setWithdrawForm((prev) => ({ ...prev, network: e.target.value }))}
            >
              <option value="TRC20">TRC20 (USDT)</option>
              <option value="ERC20">ERC20 (USDT)</option>
              <option value="TON">TON</option>
              <option value="BEP20">BEP20 (BSC)</option>
            </select>
          </div>

          <div>
            <label className="text-xs font-medium text-secondary mb-1.5 block">Wallet Address *</label>
            <input
              className="input-app text-sm font-mono"
              placeholder="Enter your wallet address..."
              value={withdrawForm.walletAddress}
              onChange={(e) => setWithdrawForm((prev) => ({ ...prev, walletAddress: e.target.value }))}
              required
            />
          </div>

          <div className="p-3 rounded-xl bg-secondary flex items-start gap-2">
            <AlertCircle size={13} className="text-yellow-500 mt-0.5 flex-shrink-0" />
            <p className="text-xs text-secondary">
              Withdrawals are processed within 24-72 hours. Ensure the wallet address and network are correct. Wrong address = lost funds.
            </p>
          </div>

          <div className="flex gap-3">
            <button type="button" onClick={() => setShowWithdrawModal(false)} className="flex-1 btn-secondary py-3 text-sm">
              Cancel
            </button>
            <button type="submit" disabled={withdrawLoading} className="flex-1 btn-primary py-3 text-sm">
              {withdrawLoading ? "Submitting..." : "Submit Request"}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12">
      <Wallet size={32} className="text-muted opacity-40" />
      <p className="text-sm text-secondary">{label}</p>
    </div>
  );
}
