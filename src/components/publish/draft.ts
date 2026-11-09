import type { Monetization } from "@/lib/publishing/constants";
import type { StagedThumbnail } from "@/lib/publishing/thumbnailStorage";

export type StepIndex = 0 | 1 | 2 | 3;

export const STEP_LABELS = ["Link", "Details", "Monetization", "Publish"] as const;

export interface VerifiedLinkInfo {
  /** The exact (trimmed) input string that was verified. */
  forLink: string;
  canonicalLink: string;
  messageId: number;
  channelName: string | null;
  channelUsername: string | null;
}

export interface PublishDraft {
  link: string;
  verified: VerifiedLinkInfo | null;
  title: string;
  description: string;
  category: string;
  fileType: string;
  playlistId: string;
  /** Never persisted to storage. */
  password: string;
  thumbnail: StagedThumbnail | null;
  monetization: Monetization;
  starsPrice: string;
}

export const EMPTY_DRAFT: PublishDraft = {
  link: "",
  verified: null,
  title: "",
  description: "",
  category: "",
  fileType: "video",
  playlistId: "",
  password: "",
  thumbnail: null,
  monetization: "free",
  starsPrice: "",
};

const KEY = "onfile_publish_draft_v1";

interface Persisted {
  step: StepIndex;
  draft: Omit<PublishDraft, "password" | "thumbnail">;
  /** Server-staged thumbnail (opaque ref + stable remote URL). Never a blob: URL. */
  thumbnail?: StagedThumbnail | null;
}

/**
 * Drafts live only in this tab's sessionStorage so a refresh or an accidental
 * tab switch doesn't lose work. It holds form values and the staged-thumbnail
 * reference only: no password, and nothing in it is ever trusted — publishing re-verifies everything server-side.
 */
export function loadDraft(): { step: StepIndex; draft: PublishDraft } | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Persisted;
    if (!parsed || typeof parsed !== "object" || !parsed.draft) return null;
    const t = parsed.thumbnail;
    const thumbnail =
      t && typeof t.ref === "string" && /^[a-f0-9]{24}$/.test(t.ref) && typeof t.previewUrl === "string" && /^https?:\/\//.test(t.previewUrl)
        ? { ref: t.ref, previewUrl: t.previewUrl }
        : null;
    const draft: PublishDraft = { ...EMPTY_DRAFT, ...parsed.draft, password: "", thumbnail };
    const step = ([0, 1, 2, 3] as number[]).includes(parsed.step) ? parsed.step : 0;
    // Steps beyond "Link" require a verified link.
    const safeStep = (draft.verified && draft.verified.forLink === draft.link.trim() ? step : 0) as StepIndex;
    return { step: safeStep, draft };
  } catch {
    return null;
  }
}

export function saveDraft(step: StepIndex, draft: PublishDraft): void {
  if (typeof window === "undefined") return;
  try {
    const { password: _password, thumbnail, ...rest } = draft;
    void _password;
    window.sessionStorage.setItem(KEY, JSON.stringify({ step, draft: rest, thumbnail } satisfies Persisted));
  } catch {
    /* storage may be unavailable (private mode); drafting is best-effort */
  }
}

export function clearDraft(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
