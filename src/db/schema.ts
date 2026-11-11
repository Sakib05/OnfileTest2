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

// ─── Playlist memberships ────────────────────────────────────────────────────
// ADDITIVE join table: a file (one row in `files`, one Telegram post, one
// thumbnail) can belong to any number of the creator's playlists, in a
// creator-defined order. Rows here are only *references* — deleting a row (or a
// whole playlist) never deletes the file. `files.playlist_id` is kept as a
// legacy column (never dropped, so old data and a rollback stay safe); existing
// values are copied into this table by migrations/playlist_files/up.sql and,
// as a self-healing fallback, lazily by src/lib/playlistMembers.ts.
//   position: ascending = display order; the first row is the playlist cover.
//   user_id : denormalised owner, always equal to both parents' owner; every
//             write re-verifies ownership server-side.
export const playlistFiles = pgTable(
  "playlist_files",
  {
    id: serial("id").primaryKey(),
    playlistId: integer("playlist_id")
      .notNull()
      .references(() => playlists.id, { onDelete: "cascade" }),
    fileId: integer("file_id")
      .notNull()
      .references(() => files.id, { onDelete: "cascade" }),
    userId: integer("user_id").notNull(),
    position: integer("position").default(0).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("playlist_files_playlist_file_idx").on(t.playlistId, t.fileId),
    index("playlist_files_playlist_position_idx").on(t.playlistId, t.position),
    index("playlist_files_file_id_idx").on(t.fileId),
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

// ─── Thumbnail Storage (DBByte) ─────────────────────────────────────────────
// Only METADATA lives here. The optimized image bytes live in the DBByte
// bucket; the original Telegram file never leaves the creator's private
// Telegram channel. Delivery URLs are derived at runtime from `objectKey` +
// server config (src/lib/thumbnails/config.ts) so nothing here depends on a
// secret or on a particular CDN token.
//
// One active thumbnail per file (unique file_id). `objectKey` embeds a random
// per-upload `version`, so every upload/replacement yields a brand-new,
// immutable URL (safe for long-lived browser/CDN caching).
export const fileThumbnails = pgTable(
  "file_thumbnails",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    fileId: integer("file_id")
      .notNull()
      .references(() => files.id, { onDelete: "cascade" }),
    provider: varchar("provider", { length: 16 }).default("dbbyte").notNull(),
    objectKey: varchar("object_key", { length: 255 }).notNull(),
    version: varchar("version", { length: 32 }).notNull(),
    mimeType: varchar("mime_type", { length: 64 }).notNull(),
    format: varchar("format", { length: 16 }).notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    status: varchar("status", { length: 16 }).default("ready").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("file_thumbnails_file_id_idx").on(t.fileId),
    uniqueIndex("file_thumbnails_object_key_idx").on(t.provider, t.objectKey),
    index("file_thumbnails_user_id_idx").on(t.userId),
  ]
);

// Objects that exist in DBByte but are no longer referenced (failed delete
// after replace/remove, or a DB write that failed after a successful upload).
// Cleaned up by an admin-triggered retry; never auto-deleted blindly.
export const thumbnailOrphans = pgTable(
  "thumbnail_orphans",
  {
    id: serial("id").primaryKey(),
    provider: varchar("provider", { length: 16 }).default("dbbyte").notNull(),
    objectKey: varchar("object_key", { length: 255 }).notNull(),
    reason: varchar("reason", { length: 48 }).notNull(),
    attempts: integer("attempts").default(0).notNull(),
    lastError: varchar("last_error", { length: 300 }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    lastAttemptAt: timestamp("last_attempt_at"),
  },
  (t) => [uniqueIndex("thumbnail_orphans_object_key_idx").on(t.provider, t.objectKey)]
);

// Provider/DB-side upload failures only (not user validation errors), shown
// to admins. Messages are short, never contain secrets.
export const thumbnailFailures = pgTable(
  "thumbnail_failures",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id"),
    fileId: integer("file_id"),
    code: varchar("code", { length: 48 }).notNull(),
    httpStatus: integer("http_status"),
    message: varchar("message", { length: 300 }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("thumbnail_failures_created_at_idx").on(t.createdAt)]
);

// Admin-entered ("manual") DBByte usage figures. DBByte exposes no usage API,
// so these are NEVER presented as official provider data. `metric` is one of
// storage_bytes | bandwidth_bytes | requests.
export const storageUsageManual = pgTable(
  "storage_usage_manual",
  {
    id: serial("id").primaryKey(),
    metric: varchar("metric", { length: 32 }).notNull(),
    used: bigint("used", { mode: "number" }).notNull(),
    limit: bigint("limit", { mode: "number" }).notNull(),
    updatedBy: integer("updated_by"),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [uniqueIndex("storage_usage_manual_metric_idx").on(t.metric)]
);

// ─── Staged thumbnails (uploaded in the Publish wizard BEFORE the post exists) ──
// ADDITIVE table. A creator uploads a thumbnail while filling in the post
// details; the post (files row) does not exist yet, so the image is "staged"
// under an unguessable `ref` that is bound to the uploading user. When the post
// is published the ref is claimed inside the publish transaction: a
// `file_thumbnails` row is created for the new file and the staged row is marked
// "attached". Staged rows that are never attached are expired + deleted after
// 24h; attached rows are never touched by cleanup.
//   status: staged | attached | discarded | expired
export const thumbnailUploads = pgTable(
  "thumbnail_uploads",
  {
    id: serial("id").primaryKey(),
    ref: varchar("ref", { length: 32 }).notNull(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: varchar("provider", { length: 16 }).notNull(),
    objectKey: varchar("object_key", { length: 255 }).notNull(),
    version: varchar("version", { length: 32 }).notNull(),
    mimeType: varchar("mime_type", { length: 64 }).notNull(),
    format: varchar("format", { length: 16 }).notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    status: varchar("status", { length: 16 }).default("staged").notNull(),
    fileId: integer("file_id"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("thumbnail_uploads_ref_idx").on(t.ref),
    uniqueIndex("thumbnail_uploads_object_key_idx").on(t.provider, t.objectKey),
    index("thumbnail_uploads_user_status_idx").on(t.userId, t.status),
  ]
);
