/* ============================================================================
 * Where an anonymous visitor is sent.
 *
 * A single constant rather than an address repeated across pages, because it is
 * the one contact detail that must be correct everywhere at once — a stale
 * support address on one page is a member whose problem goes nowhere.
 *
 * Read from the environment so staging does not send real people to production
 * support, with a sensible default so a missing variable degrades to a working
 * address rather than to `mailto:undefined`.
 * ========================================================================== */

export const SUPPORT_EMAIL =
  process.env.NEXT_PUBLIC_SUPPORT_EMAIL ?? "support@memberstrail.com";
