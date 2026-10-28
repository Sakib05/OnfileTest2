import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatBytes(bytes: number | null | undefined): string {
  if (!bytes) return "Unknown size";
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  return (bytes / (1024 * 1024 * 1024)).toFixed(1) + " GB";
}

export function formatNumber(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return n.toString();
}

export function formatCurrency(amount: string | number | null | undefined, currency = "USDT"): string {
  const n = Number(amount ?? 0);
  return n.toFixed(4) + " " + currency;
}

export function formatUSD(amount: string | number | null | undefined): string {
  const n = Number(amount ?? 0);
  return "$" + n.toFixed(2);
}

export function timeAgo(date: Date | string | null | undefined): string {
  if (!date) return "";
  const d = typeof date === "string" ? new Date(date) : date;
  const now = new Date();
  const diff = Math.floor((now.getTime() - d.getTime()) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return Math.floor(diff / 60) + "m ago";
  if (diff < 86400) return Math.floor(diff / 3600) + "h ago";
  if (diff < 604800) return Math.floor(diff / 86400) + "d ago";
  return d.toLocaleDateString();
}

export function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good Morning";
  if (hour < 17) return "Good Afternoon";
  if (hour < 20) return "Good Evening";
  return "Good Night";
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export function getFileTypeIcon(type: string): string {
  switch (type) {
    case "video": return "🎬";
    case "audio": return "🎵";
    case "document": return "📄";
    case "image": return "🖼️";
    case "archive": return "📦";
    default: return "📁";
  }
}

export function getFileTypeBadgeColor(type: string): string {
  switch (type) {
    case "video": return "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300";
    case "audio": return "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300";
    case "document": return "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300";
    case "image": return "bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-300";
    case "archive": return "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300";
    default: return "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300";
  }
}
