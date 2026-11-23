/**
 * Distinct, user-readable failure categories for the profile-picture flow. Every failure carries a `kind` so the
 * UI (and tests) can tell WHICH stage failed — nothing is reported as a generic "corrupt image" any more.
 * Messages never contain internal server details.
 */

export type AvatarErrorKind =
  | "unsupported_format" // a real image, but not JPEG/PNG/WebP (GIF, AVIF, BMP…) or not an image at all
  | "heic_unsupported" // HEIC/HEIF — recognised, deliberately not supported
  | "empty" // 0 bytes
  | "corrupt" // claims to be an image, but the bytes are not a valid one
  | "unreadable" // the OS/picker would not hand over the file's bytes
  | "decode_failed" // valid signature, but this device's decoders could not open it (damaged or too big)
  | "too_large" // file size or pixel dimensions over the limit
  | "processing_failed" // crop/canvas/export step failed
  | "network" // request never reached the server / no connection
  | "upload_failed" // unexpected non-OK response
  | "server_validation" // the server inspected the image and rejected it
  | "storage_failed" // the image storage provider (DBByte) failed
  | "rate_limited";

export const AVATAR_ERROR_MESSAGES: Record<AvatarErrorKind, string> = {
  unsupported_format: "This file type isn't supported. Please choose a JPEG, PNG or WebP image.",
  heic_unsupported:
    "HEIC/HEIF photos aren't supported. Please choose a JPEG, PNG or WebP image (on many phones you can switch the camera format to \"Most compatible\" or share the photo as JPEG).",
  empty: "The selected file is empty. Please choose a different photo.",
  corrupt: "This file isn't a valid image — it looks damaged or incomplete. Please choose a different one.",
  unreadable: "We couldn't read this file from your device. Please try selecting it again, or choose another photo.",
  decode_failed: "Your device couldn't open this image. It may be damaged or too large to process here. Please try a smaller or different photo.",
  too_large: "This image is too large. Please choose one under 20 MB.",
  processing_failed: "We couldn't prepare the cropped picture. Please try again.",
  network: "No connection. Please check your internet and try again.",
  upload_failed: "Couldn't upload your picture. Please try again.",
  server_validation: "The server couldn't accept this image. Please crop it again or choose a different photo.",
  storage_failed: "Picture storage had a problem. Your current picture is unchanged — please try again.",
  rate_limited: "Too many uploads. Please wait a minute and try again.",
};

export class AvatarError extends Error {
  readonly kind: AvatarErrorKind;
  /** Internal diagnostic (decoder names, status codes). Never shown to users; safe to log. */
  readonly detail?: string;
  constructor(kind: AvatarErrorKind, message?: string, detail?: string) {
    super(message ?? AVATAR_ERROR_MESSAGES[kind]);
    this.name = "AvatarError";
    this.kind = kind;
    this.detail = detail;
  }
}

/** Maps a failed /api/user/avatar response (status + our own `code`) to an AvatarError. */
export function errorFromServer(status: number, code: string | undefined, serverMessage: string | undefined): AvatarError {
  const detail = `http_${status}${code ? `:${code}` : ""}`;
  switch (code) {
    case "too_large":
      return new AvatarError("too_large", "The cropped picture is too large to store. Please choose a different photo.", detail);
    case "unsupported_type":
      return new AvatarError("server_validation", "The server doesn't accept this image format. Please choose a JPEG, PNG or WebP photo.", detail);
    case "animated":
      return new AvatarError("server_validation", "Animated images can't be used. Please choose a still photo.", detail);
    case "empty":
    case "corrupt":
    case "too_many_pixels":
    case "bad_request":
      return new AvatarError("server_validation", undefined, detail);
    case "rate_limited":
      return new AvatarError("rate_limited", serverMessage || undefined, detail);
    case "uploads_paused":
      return new AvatarError("storage_failed", serverMessage || undefined, detail);
    case "storage_error":
    case "storage_unavailable":
      return new AvatarError("storage_failed", undefined, detail);
    default:
      break;
  }
  if (status === 429) return new AvatarError("rate_limited", undefined, detail);
  if (status === 413) return new AvatarError("too_large", "The picture is too large to upload. Please choose a smaller photo.", detail);
  if (status === 415) return new AvatarError("server_validation", undefined, detail);
  if (status === 401 || status === 403) return new AvatarError("upload_failed", "Your session expired. Please reopen the app and try again.", detail);
  if (status === 502 || status === 503) return new AvatarError("storage_failed", undefined, detail);
  return new AvatarError("upload_failed", undefined, detail);
}
