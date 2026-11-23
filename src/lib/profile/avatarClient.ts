"use client";
/**
 * Browser-side API helpers for the Edit Profile picture. Client checks are a convenience only — the server
 * (/api/user/avatar) re-validates the real image bytes and re-encodes them.
 *
 * Decoding / cropping lives in ./avatarImage (loadCropImage, exportCrop); geometry in ./cropMath.
 */
import type { UserProfile } from "@/contexts/AppContext";
import { AvatarError, errorFromServer } from "./avatarErrors";
import { AVATAR_MAX_SOURCE_BYTES, validateAvatarBlob } from "./avatarImage";

export { AVATAR_MAX_SOURCE_BYTES };
export const AVATAR_ACCEPT = "image/jpeg,image/png,image/webp";
export const AVATAR_EDGE_PX = 512;
const UPLOAD_TIMEOUT_MS = 45_000;

/**
 * Cheap checks on the picked file BEFORE the cropper opens. Returns an AvatarError (with a precise `kind`) or
 * null. A missing / generic MIME type is allowed through — Android pickers often report "" — because the real
 * format is decided from the file's bytes in loadCropImage().
 */
export function precheckAvatar(file: File): AvatarError | null {
  if (file.size === 0) return new AvatarError("empty");
  if (file.size > AVATAR_MAX_SOURCE_BYTES) return new AvatarError("too_large");
  const type = (file.type || "").toLowerCase();
  if (/^image\/(heic|heif|heic-sequence|heif-sequence)$/.test(type) || /\.(heic|heif)$/i.test(file.name || "")) {
    return new AvatarError("heic_unsupported");
  }
  if (type && type !== "application/octet-stream" && !/^image\/(jpeg|jpg|png|webp)$/.test(type)) {
    return new AvatarError("unsupported_format", undefined, `declared_${type}`);
  }
  return null;
}

async function parse(res: Response): Promise<{ user?: UserProfile; error?: string; code?: string }> {
  return (await res.json().catch(() => ({}))) as { user?: UserProfile; error?: string; code?: string };
}

let uploadInFlight: Promise<UserProfile | null> | null = null;

async function doUpload(file: File): Promise<UserProfile | null> {
  // Validate the exported Blob's real bytes before it can leave the device.
  await validateAvatarBlob(file);

  const form = new FormData();
  form.append("file", file, file.name || "avatar"); // field name the route reads; NO manual Content-Type (the browser adds the multipart boundary)

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), UPLOAD_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch("/api/user/avatar", { method: "POST", body: form, signal: ctrl.signal });
  } catch {
    throw new AvatarError("network");
  } finally {
    clearTimeout(timer);
  }
  const data = await parse(res);
  if (!res.ok) throw errorFromServer(res.status, data.code, data.error);
  return data.user ?? null;
}

/**
 * Uploads (or replaces) the custom picture. Resolves with the updated profile; rejects with an AvatarError whose
 * `kind` distinguishes validation / storage / network / server failures. A second call while one is in flight
 * shares the first request (no duplicate submissions).
 */
export function uploadAvatar(file: File): Promise<UserProfile | null> {
  if (uploadInFlight) return uploadInFlight;
  const p = doUpload(file).finally(() => {
    uploadInFlight = null;
  });
  uploadInFlight = p;
  return p;
}

/** Removes the custom picture (Telegram photo / initials show again). Rejects with a readable Error. */
export async function removeAvatar(): Promise<UserProfile | null> {
  let res: Response;
  try {
    res = await fetch("/api/user/avatar", { method: "DELETE" });
  } catch {
    throw new AvatarError("network");
  }
  const data = await parse(res);
  if (!res.ok) throw new Error(data.error || "Couldn't remove your picture. Please try again.");
  return data.user ?? null;
}

/** Saves the custom display name ("" clears it → the Telegram name is used again). */
export async function saveDisplayName(displayName: string): Promise<UserProfile | null> {
  let res: Response;
  try {
    res = await fetch("/api/user/me", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName }),
    });
  } catch {
    throw new AvatarError("network");
  }
  const data = await parse(res);
  if (!res.ok) throw new Error(data.error || "Couldn't save your display name. Please try again.");
  return data.user ?? null;
}
