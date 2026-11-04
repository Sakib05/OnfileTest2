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
  jsonb,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

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

// Status of a channel's connection to Onfile's bot. "pending" is used only
// transiently while a verification call is in flight; persisted rows are
// always "verified", "failed" or "disconnected".
export const channelStatusEnum = pgEnum("channel_status", [
  "pending",
  "verified",
  "failed",
  "disconnected",
]);

// Status of a short-lived, durable channel-connection correlation request
// (see src/lib/pendingChannelRequests.ts). Replaces the previous in-memory
// Map so the native Telegram "select chat" flow survives serverless
// restarts and works across multiple Vercel instances.
export const pendingChannelRequestStatusEnum = pgEnum("pending_channel_request_status", [
  "pending",
  "verified",
  "failed",
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

export type User = typeof users.$inferSelect;

// ─── Secure Sessions ────────────────────────────────────────────────────────
// Opaque, server-issued session tokens. Only a SHA-256 hash of the token is
// ever stored — the raw token exists solely in the user's HTTP-only cookie.
export const sessions = pgTable(
  "sessions",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: varchar("token_hash", { length: 128 }).notNull(),
    createdAt: timestamp("created_at").defaultNow(),
    expiresAt: timestamp("expires_at").notNull(),
    lastUsedAt: timestamp("last_used_at").defaultNow(),
    userAgent: text("user_agent"),
  },
  (t) => [
    uniqueIndex("sessions_token_hash_idx").on(t.tokenHash),
    index("sessions_user_id_idx").on(t.userId),
  ]
);

// ─── Channels ─────────────────────────────────────────────────────────────────
// A channel row is only ever created once Telegram channel ownership AND bot
// admin permissions have been verified server-side (see src/lib/telegramBot.ts
// and src/app/api/channels/route.ts). Nothing here is ever trusted verbatim
// from the client.
export const channels = pgTable(
  "channels",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    telegramChannelId: varchar("telegram_channel_id", { length: 64 }),
    channelName: varchar("channel_name", { length: 256 }),
    channelUsername: varchar("channel_username", { length: 128 }),
    status: channelStatusEnum("status").default("pending"),
    // Kept for backward compatibility with any existing reads; always kept
    // in sync with `status === 'verified'`.
    isVerified: boolean("is_verified").default(false),
    botIsAdmin: boolean("bot_is_admin").default(false),
    verifiedAt: timestamp("verified_at"),
    lastCheckedAt: timestamp("last_checked_at"),
    disconnectedAt: timestamp("disconnected_at"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (t) => [
    // A given Telegram channel can only be actively connected to one
    // creator account at a time. NULLs (not-yet-resolved rows) are exempt
    // from Postgres uniqueness, which is fine because we only persist a
    // channel row after resolving its Telegram id.
    uniqueIndex("channels_telegram_channel_id_idx").on(t.telegramChannelId),
    index("channels_user_id_idx").on(t.userId),
  ]
);

// ─── Pending Channel Connection Requests ───────────────────────────────────────
// Durable correlation state for the native Telegram "select a chat, then add
// the bot as admin" connection flow (request_chat / chat_shared). This used
// to live in a process-local Map, which breaks on Vercel because separate
// serverless instances don't share memory and instances can restart at any
// time between a user tapping "select channel" and Telegram's webhook
// delivering the result. Persisting it here means:
//   - the webhook (which may land on a different instance than the one that
//     created the request) can always find it,
//   - the browser can keep polling /api/channels/connect-status after a
//     redeploy or cold start,
//   - nothing here is ever trusted as proof of anything by itself — the
//     channel row is only written after live Telegram Bot API verification
//     (see src/lib/channelConnection.ts); this table only stores routing
//     state plus the *result* of that verification.
// `tokenHash` (not the raw correlation token) is stored, mirroring the
// `sessions` table pattern, so a database read alone can't be replayed as a
// valid bearer token.
export const pendingChannelRequests = pgTable(
  "pending_channel_requests",
  {
    id: serial("id").primaryKey(),
    tokenHash: varchar("token_hash", { length: 128 }).notNull(),
    telegramRequestId: integer("telegram_request_id").notNull(),
    telegramUserId: varchar("telegram_user_id", { length: 64 }).notNull(),
    // Non-null only for a returning, already-authenticated creator
    // connecting an additional/replacement channel.
    sessionUserId: integer("session_user_id"),
    // JSON-encoded TelegramInitDataUser snapshot, used only to finalize a
    // brand-new account once the channel is verified. Never trusted as
    // proof of anything beyond "what to pre-fill the new account with".
    telegramProfile: text("telegram_profile"),
    status: pendingChannelRequestStatusEnum("status").default("pending").notNull(),
    failureReason: varchar("failure_reason", { length: 64 }),
    // Populated only after independent Telegram Bot API verification and
    // successful persistence of the channel (and, for new creators, the
    // user) row.
    resolvedUserId: integer("resolved_user_id"),
    resolvedChannelId: integer("resolved_channel_id"),
    isNewAccount: boolean("is_new_account").default(false).notNull(),
    // Atomic "claim" marker used to make webhook processing idempotent under
    // concurrent/duplicate Telegram deliveries (e.g. a `chat_shared` message
    // AND a `my_chat_member` update both resolving the same request — see
    // src/app/api/telegram/webhook/route.ts). A single `UPDATE ... WHERE
    // status = 'pending' AND claimed_at IS NULL` is atomic at the Postgres
    // row level, so only one concurrent webhook delivery can ever "win" the
    // right to verify + persist a given pending request, even across
    // separate serverless instances.
    claimedAt: timestamp("claimed_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
    expiresAt: timestamp("expires_at").notNull(),
  },
  (t) => [
    uniqueIndex("pending_channel_requests_token_hash_idx").on(t.tokenHash),
    index("pending_channel_requests_telegram_lookup_idx").on(t.telegramUserId, t.telegramRequestId),
    index("pending_channel_requests_expires_at_idx").on(t.expiresAt),
  ]
);

// ─── Telegram Update Idempotency Log ────────────────────────────────────────
// Records every Telegram `update_id` the webhook has already processed.
// Telegram explicitly documents that it may redeliver the same update (e.g.
// if our webhook response is slow/times out), so a duplicate delivery must
// never be processed twice. `updateId` is globally unique per bot, so a
// simple unique-constraint insert-or-ignore is sufficient and requires no
// extra correlation state.
export const telegramUpdateLog = pgTable("telegram_update_log", {
  id: serial("id").primaryKey(),
  updateId: bigint("update_id", { mode: "number" }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [uniqueIndex("telegram_update_log_update_id_idx").on(t.updateId)]);

// ─── Bot Channel Admin Events ───────────────────────────────────────────────
// Durable record of the most recent Telegram `my_chat_member` update for
// each channel the bot has ever been added to/removed from, keyed by the
// Telegram user who performed that action. This is the authoritative signal
// Onfile uses to discover "which channel did this authenticated Telegram
// user just add our bot to as administrator" — the only reliable way to
// correlate Manual Connect's pasted private invite link (which the Bot API
// cannot resolve to a chat on its own; see src/lib/telegramBot.ts) with a
// real, bot-verified channel. Also used as a resilience fallback for the
// native chat-picker ("Connect Channel via Bot") flow in case the
// `chat_shared` service message is delayed or never delivered.
// One row per Telegram channel (`telegramChatId` is unique) always reflects
// the *latest known* membership state — never trusted as proof by itself;
// every connection is independently re-verified live against the Telegram
// Bot API (getChatMember) before anything is persisted to `channels`.
export const botChannelAdminEvents = pgTable(
  "bot_channel_admin_events",
  {
    id: serial("id").primaryKey(),
    telegramChatId: varchar("telegram_chat_id", { length: 64 }).notNull(),
    // The Telegram user who performed the membership-changing action
    // (`my_chat_member.from.id`) — i.e. the admin who added/removed the bot.
    telegramUserId: varchar("telegram_user_id", { length: 64 }).notNull(),
    chatTitle: varchar("chat_title", { length: 256 }),
    chatUsername: varchar("chat_username", { length: 128 }),
    isChannel: boolean("is_channel").default(false).notNull(),
    // Bot's new membership status from Telegram: "administrator", "member",
    // "left", "kicked", "restricted", etc.
    botStatus: varchar("bot_status", { length: 32 }).notNull(),
    canPostMessages: boolean("can_post_messages"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("bot_channel_admin_events_chat_id_idx").on(t.telegramChatId),
    index("bot_channel_admin_events_user_id_idx").on(t.telegramUserId),
  ]
);

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

// ═══════════════════════════════════════════════════════════════════════════
// Multi-provider thumbnail storage (see docs/THUMBNAIL_STORAGE.md)
//
// Only optional *thumbnail images* live in external providers. The actual
// digital files stay in creators' private Telegram channels.
// No provider secrets are ever stored in these tables — credentials live in
// environment variables only.
// Timestamps in this block are timezone-aware (timestamptz).
// ═══════════════════════════════════════════════════════════════════════════

export const storageProviderStatusEnum = pgEnum("storage_provider_status", [
  "ACTIVE",
  "NEAR_LIMIT",
  "EXHAUSTED",
  "DRAINING",
  "DISABLED",
  "ERROR",
]);

export const storageUsageSourceEnum = pgEnum("storage_usage_source", [
  "OFFICIAL_API",
  "MANUAL",
  "ESTIMATED",
  "UNKNOWN",
]);

export const storageTermsStatusEnum = pgEnum("storage_terms_status", [
  "UNREVIEWED",
  "PERMITTED",
  "AMBIGUOUS",
  "PROHIBITED",
]);

export const thumbnailAssetStatusEnum = pgEnum("thumbnail_asset_status", [
  "active",
  // Object is no longer referenced (replaced / removed / migrated away) and
  // is waiting for its remote copy to be deleted (retried by maintenance).
  "pending_delete",
]);

export const migrationJobStatusEnum = pgEnum("storage_migration_job_status", [
  "pending",
  "running",
  "paused",
  "completed",
  "failed",
  "cancelled",
]);

export const storageProviders = pgTable(
  "storage_providers",
  {
    id: serial("id").primaryKey(),
    providerKey: varchar("provider_key", { length: 32 }).notNull(),
    enabled: boolean("enabled").notNull().default(true),
    status: storageProviderStatusEnum("status").notNull().default("ACTIVE"),
    commercialTermsStatus: storageTermsStatusEnum("commercial_terms_status").notNull().default("UNREVIEWED"),
    commercialTermsNote: text("commercial_terms_note"),
    // Quotas are NULL until known (env seed, official API or admin input).
    // A provider with unknown storage/bandwidth quota receives no uploads.
    storageQuota: bigint("storage_quota", { mode: "number" }),
    storageUsed: bigint("storage_used", { mode: "number" }).notNull().default(0),
    bandwidthQuota: bigint("bandwidth_quota", { mode: "number" }),
    bandwidthUsed: bigint("bandwidth_used", { mode: "number" }).notNull().default(0),
    requestQuota: bigint("request_quota", { mode: "number" }),
    requestUsed: bigint("request_used", { mode: "number" }).notNull().default(0),
    // Least-reliable source among the tracked metrics. Per-metric sources,
    // cached/uncached bandwidth etc. live in usage_details.
    usageSource: storageUsageSourceEnum("usage_source").notNull().default("UNKNOWN"),
    usageDetails: jsonb("usage_details").$type<Record<string, unknown>>().notNull().default({}),
    // Admin tunables.
    weight: numeric("weight", { precision: 8, scale: 3 }).notNull().default("1"),
    maxAssets: integer("max_assets"),
    // Day of month (1-28) on which the provider's billing period renews.
    // NULL = unknown -> usage counters are never auto-reset.
    billingCycleDay: integer("billing_cycle_day"),
    billingPeriodStart: timestamp("billing_period_start", { withTimezone: true }),
    // Failure bookkeeping used by the allocator.
    consecutiveUploadFailures: integer("consecutive_upload_failures").notNull().default(0),
    consecutiveDeliveryFailures: integer("consecutive_delivery_failures").notNull().default(0),
    quotaErrorAt: timestamp("quota_error_at", { withTimezone: true }),
    lastHealthCheck: timestamp("last_health_check", { withTimezone: true }),
    healthOk: boolean("health_ok"),
    lastUsageSync: timestamp("last_usage_sync", { withTimezone: true }),
    errorDetails: text("error_details"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("storage_providers_provider_key_idx").on(t.providerKey)]
);

export const thumbnailAssets = pgTable(
  "thumbnail_assets",
  {
    id: serial("id").primaryKey(),
    // SET NULL (not CASCADE) so deleting a file / user never silently
    // forgets a remote object: orphans are swept by maintenance.
    fileId: integer("file_id").references(() => files.id, { onDelete: "set null" }),
    ownerId: integer("owner_id").references(() => users.id, { onDelete: "set null" }),
    providerId: integer("provider_id")
      .notNull()
      .references(() => storageProviders.id, { onDelete: "restrict" }),
    providerObjectKey: text("provider_object_key").notNull(),
    deliveryMetadata: jsonb("delivery_metadata").$type<Record<string, unknown>>().notNull().default({}),
    allocationReason: jsonb("allocation_reason").$type<Record<string, unknown>>(),
    mimeType: varchar("mime_type", { length: 64 }).notNull(),
    fileSize: integer("file_size").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    checksum: varchar("checksum", { length: 64 }).notNull(),
    status: thumbnailAssetStatusEnum("status").notNull().default("active"),
    // Incremented on every pointer change; used for compare-and-swap.
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Exactly one ACTIVE thumbnail per file.
    uniqueIndex("thumbnail_assets_one_active_per_file_idx")
      .on(t.fileId)
      .where(sql`${t.status} = 'active'`),
    uniqueIndex("thumbnail_assets_provider_object_idx").on(t.providerId, t.providerObjectKey),
    index("thumbnail_assets_provider_status_idx").on(t.providerId, t.status),
    index("thumbnail_assets_owner_idx").on(t.ownerId),
  ]
);

export const storageMigrationJobs = pgTable(
  "storage_migration_jobs",
  {
    id: serial("id").primaryKey(),
    assetId: integer("asset_id")
      .notNull()
      .references(() => thumbnailAssets.id, { onDelete: "cascade" }),
    sourceProviderId: integer("source_provider_id")
      .notNull()
      .references(() => storageProviders.id, { onDelete: "restrict" }),
    destinationProviderId: integer("destination_provider_id").references(() => storageProviders.id, {
      onDelete: "restrict",
    }),
    status: migrationJobStatusEnum("status").notNull().default("pending"),
    reason: varchar("reason", { length: 64 }),
    retryCount: integer("retry_count").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    errorDetails: text("error_details"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // At most one OPEN migration job per asset.
    uniqueIndex("storage_migration_jobs_one_open_per_asset_idx")
      .on(t.assetId)
      .where(sql`${t.status} in ('pending','running','paused')`),
    index("storage_migration_jobs_status_idx").on(t.status, t.nextAttemptAt),
    index("storage_migration_jobs_source_idx").on(t.sourceProviderId),
  ]
);

export const providerUsageHistory = pgTable(
  "provider_usage_history",
  {
    id: serial("id").primaryKey(),
    providerId: integer("provider_id")
      .notNull()
      .references(() => storageProviders.id, { onDelete: "cascade" }),
    storageUsed: bigint("storage_used", { mode: "number" }),
    bandwidthUsed: bigint("bandwidth_used", { mode: "number" }),
    requestUsed: bigint("request_used", { mode: "number" }),
    source: storageUsageSourceEnum("source").notNull().default("UNKNOWN"),
    details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
    measuredAt: timestamp("measured_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("provider_usage_history_provider_time_idx").on(t.providerId, t.measuredAt)]
);

export const storageProviderEvents = pgTable(
  "storage_provider_events",
  {
    id: serial("id").primaryKey(),
    providerId: integer("provider_id").references(() => storageProviders.id, { onDelete: "cascade" }),
    eventType: varchar("event_type", { length: 64 }).notNull(),
    severity: varchar("severity", { length: 16 }).notNull().default("info"),
    message: text("message").notNull(),
    details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
    // Used to de-duplicate Telegram alerts (see alerts.ts).
    dedupeKey: varchar("dedupe_key", { length: 128 }),
    notified: boolean("notified").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("storage_provider_events_provider_time_idx").on(t.providerId, t.createdAt),
    index("storage_provider_events_dedupe_idx").on(t.dedupeKey, t.createdAt),
  ]
);

export const storageAuditLogs = pgTable(
  "storage_audit_logs",
  {
    id: serial("id").primaryKey(),
    actorUserId: integer("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    actorTelegramId: varchar("actor_telegram_id", { length: 64 }),
    action: varchar("action", { length: 64 }).notNull(),
    targetType: varchar("target_type", { length: 32 }),
    targetId: varchar("target_id", { length: 64 }),
    details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("storage_audit_logs_time_idx").on(t.createdAt)]
);

export const storageSettings = pgTable(
  "storage_settings",
  {
    id: serial("id").primaryKey(),
    key: varchar("key", { length: 64 }).notNull(),
    value: jsonb("value").$type<unknown>().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("storage_settings_key_idx").on(t.key)]
);

// Shared (cross-instance) fixed-window rate limiter state. Postgres-backed so
// it works on multi-instance serverless deployments without new infrastructure.
export const storageRateLimits = pgTable("storage_rate_limits", {
  key: varchar("key", { length: 160 }).primaryKey(),
  windowStart: timestamp("window_start", { withTimezone: true }).notNull().defaultNow(),
  count: integer("count").notNull().default(0),
});

// Lease-style lock to prevent concurrent maintenance runs (pooler-safe: no
// session-level advisory locks are needed).
export const storageLocks = pgTable("storage_locks", {
  name: varchar("name", { length: 64 }).primaryKey(),
  holder: varchar("holder", { length: 64 }).notNull(),
  lockedUntil: timestamp("locked_until", { withTimezone: true }).notNull(),
});
