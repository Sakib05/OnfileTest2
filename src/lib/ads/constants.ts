/**
 * Creator Advertising System — shared constants (server + client safe; no imports with side effects).
 *
 * Everything the UI offers is derived from here, so the wizard can never offer something the server
 * would refuse. NOTHING in this module is a price, a rate or a statistic.
 */

export const AD_TYPES = ["onfile_content", "telegram_channel", "telegram_post"] as const;
export type AdType = (typeof AD_TYPES)[number];

export const CONTENT_KINDS = ["file", "playlist"] as const;
export type ContentKind = (typeof CONTENT_KINDS)[number];

export const OBJECTIVES = ["impressions", "clicks", "verified_joins"] as const;
export type Objective = (typeof OBJECTIVES)[number];

export const CAMPAIGN_STATUSES = ["draft", "pending", "active", "paused", "completed", "rejected"] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

export const STATUS_LABELS: Record<CampaignStatus, string> = {
  draft: "Draft",
  pending: "Pending Review",
  active: "Active",
  paused: "Paused",
  completed: "Completed",
  rejected: "Rejected",
};

export const AD_TYPE_INFO: Record<AdType, { label: string; description: string }> = {
  onfile_content: {
    label: "Promote Onfile Content",
    description: "Promote one of your published files or playlists.",
  },
  telegram_channel: {
    label: "Promote Telegram Channel",
    description: "Grow your connected channel, or promote another public channel.",
  },
  telegram_post: {
    label: "Promote Telegram Post",
    description: "Send people to a specific channel post.",
  },
};

/**
 * Objectives that can ACTUALLY be measured for a type. "Promote Content Access" is intentionally not offered:
 * Onfile cannot tell an "access" apart from a click, and an unmeasurable objective must not be sold.
 * "verified_joins" additionally requires `joinVerifiable` (the bot is an admin of the destination channel).
 */
export const OBJECTIVES_BY_TYPE: Record<AdType, readonly Objective[]> = {
  onfile_content: ["impressions", "clicks"],
  telegram_channel: ["impressions", "clicks", "verified_joins"],
  telegram_post: ["impressions", "clicks"],
};

export const OBJECTIVE_INFO: Record<Objective, { label: string; description: string; unit: string; unitSingular: string; pricingModel: PricingModel }> = {
  impressions: {
    label: "Increase Impressions",
    description: "Get your ad seen. Counted once per viewer, per placement, per day.",
    unit: "impressions",
    unitSingular: "impression",
    pricingModel: "cpm",
  },
  clicks: {
    label: "Increase Clicks",
    description: "Drive taps on your ad. A click is not a join. Counted once per viewer per day.",
    unit: "clicks",
    unitSingular: "click",
    pricingModel: "cpc",
  },
  verified_joins: {
    label: "Gain Verified Channel Joins",
    description: "New members only, confirmed with Telegram. Existing members and plain clicks never count.",
    unit: "verified joins",
    unitSingular: "verified join",
    pricingModel: "cpa",
  },
};

export type PricingModel = "cpm" | "cpc" | "cpa";
export const PRICING_MODEL_LABELS: Record<PricingModel, string> = {
  cpm: "per 1,000 impressions",
  cpc: "per click",
  cpa: "per verified join",
};

export const PLACEMENT_KEYS = ["library", "file_access", "playlist_between", "channel_join", "force_join"] as const;
export type PlacementKey = (typeof PLACEMENT_KEYS)[number];

export interface PlacementDefinition {
  key: PlacementKey;
  label: string;
  description: string;
  /** Only placements with `available: true` can be selected; the server rejects the others. */
  available: boolean;
  /** Why it can't be selected (shown to the creator). */
  unavailableReason?: string;
  /** Restricts the placement to certain ad types. */
  appliesTo?: readonly AdType[];
}

export const PLACEMENTS: readonly PlacementDefinition[] = [
  {
    key: "library",
    label: "Library",
    description: "A sponsored card at the top of the Library home view.",
    available: true,
  },
  {
    key: "file_access",
    label: "File access / download page",
    description: "A sponsored card on the public file page, below the actions.",
    available: true,
  },
  {
    key: "playlist_between",
    label: "Between playlist content",
    description: "A sponsored card between the items of a shared playlist.",
    available: true,
  },
  {
    key: "channel_join",
    label: "Channel join promotion",
    description: "A card with a Join button on the file page. With the verified-joins objective, membership is checked with Telegram.",
    available: true,
    appliesTo: ["telegram_channel"],
  },
  {
    key: "force_join",
    label: "Force join",
    description: "Require channel membership before gated content unlocks.",
    available: false,
    unavailableReason: "Not available yet — it needs a membership gate in the download flow, which Onfile hasn't shipped.",
  },
];

