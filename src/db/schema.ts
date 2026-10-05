import {
  pgTable,
  serial,
  text,
  varchar,
  integer,
  bigint,
  boolean,
  timestamp,
  numeric,
  pgEnum,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

// ─── Enums ────────────────────────────────────────────────────────────────────
export const transactionStatusEnum = pgEnum("transaction_status", [
  "available",
  "pending",
  "completed",
  "refunded",
  "cancelled",
]);

export const withdrawalStatusEnum = pgEnum("withdrawal_status", [
  "pending",
  "processing",
  "completed",
  "rejected",
  "cancelled",
]);

export const fileTypeEnum = pgEnum("file_type", [
  "video",
  "audio",
  "document",
  "image",
  "archive",
  "other",
]);

export const reportReasonEnum = pgEnum("report_reason", [
  "copyright",
  "nsfw",
  "malware",
  "broken_link",
  "spam",
  "other",
]);

export const reportStatusEnum = pgEnum("report_status", [
  "pending",
  "reviewed",
  "dismissed",
  "actioned",
]);

export const campaignStatusEnum = pgEnum("campaign_status", [
  "pending",
  "active",
  "paused",
  "completed",
  "rejected",
]);

// ─── Users ────────────────────────────────────────────────────────────────────
export const users = pgTable(
  "users",
  {
    id: serial("id").primaryKey(),
    telegramId: varchar("telegram_id", { length: 64 }).unique(),
    username: varchar("username", { length: 128 }),
    firstName: varchar("first_name", { length: 128 }),
    lastName: varchar("last_name", { length: 128 }),
    avatarUrl: text("avatar_url"),
    email: varchar("email", { length: 256 }),
    language: varchar("language", { length: 10 }).default("en"),
    darkMode: boolean("dark_mode").default(false),
    referralCode: varchar("referral_code", { length: 16 }).unique(),
    referredBy: integer("referred_by"),
    balance: numeric("balance", { precision: 18, scale: 6 }).default("0"),
    pendingBalance: numeric("pending_balance", { precision: 18, scale: 6 }).default("0"),
    referralEarnings: numeric("referral_earnings", { precision: 18, scale: 6 }).default("0"),
    totalDownloads: integer("total_downloads").default(0),
    totalEarnings: numeric("total_earnings", { precision: 18, scale: 6 }).default("0"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (t) => [uniqueIndex("users_telegram_id_idx").on(t.telegramId)]
);

// ─── Channels ─────────────────────────────────────────────────────────────────
export const channels = pgTable("channels", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  telegramChannelId: varchar("telegram_channel_id", { length: 64 }),
  channelName: varchar("channel_name", { length: 256 }),
  channelUsername: varchar("channel_username", { length: 128 }),
  isVerified: boolean("is_verified").default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

// ─── Playlists ────────────────────────────────────────────────────────────────
export const playlists = pgTable("playlists", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  title: varchar("title", { length: 256 }).notNull(),
  description: text("description"),
  coverUrl: text("cover_url"),
  password: varchar("password", { length: 256 }),
  starsPrice: integer("stars_price").default(0),
  isPublished: boolean("is_published").default(false),
  totalFiles: integer("total_files").default(0),
  totalViews: integer("total_views").default(0),
  totalDownloads: integer("total_downloads").default(0),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// ─── Files ────────────────────────────────────────────────────────────────────
export const files = pgTable(
  "files",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull(),
    playlistId: integer("playlist_id"),
    title: varchar("title", { length: 256 }).notNull(),
    description: text("description"),
    category: varchar("category", { length: 64 }),
    fileType: fileTypeEnum("file_type").default("other"),
    fileSize: bigint("file_size", { mode: "number" }),
    mimeType: varchar("mime_type", { length: 128 }),
    telegramMessageLink: text("telegram_message_link"),
    telegramFileId: varchar("telegram_file_id", { length: 256 }),
    password: varchar("password", { length: 256 }),
    starsPrice: integer("stars_price").default(0),
    smartLinkSlug: varchar("smart_link_slug", { length: 64 }).unique(),
    isPublished: boolean("is_published").default(false),
    views: integer("views").default(0),
    downloads: integer("downloads").default(0),
    earnings: numeric("earnings", { precision: 18, scale: 6 }).default("0"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (t) => [
    index("files_user_id_idx").on(t.userId),
    index("files_playlist_id_idx").on(t.playlistId),
  ]
);

// ─── Analytics ────────────────────────────────────────────────────────────────
export const analytics = pgTable(
  "analytics",
  {
    id: serial("id").primaryKey(),
    fileId: integer("file_id"),
    playlistId: integer("playlist_id"),
    userId: integer("user_id"),
    eventType: varchar("event_type", { length: 32 }),
    ipHash: varchar("ip_hash", { length: 64 }),
    country: varchar("country", { length: 8 }),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (t) => [index("analytics_file_id_idx").on(t.fileId)]
);

// ─── Transactions ─────────────────────────────────────────────────────────────
export const transactions = pgTable("transactions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  type: varchar("type", { length: 32 }).notNull(),
  amount: numeric("amount", { precision: 18, scale: 6 }).notNull(),
  currency: varchar("currency", { length: 16 }).default("USDT"),
  status: transactionStatusEnum("status").default("available"),
  description: text("description"),
  referenceId: varchar("reference_id", { length: 128 }),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// ─── Withdrawals ──────────────────────────────────────────────────────────────
export const withdrawals = pgTable("withdrawals", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  amount: numeric("amount", { precision: 18, scale: 6 }).notNull(),
  currency: varchar("currency", { length: 16 }).default("USDT"),
  walletAddress: text("wallet_address").notNull(),
  network: varchar("network", { length: 32 }),
  status: withdrawalStatusEnum("status").default("pending"),
  txHash: text("tx_hash"),
  rejectionReason: text("rejection_reason"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// ─── Referrals ────────────────────────────────────────────────────────────────
export const referrals = pgTable("referrals", {
  id: serial("id").primaryKey(),
  referrerId: integer("referrer_id").notNull(),
  refereeId: integer("referee_id").notNull(),
  commissionEarned: numeric("commission_earned", { precision: 18, scale: 6 }).default("0"),
  createdAt: timestamp("created_at").defaultNow(),
});

// ─── Reports ──────────────────────────────────────────────────────────────────
export const reports = pgTable("reports", {
  id: serial("id").primaryKey(),
  fileId: integer("file_id"),
  reporterIp: varchar("reporter_ip", { length: 64 }),
  reason: reportReasonEnum("reason").notNull(),
  description: text("description"),
  status: reportStatusEnum("status").default("pending"),
  createdAt: timestamp("created_at").defaultNow(),
  reviewedAt: timestamp("reviewed_at"),
});

// ─── Ad Campaigns ─────────────────────────────────────────────────────────────
export const adCampaigns = pgTable("ad_campaigns", {
  id: serial("id").primaryKey(),
  advertiserName: varchar("advertiser_name", { length: 256 }).notNull(),
  advertiserEmail: varchar("advertiser_email", { length: 256 }).notNull(),
  network: varchar("network", { length: 64 }),
  campaignName: varchar("campaign_name", { length: 256 }),
  budget: numeric("budget", { precision: 18, scale: 2 }),
  targetUrl: text("target_url"),
  message: text("message"),
  status: campaignStatusEnum("status").default("pending"),
  impressions: integer("impressions").default(0),
  clicks: integer("clicks").default(0),
  createdAt: timestamp("created_at").defaultNow(),
});

// ─── Link Access Tokens ───────────────────────────────────────────────────────
export const linkTokens = pgTable("link_tokens", {
  id: serial("id").primaryKey(),
  fileId: integer("file_id").notNull(),
  token: varchar("token", { length: 128 }).unique().notNull(),
  expiresAt: timestamp("expires_at"),
  usedAt: timestamp("used_at"),
  createdAt: timestamp("created_at").defaultNow(),
});
