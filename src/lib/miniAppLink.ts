/**
 * Helpers for opening a File Access page (`/f/[slug]`) inside the existing
 * Telegram Mini App WebView instead of Telegram's regular in-app browser.
 *
 * WHY THIS EXISTS
 * ---------------
 * A plain `https://<domain>/f/<slug>` link pasted into a chat is opened by
 * Telegram's *in-app browser*, which always renders Telegram's own native
 * header (page title + domain + share + menu). That header is drawn by the
 * Telegram client, outside the page, and cannot be hidden by a website.
 *
 * A *Mini App* launch is different: it opens the page in Telegram's WebView
 * with the Mini App chrome (bot name + Close), with no domain header. A Mini
 * App can only be launched via:
 *   - a bot menu button / inline `web_app` button / keyboard `web_app` button,
 *   - a Main Mini App link:   https://t.me/<bot>?startapp=<param>
 *   - a Direct Link Mini App: https://t.me/<bot>/<short_name>?startapp=<param>
 *     (created in @BotFather with /newapp; `short_name` is chosen there)
 *
 * The `startapp` value is handed to the Mini App as
 * `Telegram.WebApp.initDataUnsafe.start_param` (and the `tgWebAppStartParam`
 * URL parameter). Onfile's Mini App entry page reads it and routes to
 * `/f/<slug>`, so all access validation / unlock / delivery stays in the
 * existing File Access page and `/api/link/[slug]` API.
 *
 * Everything here is pure (no DOM, no network) so it is unit-testable.
 */

/** Prefix that marks a Mini App start parameter as "open this file page". */
export const FILE_START_PARAM_PREFIX = "f_";

/** Matches nanoid(10) slugs (A-Za-z0-9_-) and is also valid inside a start param. */
const SLUG_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
/** Telegram bot usernames: 5-32 chars, letters/digits/underscore. */
const BOT_USERNAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]{4,31}$/;
/** BotFather Mini App short names: letters/digits/underscore. */
const SHORT_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]{2,31}$/;

export function isValidFileSlug(slug: unknown): slug is string {
  return typeof slug === "string" && SLUG_PATTERN.test(slug);
}

/** `f_<slug>` — the value placed in `?startapp=`. Returns null for an unsafe slug. */
export function buildFileStartParam(slug: string): string | null {
  return isValidFileSlug(slug) ? `${FILE_START_PARAM_PREFIX}${slug}` : null;
}

/**
 * Extracts the file slug from a Mini App start parameter, or null when the
 * parameter is absent / is not a file route / contains anything unexpected.
 * Strict on purpose: the result is used to build an in-app route, so it must
 * never be able to carry a path, query, or scheme.
 */
export function parseFileStartParam(startParam: unknown): string | null {
  if (typeof startParam !== "string") return null;
  if (!startParam.startsWith(FILE_START_PARAM_PREFIX)) return null;
  const slug = startParam.slice(FILE_START_PARAM_PREFIX.length);
  return isValidFileSlug(slug) ? slug : null;
}

export interface MiniAppLinkConfig {
  /** Bot @username without the "@" (public information). */
  botUsername?: string | null;
  /**
   * Short name of a Direct Link Mini App registered with @BotFather
   * (/newapp). Optional: without it no Mini App deep link can be built,
   * because t.me/<bot>?startapp=... only works for a configured *Main* Mini
   * App, which cannot be verified from code.
   */
  appShortName?: string | null;
}

/**
 * Direct-link Mini App URL for a file, e.g.
 * `https://t.me/MyBot/app?startapp=f_AbCdEfGhIj`. Returns null unless BOTH the
 * bot username and the Mini App short name are known and well-formed — callers
 * must then fall back to the normal web URL.
 */
export function buildMiniAppFileLink(config: MiniAppLinkConfig | null | undefined, slug: string): string | null {
  const bot = config?.botUsername?.replace(/^@+/, "").trim();
  const app = config?.appShortName?.replace(/^\/+|\/+$/g, "").trim();
  const startParam = buildFileStartParam(slug);
  if (!bot || !app || !startParam) return null;
  if (!BOT_USERNAME_PATTERN.test(bot) || !SHORT_NAME_PATTERN.test(app)) return null;
  return `https://t.me/${bot}/${app}?startapp=${startParam}`;
}

/** Plain https URL of the File Access page (works in any browser). */
export function buildWebFileLink(origin: string, slug: string): string {
  return `${origin.replace(/\/+$/, "")}/f/${slug}`;
}

/**
 * The link creators should share: the Mini App deep link when it can be
 * built, otherwise the normal web URL (so sharing never breaks).
 */
export function buildShareFileLink(origin: string, config: MiniAppLinkConfig | null | undefined, slug: string): string {
  return buildMiniAppFileLink(config, slug) ?? buildWebFileLink(origin, slug);
}