export function placementsForType(adType: AdType | null | undefined): PlacementDefinition[] {
  return PLACEMENTS.filter((p) => !p.appliesTo || (adType && p.appliesTo.includes(adType)));
}

export function isSelectablePlacement(key: string, adType: AdType): boolean {
  const def = PLACEMENTS.find((p) => p.key === key);
  return !!def && def.available && (!def.appliesTo || def.appliesTo.includes(adType));
}

/** Which stored placements a slot on a given surface can serve. */
export const SLOT_PLACEMENTS: Record<"library" | "file_access" | "playlist_between", PlacementKey[]> = {
  library: ["library"],
  file_access: ["file_access", "channel_join"],
  playlist_between: ["playlist_between"],
};
export type SlotKey = keyof typeof SLOT_PLACEMENTS;
export function isSlotKey(v: unknown): v is SlotKey {
  return v === "library" || v === "file_access" || v === "playlist_between";
}

/** Targeting dimensions that Onfile can really evaluate. Device/platform is NOT reliably available, so it is not offered. */
export const LANGUAGE_OPTIONS = [
  { code: "en", label: "English" },
  { code: "ru", label: "Russian" },
  { code: "es", label: "Spanish" },
  { code: "pt", label: "Portuguese" },
  { code: "ar", label: "Arabic" },
  { code: "hi", label: "Hindi" },
  { code: "bn", label: "Bengali" },
  { code: "id", label: "Indonesian" },
  { code: "tr", label: "Turkish" },
  { code: "fr", label: "French" },
  { code: "de", label: "German" },
  { code: "uk", label: "Ukrainian" },
] as const;

export const COUNTRY_OPTIONS = [
  { code: "US", label: "United States" }, { code: "GB", label: "United Kingdom" }, { code: "CA", label: "Canada" },
  { code: "AU", label: "Australia" }, { code: "DE", label: "Germany" }, { code: "FR", label: "France" },
  { code: "ES", label: "Spain" }, { code: "IT", label: "Italy" }, { code: "BR", label: "Brazil" },
  { code: "MX", label: "Mexico" }, { code: "RU", label: "Russia" }, { code: "UA", label: "Ukraine" },
  { code: "TR", label: "Türkiye" }, { code: "IN", label: "India" }, { code: "BD", label: "Bangladesh" },
  { code: "PK", label: "Pakistan" }, { code: "ID", label: "Indonesia" }, { code: "PH", label: "Philippines" },
  { code: "VN", label: "Vietnam" }, { code: "NG", label: "Nigeria" }, { code: "EG", label: "Egypt" },
  { code: "SA", label: "Saudi Arabia" }, { code: "AE", label: "United Arab Emirates" }, { code: "ZA", label: "South Africa" },
] as const;

export const LIMITS = {
  titleMax: 80,
  headlineMax: 60,
  descriptionMax: 140,
  ctaMax: 20,
  budgetMin: 1,
  budgetMax: 100_000,
  targetMax: 100_000_000,
  maxDurationDays: 365,
  maxPlacements: 5,
  maxCountries: 25,
  maxLanguages: 12,
} as const;

export const DEFAULT_CTA: Record<AdType, string> = {
  onfile_content: "Open",
  telegram_channel: "Join",
  telegram_post: "View post",
};

export const PAYMENT_STATUSES = ["pending_confirmation", "confirmed"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];
export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  pending_confirmation: "Pending admin confirmation",
  confirmed: "Confirmed",
};

export const COMPLETION_REASONS = ["target_reached", "budget_exhausted", "duration_ended", "admin"] as const;
export type CompletionReason = (typeof COMPLETION_REASONS)[number];
export const COMPLETION_REASON_LABELS: Record<CompletionReason, string> = {
  target_reached: "Target reached",
  budget_exhausted: "Budget used up",
  duration_ended: "Campaign period ended",
  admin: "Closed by Onfile",
};

/** Wording shown wherever pricing matters. There is deliberately no number in it. */
export const PRICING_NOTICE =
  "Onfile has no published rates yet. After you submit, an administrator confirms the price and your payment arrangement before the campaign can run. Your budget is a spending cap — nothing is taken from your wallet.";
