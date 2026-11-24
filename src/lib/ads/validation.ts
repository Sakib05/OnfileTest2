import {
  AD_TYPES,
  CONTENT_KINDS,
  LANGUAGE_OPTIONS,
  COUNTRY_OPTIONS,
  LIMITS,
  OBJECTIVES,
  OBJECTIVES_BY_TYPE,
  isSelectablePlacement,
  type AdType,
  type ContentKind,
  type Objective,
} from "./constants";
import type { Targeting } from "./targeting";

export type ValidationMode = "draft" | "submit";
export type FieldErrors = Record<string, string>;

export interface CampaignInput {
  clientRef?: string;
  adType: AdType;
  contentKind: ContentKind | null;
  fileId: number | null;
  playlistId: number | null;
  channelId: number | null;
  destinationRef: string | null;
  inviteLink: string | null;
  objective: Objective | null;
  title: string;
  headline: string;
  description: string;
  ctaText: string;
  placements: string[];
  targeting: Targeting;
  /** Decimal string with ≤ 2 decimals, or null. */
  budget: string | null;
  targetAmount: number | null;
  startDate: Date | null;
  endDate: Date | null;
}

const COUNTRY_CODES = new Set<string>(COUNTRY_OPTIONS.map((c) => c.code));
const LANGUAGE_CODES = new Set<string>(LANGUAGE_OPTIONS.map((l) => l.code));
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Cleans free text: strips control characters, collapses whitespace, trims. Markup characters are REJECTED rather
 * than silently stripped (so the creator sees what was wrong). Everything is also rendered by React as plain text,
 * never as HTML — this is defence in depth.
 */
export function cleanText(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.replace(/[\u0000-\u001F\u007F\u200B-\u200D\u2028\u2029\uFEFF]+/g, " ").replace(/\s+/g, " ").trim();
}

export function containsMarkup(text: string): boolean {
  return /[<>]/.test(text) || /javascript\s*:/i.test(text) || /data\s*:\s*text\/html/i.test(text);
}

function textField(raw: unknown, label: string, max: number, required: boolean, key: string, errors: FieldErrors): string {
  const value = cleanText(raw);
  if (!value) {
    if (required) errors[key] = `${label} is required.`;
    return "";
  }
  if (value.length > max) errors[key] = `${label} must be at most ${max} characters.`;
  else if (containsMarkup(value)) errors[key] = `${label} can't contain HTML or script (< > are not allowed).`;
  return value;
}

function positiveInt(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = typeof raw === "number" ? raw : /^\d{1,12}$/.test(String(raw)) ? Number(raw) : NaN;
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** Exact decimal text → "123.45". No floats are ever used for money input. */
export function parseBudget(raw: unknown): { ok: true; value: string } | { ok: false; error: string } {
  const text = typeof raw === "number" ? (Number.isFinite(raw) ? String(raw) : "") : typeof raw === "string" ? raw.trim() : "";
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(text)) return { ok: false, error: "Enter a budget with at most 2 decimals, e.g. 25 or 25.50." };
  const n = Number(text);
  if (n < LIMITS.budgetMin) return { ok: false, error: `The minimum budget is ${LIMITS.budgetMin}.` };
  if (n > LIMITS.budgetMax) return { ok: false, error: `The maximum budget is ${LIMITS.budgetMax.toLocaleString("en-US")}.` };
  return { ok: true, value: n.toFixed(2) };
}

export function parseDay(raw: unknown, endOfDay: boolean): Date | null {
  if (typeof raw !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const d = new Date(`${raw}T${endOfDay ? "23:59:59.000" : "00:00:00.000"}Z`);
  if (Number.isNaN(d.getTime())) return null;
  // Reject rollovers like 2025-02-31.
  if (d.toISOString().slice(0, 10) !== raw) return null;
  return d;
}

function stringList(raw: unknown, allowed: Set<string>, max: number, label: string, key: string, errors: FieldErrors, upper: boolean): string[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    errors[key] = `${label} must be a list.`;
    return [];
  }
  const out: string[] = [];
  for (const item of raw) {
    const code = typeof item === "string" ? (upper ? item.toUpperCase() : item.toLowerCase()) : "";
    if (!allowed.has(code)) {
      errors[key] = `Unsupported ${label.toLowerCase()} option.`;
      return [];
    }
    if (!out.includes(code)) out.push(code);
  }
  if (out.length > max) errors[key] = `Select at most ${max} ${label.toLowerCase()} options.`;
  return out;
}

