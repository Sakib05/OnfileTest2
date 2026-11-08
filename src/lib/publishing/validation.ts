import {
  CATEGORIES,
  DESCRIPTION_MAX,
  FILE_TYPES,
  PASSWORD_MAX,
  STARS_MAX,
  STARS_MIN,
  TITLE_MAX,
  type FileTypeValue,
  type Monetization,
  type PublishMode,
} from "./constants";

/**
 * Pure validators shared by the Publish UI (fast feedback) and the server
 * (authoritative). The server NEVER relies on the client having run these.
 */

export type FieldErrors = Partial<Record<"title" | "description" | "category" | "fileType" | "password" | "starsPrice" | "playlistId" | "monetization", string>>;

export interface DetailsInput {
  title: string;
  description: string;
  category: string;
  fileType: string;
}

export function validateDetails(input: DetailsInput): FieldErrors {
  const errors: FieldErrors = {};
  const title = input.title.trim();
  if (!title) errors.title = "Add a title so people know what this is.";
  else if (title.length > TITLE_MAX) errors.title = `Title must be ${TITLE_MAX} characters or fewer.`;

  if (input.description.length > DESCRIPTION_MAX) {
    errors.description = `Description must be ${DESCRIPTION_MAX} characters or fewer.`;
  }
  if (input.category && !(CATEGORIES as readonly string[]).includes(input.category)) {
    errors.category = "Choose one of the listed categories.";
  }
  if (!(FILE_TYPES as readonly string[]).includes(input.fileType)) {
    errors.fileType = "Choose a valid file type.";
  }
  return errors;
}

/** Parses a user-entered Stars price. Returns null when not a whole number. */
export function parseStarsPrice(raw: string | number | null | undefined): number | null {
  if (typeof raw === "number") return Number.isInteger(raw) ? raw : null;
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  if (!/^[0-9]{1,6}$/.test(t)) return null;
  return Number(t);
}

export function validateMonetization(monetization: Monetization, starsPriceRaw: string | number | null | undefined): FieldErrors {
  const errors: FieldErrors = {};
  if (monetization === "free") return errors;
  const price = parseStarsPrice(starsPriceRaw);
  if (price === null) errors.starsPrice = "Enter a whole number of Stars.";
  else if (price < STARS_MIN || price > STARS_MAX) {
    errors.starsPrice = `Price must be between ${STARS_MIN} and ${STARS_MAX.toLocaleString("en-US")} Stars.`;
  }
  return errors;
}

export interface PublishPayload {
  telegramMessageLink: unknown;
  title: string;
  description: string;
  category: string;
  fileType: FileTypeValue;
  playlistId: number | null;
  password: string;
  monetization: Monetization;
  starsPrice: number;
  mode: PublishMode;
}

export type PayloadResult = { ok: true; value: PublishPayload } | { ok: false; errors: FieldErrors };

/** Validates and normalizes an untrusted publish request body. */
export function validatePublishPayload(body: unknown): PayloadResult {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, errors: { title: "Invalid request." } };
  }
  const b = body as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v : "");

  const title = str(b.title);
  const description = str(b.description);
  const category = str(b.category);
  const fileType = str(b.fileType) || "other";
  const password = str(b.password);

  const errors: FieldErrors = { ...validateDetails({ title, description, category, fileType }) };
  if (password.length > PASSWORD_MAX) errors.password = `Password must be ${PASSWORD_MAX} characters or fewer.`;

  // Legacy clients that only sent `starsPrice` are treated as paid when > 0.
  const legacyPrice = parseStarsPrice(b.starsPrice as string | number | null | undefined) ?? 0;
  const monetization: Monetization =
    b.monetization === "paid" ? "paid" : b.monetization === "free" ? "free" : legacyPrice > 0 ? "paid" : "free";
  Object.assign(errors, validateMonetization(monetization, b.starsPrice as string | number | null | undefined));

  let playlistId: number | null = null;
  if (b.playlistId !== null && b.playlistId !== undefined && b.playlistId !== "") {
    const n = typeof b.playlistId === "number" ? b.playlistId : Number(b.playlistId);
    if (!Number.isInteger(n) || n <= 0) errors.playlistId = "Choose a valid playlist.";
    else playlistId = n;
  }

  const mode: PublishMode = b.mode === "draft" ? "draft" : "publish";

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    value: {
      telegramMessageLink: b.telegramMessageLink,
      title: title.trim(),
      description: description.trim(),
      category,
      fileType: fileType as FileTypeValue,
      playlistId,
      password,
      monetization,
      starsPrice: monetization === "paid" ? (parseStarsPrice(b.starsPrice as string | number) as number) : 0,
      mode,
    },
  };
}
