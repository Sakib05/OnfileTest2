import { DEFAULT_CTA, type AdType, type ContentKind, type Objective } from "@/lib/ads/constants";
import type { PublicCampaign } from "@/lib/ads/serialize";

/** Everything the wizard collects. Strings for inputs; converted to the API body by `toBody`. */
export interface WizardState {
  clientRef: string;
  /** Public reference once saved as a draft on the server (null before the first save). */
  ref: string | null;
  adType: AdType | null;
  contentKind: ContentKind | null;
  fileId: number | null;
  playlistId: number | null;
  channelId: number | null;
  channelMode: "own" | "external";
  destinationRef: string;
  inviteLink: string;
  objective: Objective | null;
  title: string;
  headline: string;
  description: string;
  ctaText: string;
  placements: string[];
  countries: string[];
  languages: string[];
  budget: string;
  targetAmount: string;
  startDate: string;
  endDate: string;
}

export interface ResolvedInfo {
  label: string;
  ownership: "own" | "external";
  channelUsername: string | null;
  joinVerifiable: boolean;
  joinNote: string | null;
  suggestedDescription: string | null;
}

/** Item chosen in step 1, kept for the preview (title/thumbnail come from Onfile's own data). */
export interface PickedItem {
  title: string;
  thumbnailUrl: string | null;
}

export function newClientRef(): string {
  const c = typeof crypto !== "undefined" ? crypto : undefined;
  if (c && typeof c.randomUUID === "function") return c.randomUUID().replace(/-/g, "");
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`.padEnd(12, "0");
}

export function emptyState(): WizardState {
  return {
    clientRef: newClientRef(),
    ref: null,
    adType: null,
    contentKind: null,
    fileId: null,
    playlistId: null,
    channelId: null,
    channelMode: "own",
    destinationRef: "",
    inviteLink: "",
    objective: null,
    title: "",
    headline: "",
    description: "",
    ctaText: "",
    placements: [],
    countries: [],
    languages: [],
    budget: "",
    targetAmount: "",
    startDate: "",
    endDate: "",
  };
}

/** The request body. Only creator-editable fields — there is nothing here the server would treat as status/spend/etc. */
export function toBody(s: WizardState): Record<string, unknown> {
  return {
    clientRef: s.clientRef,
    adType: s.adType,
    contentKind: s.adType === "onfile_content" ? s.contentKind : undefined,
    fileId: s.adType === "onfile_content" && s.contentKind === "file" ? s.fileId : undefined,
    playlistId: s.adType === "onfile_content" && s.contentKind === "playlist" ? s.playlistId : undefined,
    channelId: s.adType === "telegram_channel" && s.channelMode === "own" ? s.channelId : undefined,
    destinationRef: s.adType === "telegram_post" || (s.adType === "telegram_channel" && s.channelMode === "external") ? s.destinationRef : undefined,
    inviteLink: s.adType === "telegram_channel" && s.channelMode === "own" ? s.inviteLink : undefined,
    objective: s.objective ?? undefined,
    title: s.title,
    headline: s.headline,
    description: s.description,
    ctaText: s.ctaText,
    placements: s.placements,
    targeting: { countries: s.countries, languages: s.languages },
    budget: s.budget,
    targetAmount: s.targetAmount === "" ? undefined : s.targetAmount,
    startDate: s.startDate,
    endDate: s.endDate,
  };
}

export function fromCampaign(c: PublicCampaign, clientRef: string): WizardState {
  const external = c.adType === "telegram_channel" && !c.config.channelId && !!c.config.destinationRef;
  return {
    ...emptyState(),
    clientRef,
    ref: c.ref,
    adType: c.adType,
    contentKind: c.contentKind,
    fileId: c.config.fileId,
    playlistId: c.config.playlistId,
    channelId: c.config.channelId,
    channelMode: external ? "external" : "own",
    destinationRef: c.config.destinationRef,
    inviteLink: c.config.inviteLink,
    objective: c.objective,
    title: c.title,
    headline: c.headline,
    description: c.description,
    ctaText: c.ctaText || (c.adType ? DEFAULT_CTA[c.adType] : ""),
    placements: c.placements,
    countries: c.targeting.countries,
    languages: c.targeting.languages,
    budget: c.budget === null ? "" : String(c.budget),
    targetAmount: c.targetAmount === null ? "" : String(c.targetAmount),
    startDate: c.config.startDate,
    endDate: c.config.endDate,
  };
}

export const STEPS = ["Type", "Objective", "Creative", "Placements", "Audience", "Budget", "Review"] as const;
export type StepIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** Which wizard step shows a given server field error. */
export function stepForField(field: string): StepIndex {
  switch (field) {
    case "adType": case "contentKind": case "fileId": case "playlistId": case "channelId": case "destinationRef": case "inviteLink":
      return 0;
    case "objective":
      return 1;
    case "title": case "headline": case "description": case "ctaText":
      return 2;
    case "placements":
      return 3;
    case "countries": case "languages":
      return 4;
    default:
      return 5;
  }
}
