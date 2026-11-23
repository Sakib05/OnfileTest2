export interface Targeting {
  countries: string[];
  languages: string[];
}

export interface Viewer {
  /** ISO 3166-1 alpha-2 from the platform's network-location header, if available. */
  country: string | null;
  /** Signed-in viewer's saved language, if any. */
  language: string | null;
}

/**
 * An empty list means "everyone". A set list only matches a viewer whose value is KNOWN and listed — an unknown
 * country/language never matches a targeted campaign (we never guess).
 */
export function matchesTargeting(targeting: Partial<Targeting> | null | undefined, viewer: Viewer): boolean {
  const countries = targeting?.countries ?? [];
  const languages = targeting?.languages ?? [];
  if (countries.length > 0) {
    if (!viewer.country || !countries.includes(viewer.country.toUpperCase())) return false;
  }
  if (languages.length > 0) {
    if (!viewer.language || !languages.includes(viewer.language.toLowerCase().slice(0, 2))) return false;
  }
  return true;
}

export function viewerCountryFromHeaders(headers: Headers): string | null {
  const raw = headers.get("x-vercel-ip-country") ?? headers.get("cf-ipcountry");
  if (!raw) return null;
  const c = raw.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(c) && c !== "XX" && c !== "T1" ? c : null;
}