/**
 * Validates a campaign body. `draft` only checks what is present (a draft may be incomplete); `submit` requires the
 * whole campaign. Unknown keys are ignored: status, spend, counters, pricing, payment and review fields can never be
 * set through this function because they are not part of `CampaignInput`.
 */
export function validateCampaignInput(
  raw: unknown,
  mode: ValidationMode,
  now: Date = new Date()
): { ok: true; value: CampaignInput } | { ok: false; errors: FieldErrors } {
  const errors: FieldErrors = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, errors: { _: "Invalid request body." } };
  const b = raw as Record<string, unknown>;
  const submit = mode === "submit";

  const adType = AD_TYPES.find((t) => t === b.adType);
  if (!adType) return { ok: false, errors: { adType: "Choose what you want to promote." } };

  let clientRef: string | undefined;
  if (b.clientRef !== undefined) {
    if (typeof b.clientRef === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(b.clientRef)) clientRef = b.clientRef;
    else errors.clientRef = "Invalid client reference.";
  }

  let contentKind: ContentKind | null = null;
  let fileId: number | null = null;
  let playlistId: number | null = null;
  let channelId: number | null = null;
  let destinationRef: string | null = null;
  let inviteLink: string | null = null;

  if (adType === "onfile_content") {
    contentKind = CONTENT_KINDS.find((k) => k === b.contentKind) ?? null;
    if (!contentKind) {
      if (submit || b.contentKind !== undefined) errors.contentKind = "Choose a file or a playlist.";
    } else if (contentKind === "file") {
      fileId = positiveInt(b.fileId);
      if (!fileId && (submit || b.fileId)) errors.fileId = "Select one of your files.";
    } else {
      playlistId = positiveInt(b.playlistId);
      if (!playlistId && (submit || b.playlistId)) errors.playlistId = "Select one of your playlists.";
    }
  } else if (adType === "telegram_channel") {
    channelId = positiveInt(b.channelId);
    if (b.channelId && !channelId) errors.channelId = "Select one of your connected channels.";
    const ref = cleanText(b.destinationRef);
    if (ref.length > 200) errors.destinationRef = "That channel link is too long.";
    else if (ref) destinationRef = ref;
    const invite = cleanText(b.inviteLink);
    if (invite.length > 200) errors.inviteLink = "That invite link is too long.";
    else if (invite) inviteLink = invite;
    if (channelId && destinationRef) errors.destinationRef = "Choose either a connected channel or another channel, not both.";
    if (submit && !channelId && !destinationRef) errors.destinationRef = "Select a channel or enter a public channel link.";
  } else {
    const ref = cleanText(b.destinationRef);
    if (ref.length > 300) errors.destinationRef = "That link is too long.";
    else if (ref) destinationRef = ref;
    if (submit && !destinationRef) errors.destinationRef = "Paste the link of the post you want to promote.";
  }

  let objective: Objective | null = null;
  if (b.objective !== undefined && b.objective !== null && b.objective !== "") {
    objective = OBJECTIVES.find((o) => o === b.objective) ?? null;
    if (!objective) errors.objective = "Unsupported objective.";
    else if (!OBJECTIVES_BY_TYPE[adType].includes(objective)) {
      errors.objective = "That objective isn't available for this type of campaign.";
      objective = null;
    }
  } else if (submit) errors.objective = "Choose a campaign objective.";

  const title = textField(b.title, "Campaign title", LIMITS.titleMax, submit, "title", errors);
  const headline = textField(b.headline, "Headline", LIMITS.headlineMax, submit, "headline", errors);
  const description = textField(b.description, "Description", LIMITS.descriptionMax, submit, "description", errors);
  const ctaText = textField(b.ctaText, "Button text", LIMITS.ctaMax, submit, "ctaText", errors);

  // Placements — only implemented, available ones.
  const placements: string[] = [];
  if (b.placements !== undefined && b.placements !== null) {
    if (!Array.isArray(b.placements)) errors.placements = "Placements must be a list.";
    else {
      for (const p of b.placements) {
        if (typeof p !== "string" || !isSelectablePlacement(p, adType)) {
          errors.placements = "One of the selected placements isn't available.";
          break;
        }
        if (!placements.includes(p)) placements.push(p);
      }
      if (placements.length > LIMITS.maxPlacements) errors.placements = "Too many placements.";
    }
  }
  if (submit && placements.length === 0 && !errors.placements) errors.placements = "Select at least one placement.";

  // Force join gates exactly ONE of the creator's own files (stored in `file_id` of a channel campaign). Being a
  // membership requirement rather than a promotion, it can't share a campaign with the optional placements, and it
  // is only sellable when it can be measured (verified joins).
  if (placements.includes("force_join")) {
    if (placements.length > 1) errors.placements = "Force join can't be combined with other placements — it gates one of your files.";
    fileId = positiveInt(b.fileId);
    if (!fileId && (submit || b.fileId)) errors.gateFileId = "Choose the file visitors must join your channel to unlock.";
    if (objective && objective !== "verified_joins") errors.objective = "Force join campaigns are measured by verified channel joins.";
  }

  // Targeting — only the dimensions Onfile can really evaluate.
  const tIn = b.targeting && typeof b.targeting === "object" && !Array.isArray(b.targeting) ? (b.targeting as Record<string, unknown>) : {};
  const targeting: Targeting = {
    countries: stringList(tIn.countries, COUNTRY_CODES, LIMITS.maxCountries, "Country", "countries", errors, true),
    languages: stringList(tIn.languages, LANGUAGE_CODES, LIMITS.maxLanguages, "Language", "languages", errors, false),
  };

  // Budget, target, dates
  let budget: string | null = null;
  if (b.budget !== undefined && b.budget !== null && b.budget !== "") {
    const parsed = parseBudget(b.budget);
    if (parsed.ok) budget = parsed.value;
    else errors.budget = parsed.error;
  } else if (submit) errors.budget = "Enter a campaign budget.";

  let targetAmount: number | null = null;
  if (b.targetAmount !== undefined && b.targetAmount !== null && b.targetAmount !== "") {
    targetAmount = positiveInt(b.targetAmount);
    if (!targetAmount || targetAmount > LIMITS.targetMax) {
      errors.targetAmount = `Enter a whole number between 1 and ${LIMITS.targetMax.toLocaleString("en-US")}.`;
      targetAmount = null;
    }
  }

  const startDate = b.startDate ? parseDay(b.startDate, false) : null;
  const endDate = b.endDate ? parseDay(b.endDate, true) : null;
  if (b.startDate && !startDate) errors.startDate = "Enter a valid start date.";
  if (b.endDate && !endDate) errors.endDate = "Enter a valid end date.";
  if (submit && !b.startDate) errors.startDate = "Choose a start date.";
  if (submit && !b.endDate) errors.endDate = "Choose an end date.";
  if (startDate && endDate && !errors.startDate && !errors.endDate) {
    if (endDate.getTime() < startDate.getTime()) errors.endDate = "The end date must be on or after the start date.";
    else if (endDate.getTime() - startDate.getTime() > LIMITS.maxDurationDays * DAY_MS) errors.endDate = `Campaigns can run for at most ${LIMITS.maxDurationDays} days.`;
  }
  if (submit && startDate && !errors.startDate) {
    const today = new Date(`${now.toISOString().slice(0, 10)}T00:00:00.000Z`);
    if (startDate.getTime() < today.getTime()) errors.startDate = "The start date can't be in the past.";
  }
  if (submit && endDate && !errors.endDate && endDate.getTime() < now.getTime()) errors.endDate = "The end date can't be in the past.";

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    value: {
      clientRef,
      adType,
      contentKind,
      fileId,
      playlistId,
      channelId,
      destinationRef,
      inviteLink,
      objective,
      title,
      headline,
      description,
      ctaText,
      placements,
      targeting,
      budget,
      targetAmount,
      startDate,
      endDate,
    },
  };
}

/** Allowed shape of an ad's destination as stored: an Onfile page path or an https Telegram link. */
export function isSafeDestination(url: string | null | undefined): url is string {
  if (!url) return false;
  if (/^\/(f|p)\/[A-Za-z0-9_-]{1,64}$/.test(url)) return true;
  try {
    const u = new URL(url);
    return u.protocol === "https:" && (u.hostname === "t.me" || u.hostname === "telegram.me") && !u.username && !u.password;
  } catch {
    return false;
  }
}
