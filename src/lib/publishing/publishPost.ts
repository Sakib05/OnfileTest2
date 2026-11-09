import { validatePublishPayload, type FieldErrors } from "./validation";
import { verifyPostLinkAgainstChannels, type ConnectedChannelRef, type PublicChatResolver } from "@/lib/channelPostVerification";
import { PAID_PUBLISHING_UNAVAILABLE_MESSAGE } from "./payments";
import { postIdentityKey } from "@/lib/telegramPostLink";

/**
 * Server-side publishing service. All trust decisions live here and receive
 * ONLY the authenticated user id from the caller — never a channel id, owner
 * id or "verified" flag from the client. Side effects are injected so the
 * rules can be unit-tested without a database or Telegram.
 */

export interface PublishFileRecord {
  userId: number;
  telegramMessageLink: string;
  /** Identity key of the post (see postIdentityKey) used for duplicate detection. */
  postKey: string;
  title: string;
  description: string | null;
  category: string | null;
  fileType: string;
  playlistId: number | null;
  /** Ref of a staged thumbnail (POST /api/thumbnails) to attach to the new post, or null. */
  thumbnailRef: string | null;
  /** Plain-text password; the persistence layer hashes it. */
  password: string | null;
  starsPrice: number;
  isPublished: boolean;
}

export interface PublishDeps {
  listVerifiedChannels(userId: number): Promise<ConnectedChannelRef[]>;
  playlistBelongsToUser(playlistId: number, userId: number): Promise<boolean>;
  resolvePublicChat: PublicChatResolver;
  /**
   * Must atomically (per user) check that no existing file of this user points
   * at the same post, then insert. Returns "duplicate" without inserting.
   */
  insertUnlessDuplicate(
    record: PublishFileRecord
  ): Promise<{ status: "created"; file: unknown } | { status: "duplicate" } | { status: "invalid_thumbnail" } | { status: "invalid_playlist" }>;
  paidPublishingAvailable(): boolean;
}

export type PublishOutcome =
  | { status: 201; body: { file: unknown; published: boolean } }
  | {
      status: 400 | 403 | 409 | 503;
      body: { error: string; reason: string; fieldErrors?: FieldErrors };
    };

export async function publishPost(deps: PublishDeps, userId: number, rawBody: unknown): Promise<PublishOutcome> {
  const parsed = validatePublishPayload(rawBody);
  if (!parsed.ok) {
    return {
      status: 400,
      body: { error: "Please fix the highlighted fields.", reason: "validation_failed", fieldErrors: parsed.errors },
    };
  }
  const v = parsed.value;

  // 1. Channel ownership — from the server-side account, never the client.
  const channels = await deps.listVerifiedChannels(userId);
  const verification = await verifyPostLinkAgainstChannels(v.telegramMessageLink, channels, deps.resolvePublicChat);
  if (!verification.ok) {
    const status = verification.status === 400 ? 400 : verification.status === 503 ? 503 : 403;
    const reason = verification.reason === "no_connected_channel" ? "channel_required" : verification.reason;
    return { status, body: { error: verification.message, reason } };
  }

  // 2. Paid content must never be published without a working payment gate.
  if (v.monetization === "paid" && v.mode === "publish" && !deps.paidPublishingAvailable()) {
    return {
      status: 409,
      body: { error: PAID_PUBLISHING_UNAVAILABLE_MESSAGE, reason: "paid_publishing_unavailable" },
    };
  }

  // 3. Playlist must belong to the same creator.
  if (v.playlistId !== null && !(await deps.playlistBelongsToUser(v.playlistId, userId))) {
    return {
      status: 400,
      body: { error: "That playlist wasn't found in your account.", reason: "validation_failed", fieldErrors: { playlistId: "Choose one of your playlists." } },
    };
  }

  // 4. Persist (atomic duplicate guard).
  const result = await deps.insertUnlessDuplicate({
    userId,
    telegramMessageLink: verification.post.canonicalLink,
    postKey: postIdentityKey(verification.post.link),
    title: v.title,
    description: v.description || null,
    category: v.category || null,
    fileType: v.fileType,
    playlistId: v.playlistId,
    thumbnailRef: v.thumbnailRef,
    password: v.password || null,
    starsPrice: v.starsPrice,
    isPublished: v.mode === "publish",
  });
  if (result.status === "invalid_thumbnail") {
    return {
      status: 400,
      body: {
        error: "Your thumbnail is no longer available. Please upload it again or publish without one.",
        reason: "validation_failed",
        fieldErrors: { thumbnail: "That thumbnail is no longer available. Please upload it again." },
      },
    };
  }
  if (result.status === "invalid_playlist") {
    return {
      status: 400,
      body: { error: "That playlist wasn't found in your account.", reason: "validation_failed", fieldErrors: { playlistId: "Choose one of your playlists." } },
    };
  }
  if (result.status === "duplicate") {
    return {
      status: 409,
      body: { error: "This Telegram post has already been added to your library.", reason: "duplicate_post" },
    };
  }
  return { status: 201, body: { file: result.file, published: v.mode === "publish" } };
}
