/**
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *  LEGAL CONFIGURATION — MUST BE COMPLETED BEFORE THE PRIVACY & TERMS PAGES ARE PUBLISHED
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 * The Privacy & Security and Terms & Conditions pages describe how the app actually works (taken from the
 * code). They deliberately do NOT contain any legal facts that could not be verified from the repository:
 * who the legal operator is, where it is registered, which law governs the Terms, and how to contact it.
 *
 * Every such fact lives here as `null`. While ANY required value below is still `null` the pages:
 *   - show a visible "Draft — legal details not yet configured" notice at the top, and
 *   - render each missing value as a highlighted "[… not configured]" placeholder,
 * so the pages can never read as if the legal details had been finalised.
 *
 * To finish: replace each `null` with the real value (a plain string), have the text reviewed by a qualified
 * lawyer, then set `effectiveDate`. Once every REQUIRED value is set, the draft notice disappears
 * automatically. Do not invent values: leave `null` if something is unknown.
 */

export interface LegalConfig {
  /** REQUIRED. Legal name of the person or company that operates Onfile. */
  operatorName: string | null;
  /** REQUIRED. Registered / postal address of the operator (or the address you are willing to publish). */
  operatorAddress: string | null;
  /** REQUIRED. Support & general contact email (also used for privacy and account-deletion requests unless overridden). */
  contactEmail: string | null;
  /** OPTIONAL. Dedicated privacy / data-removal contact. Falls back to `contactEmail`. */
  privacyEmail: string | null;
  /** OPTIONAL. Dedicated copyright / takedown contact. Falls back to `contactEmail`. */
  copyrightEmail: string | null;
  /** REQUIRED. Country / state whose law governs the Terms (e.g. "the laws of …"). Needs legal advice. */
  governingLaw: string | null;
  /** REQUIRED. Courts or forum for disputes (e.g. "the courts of …"). Needs legal advice. */
  disputeVenue: string | null;
  /** REQUIRED. Date the published versions take effect, e.g. "1 January 2027". */
  effectiveDate: string | null;
  /**
   * OPTIONAL. Name of the hosted PostgreSQL provider, once confirmed (the repository's configuration notes
   * mention Supabase, but production was not inspected). When null the policy says "a hosted PostgreSQL
   * database provider".
   */
  databaseProvider: string | null;
}

export const LEGAL_CONFIG: LegalConfig = {
  operatorName: null,
  operatorAddress: null,
  contactEmail: null,
  privacyEmail: null,
  copyrightEmail: null,
  governingLaw: null,
  disputeVenue: null,
  effectiveDate: null,
  databaseProvider: null,
};

/** Values that must be set before the pages can be published as final. */
export const REQUIRED_LEGAL_FIELDS = [
  "operatorName",
  "operatorAddress",
  "contactEmail",
  "governingLaw",
  "disputeVenue",
  "effectiveDate",
] as const satisfies readonly (keyof LegalConfig)[];

export const LEGAL_FIELD_LABELS: Record<keyof LegalConfig, string> = {
  operatorName: "Operator legal name",
  operatorAddress: "Operator address",
  contactEmail: "Contact email",
  privacyEmail: "Privacy contact",
  copyrightEmail: "Copyright contact",
  governingLaw: "Governing law",
  disputeVenue: "Dispute venue",
  effectiveDate: "Effective date",
  databaseProvider: "Database provider",
};

export function missingLegalFields(config: LegalConfig = LEGAL_CONFIG): (typeof REQUIRED_LEGAL_FIELDS)[number][] {
  return REQUIRED_LEGAL_FIELDS.filter((key) => !isSet(config[key]));
}

export function isLegalConfigComplete(config: LegalConfig = LEGAL_CONFIG): boolean {
  return missingLegalFields(config).length === 0;
}

function isSet(value: string | null): value is string {
  return typeof value === "string" && value.trim() !== "" && !/^\s*(todo|tbd|placeholder)/i.test(value);
}

/** A configured value, or a clearly marked placeholder string such as "[Contact email — not configured]". */
export function legalValue(key: keyof LegalConfig, config: LegalConfig = LEGAL_CONFIG): string {
  const value = config[key];
  return isSet(value) ? value.trim() : `[${LEGAL_FIELD_LABELS[key]} — not configured]`;
}

export function isLegalValueSet(key: keyof LegalConfig, config: LegalConfig = LEGAL_CONFIG): boolean {
  return isSet(config[key]);
}

/** The privacy contact, falling back to the general contact email. */
export function privacyContact(config: LegalConfig = LEGAL_CONFIG): string {
  return isSet(config.privacyEmail) ? config.privacyEmail.trim() : legalValue("contactEmail", config);
}

/** The copyright contact, falling back to the general contact email. */
export function copyrightContact(config: LegalConfig = LEGAL_CONFIG): string {
  return isSet(config.copyrightEmail) ? config.copyrightEmail.trim() : legalValue("contactEmail", config);
}
