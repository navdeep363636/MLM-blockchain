/* ============================================================================
 * The cookie inventory, for the Cookie Policy page.
 *
 * This one stays in the repository on purpose, and it is the only content that
 * does. Everything else the pages used to carry — policy text, rates, caps,
 * jurisdiction lists — moved to the API because an operator changes it and a
 * bundled copy drifts.
 *
 * A cookie inventory is different: it must match what the CODE actually sets. It
 * changes when a developer adds a cookie or a third-party script, in the same
 * commit, reviewed by the same person. Putting it in a CMS would let the two
 * diverge silently, and a cookie table that does not match the cookies is a
 * compliance defect, not a stale cache.
 *
 * If you add anything that sets a cookie, add it here in the same change.
 * ========================================================================== */

export interface CookieGroup {
  category: "Strictly necessary" | "Functional" | "Analytics" | "Fraud prevention";
  name: string;
  purpose: string;
  duration: string;
  party: "First party" | "Third party";
  consentRequired: boolean;
}

export const cookieGroups: CookieGroup[] = [
  {
    category: "Strictly necessary",
    name: "mt_session",
    purpose: "Keeps you logged in and ties requests to your authenticated session.",
    duration: "Session, or 30 days if you choose to stay signed in",
    party: "First party",
    consentRequired: false,
  },
  {
    category: "Strictly necessary",
    name: "mt_csrf",
    purpose: "Cross-site request forgery token that stops a third-party page acting on your account.",
    duration: "Session",
    party: "First party",
    consentRequired: false,
  },
  {
    category: "Strictly necessary",
    name: "mt_consent",
    purpose: "Stores your cookie choices and the timestamp, so we can prove what you agreed to and not ask again.",
    duration: "12 months",
    party: "First party",
    consentRequired: false,
  },
  {
    category: "Strictly necessary",
    name: "__cf_bm / edge protection",
    purpose: "Bot management and rate limiting at the edge, protecting sign-in and payment endpoints.",
    duration: "Up to 30 minutes",
    party: "Third party",
    consentRequired: false,
  },
  {
    category: "Functional",
    name: "mt_theme",
    purpose: "Remembers your dark or light theme choice so the interface does not flash on load.",
    duration: "12 months",
    party: "First party",
    consentRequired: false,
  },
  {
    category: "Functional",
    name: "mt_locale",
    purpose: "Remembers your language and number formatting preference.",
    duration: "12 months",
    party: "First party",
    consentRequired: false,
  },
  {
    category: "Functional",
    name: "mt_ref",
    purpose: "Records the referral link you arrived through so the right member is credited at sign-up.",
    duration: "30 days",
    party: "First party",
    consentRequired: false,
  },
  {
    category: "Functional",
    name: "mt_wallet_hint",
    purpose: "Remembers which wallet provider you last connected with, to skip the picker.",
    duration: "6 months (local storage)",
    party: "First party",
    consentRequired: false,
  },
  {
    category: "Analytics",
    name: "mt_analytics_id",
    purpose: "Pseudonymous identifier used to count unique visitors and measure feature usage in aggregate.",
    duration: "13 months",
    party: "First party",
    consentRequired: true,
  },
  {
    category: "Analytics",
    name: "Product analytics provider",
    purpose: "Funnel, retention and feature-adoption measurement. IP is truncated and no KYC data is sent.",
    duration: "Up to 13 months",
    party: "Third party",
    consentRequired: true,
  },
  {
    category: "Analytics",
    name: "Error and performance monitoring",
    purpose: "Captures client-side errors and page performance so we can find and fix faults.",
    duration: "Up to 90 days",
    party: "Third party",
    consentRequired: true,
  },
  {
    category: "Fraud prevention",
    name: "mt_device_id",
    purpose: "Device identifier used to detect multi-accounting, self-referral and referral-loop fraud.",
    duration: "12 months",
    party: "First party",
    consentRequired: false,
  },
  {
    category: "Fraud prevention",
    name: "Device fingerprint signals",
    purpose: "Browser and device characteristics combined into a fingerprint that links duplicate accounts and flags account takeover.",
    duration: "Derived per request; the resulting signal is retained for 12 months",
    party: "Third party",
    consentRequired: false,
  },
  {
    category: "Fraud prevention",
    name: "Payment provider risk cookie",
    purpose: "Set by the payment processor during checkout to score the transaction for card fraud.",
    duration: "Set by the provider, typically up to 12 months",
    party: "Third party",
    consentRequired: false,
  },
];
