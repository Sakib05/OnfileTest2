/**
 * Business / legal details used by the Privacy & Security and Terms & Conditions pages.
 *
 * NOTHING here is invented. Every value that Onfile's owner has not supplied is `null`, and the pages then show a
 * clearly marked "[To be configured: …]" placeholder instead of made-up details. Fill these in (and have the documents
 * reviewed by a qualified lawyer) BEFORE publishing the documents as final.
 */
export interface LegalConfig {
  /** Registered legal name of the company/person operating Onfile. */
  legalEntityName: string | null;
  /** Public contact e-mail for privacy, support and copyright notices. */
  contactEmail: string | null;
  /** Postal address of the operator. */
  contactAddress: string | null;
  /** Governing law / jurisdiction for disputes. */
  governingLaw: string | null;
  /** Minimum age to use Onfile (set by the operator after legal review; Telegram's own minimum also applies). */
  minimumAge: string | null;
}

export const LEGAL_CONFIG: LegalConfig = {
  legalEntityName: null,
  contactEmail: null,
  contactAddress: null,
  governingLaw: null,
  minimumAge: null,
};

/** Date the current drafts were last edited (ISO). Update whenever the documents change. */
export const LEGAL_LAST_UPDATED = "2026-11-21";

export function formatLegalDate(iso: string = LEGAL_LAST_UPDATED): string {
  const [y, m, d] = iso.split("-").map(Number);
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  return `${months[m - 1]} ${d}, ${y}`;
}

/** Returns the configured value, or a visible placeholder marker when it hasn't been configured. */
export function legalValue(value: string | null, label: string): string {
  return value && value.trim() ? value.trim() : `[To be configured: ${label}]`;
}

export function isPlaceholder(text: string): boolean {
  return text.includes("[To be configured:");
}
