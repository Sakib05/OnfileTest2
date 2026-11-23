"use client";
/**
 * Browser-side helpers for the Edit Profile picture. Client checks are a convenience only — the server
 * (/api/user/avatar) re-validates the real image bytes and re-encodes them.
 */
import type { UserProfile } from "@/contexts/AppContext";

export const AVATAR_ACCEPT = "image/jpeg,image/png,image/webp";
/** Source photos from a phone camera can be large; they are shrunk to a 512px square before upload. */
export const AVATAR_MAX_SOURCE_BYTES = 20 * 1024 * 1024;
export const AVATAR_EDGE_PX = 512;

/** Cheap type/size check before decoding. Returns a user-readable error or null. */
export function precheckAvatar(file: File): string | null {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) return "Only JPEG, PNG or WebP images are allowed.";
  if (file.size === 0) return "The file is empty.";
  if (file.size > AVATAR_MAX_SOURCE_BYTES) return "This image is too large. Please choose one under 20 MB.";
  return null;
}

async function decode(file: File): Promise<{ source: CanvasImageSource; width: number; height: number; close: () => void }> {
  if (typeof createImageBitmap === "function") {
    try {
      // `imageOrientation: "from-image"` applies EXIF rotation (phone photos).
      const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { source: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close() };
    } catch {
      /* fall through to <img> decoding */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => {} };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Centre-crops to a square and scales down to 512×512 (never enlarges beyond the source). A successful decode
 * also proves the file really is an image. Rejects with a readable Error.
 */
export async function cropToSquareAvatar(file: File): Promise<File> {
  let decoded: Awaited<ReturnType<typeof decode>>;
  try {
    decoded = await decode(file);
  } catch {
    throw new Error("This image is corrupt or can't be read. Please choose a different one.");
  }
  try {
    const { width, height } = decoded;
    if (!width || !height) throw new Error("This image can't be read. Please choose a different one.");
    const side = Math.min(width, height);
    const out = Math.min(AVATAR_EDGE_PX, side);
    const canvas = document.createElement("canvas");
    canvas.width = out;
    canvas.height = out;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Your device can't prepare this image. Please try another one.");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(decoded.source, (width - side) / 2, (height - side) / 2, side, side, 0, 0, out, out);

    const blob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, "image/webp", 0.9));
    if (!blob) throw new Error("This image couldn't be prepared for upload.");
    const ext = blob.type === "image/webp" ? "webp" : blob.type === "image/png" ? "png" : "jpg";
    return new File([blob], `avatar.${ext}`, { type: blob.type || "image/png" });
  } finally {
    decoded.close();
  }
}

async function parse(res: Response): Promise<{ user?: UserProfile; error?: string }> {
  return (await res.json().catch(() => ({}))) as { user?: UserProfile; error?: string };
}

/** Uploads (or replaces) the custom picture. Resolves with the updated profile; rejects with a readable Error. */
export async function uploadAvatar(file: File): Promise<UserProfile | null> {
  const form = new FormData();
  form.append("file", file);
  let res: Response;
  try {
    res = await fetch("/api/user/avatar", { method: "POST", body: form });
  } catch {
    throw new Error("Network error. Please check your connection and try again.");
  }
  const data = await parse(res);
  if (!res.ok) throw new Error(data.error || "Couldn't upload your picture. Please try again.");
  return data.user ?? null;
}

/** Removes the custom picture (Telegram photo / initials show again). Rejects with a readable Error. */
export async function removeAvatar(): Promise<UserProfile | null> {
  let res: Response;
  try {
    res = await fetch("/api/user/avatar", { method: "DELETE" });
  } catch {
    throw new Error("Network error. Please try again.");
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
    throw new Error("Network error. Please try again.");
  }
  const data = await parse(res);
  if (!res.ok) throw new Error(data.error || "Couldn't save your display name. Please try again.");
  return data.user ?? null;
}
