/**
 * Capability flags for monetized publishing.
 *
 * AUDIT RESULT (see final report): the codebase stores `files.stars_price` and
 * the public page (src/app/f/[slug]) shows a "Pay N Stars" button, but there is
 * NO Telegram Stars payment backend: no invoice creation, no `pre_checkout_query`
 * / `successful_payment` handling in the webhook, no purchases/entitlements
 * table. `POST /api/link/[slug]` unlocks a file using only the optional password,
 * so a price on its own does NOT gate access.
 *
 * Therefore paid content must not be published as "paid": it would be
 * retrievable without payment. This flag is the single switch the new
 * publishing flow consults (server-side, in POST /api/files). Flip it ONLY
 * after a real invoice + entitlement check exists in the delivery route.
 * Nothing in this file simulates a payment.
 */
export const STARS_PAID_PUBLISHING_ENABLED = false;

export function isPaidPublishingAvailable(): boolean {
  return STARS_PAID_PUBLISHING_ENABLED;
}

export const PAID_PUBLISHING_UNAVAILABLE_MESSAGE =
  "Paid publishing isn't active yet because Telegram Stars payments aren't connected. Your paid post can be saved as an unpublished draft, or published as free content.";
