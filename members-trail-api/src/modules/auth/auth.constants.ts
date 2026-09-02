/**
 * Access-token issuer and audience.
 *
 * Named constants because they are asserted in two places that are easy to
 * drift apart: signing (SessionService) and verification (JwtAuthGuard, the
 * realtime gateway). Verifying with only the secret checks neither claim.
 */
export const ACCESS_TOKEN_ISSUER = "members-trail";
export const ACCESS_TOKEN_AUDIENCE = "members-trail-api";

/* ============================================================================
 * Registration-time compliance and credential rules (FRD A-01, A-04).
 *
 * These live in code rather than the database on purpose: a jurisdiction block
 * and a breached-password list are security controls, and a control that can be
 * switched off with an UPDATE statement by anyone with write access to
 * platform_config is not a control. Widening the list is a reviewed deploy.
 * ========================================================================== */

/**
 * ISO-3166-1 alpha-2 codes we refuse to onboard.
 *
 * Composition, so a reviewer can audit each entry:
 *  - OFAC comprehensively sanctioned programmes,
 *  - FATF "call for action" (blacklist) jurisdictions,
 *  - territories where a play-to-earn token model has no lawful route.
 */
export const RESTRICTED_JURISDICTIONS: ReadonlySet<string> = new Set([
  /* OFAC comprehensive sanctions */
  "CU", // Cuba
  "IR", // Iran
  "KP", // North Korea
  "SY", // Syria
  "RU", // Russia
  "BY", // Belarus
  "VE", // Venezuela
  /* FATF call-for-action / high-risk */
  "MM", // Myanmar
  "AF", // Afghanistan
  /* No lawful route for the token model */
  "US", // requires state-by-state licensing the platform does not hold
  "SG", // MAS restrictions on retail token incentives
]);

/** Minimum onboarding age. A jurisdiction may raise it, never lower it. */
export const GLOBAL_MIN_AGE = 18;

/** Jurisdictions whose statutory minimum age is above the global floor. */
export const JURISDICTION_MIN_AGE: Readonly<Record<string, number>> = {
  JP: 20,
  KR: 19,
  MY: 21,
  AE: 21,
  IN: 18,
};

export function minimumAgeFor(country: string): number {
  return JURISDICTION_MIN_AGE[country] ?? GLOBAL_MIN_AGE;
}

export function isRestrictedJurisdiction(country: string | null | undefined): boolean {
  if (!country) return false;
  return RESTRICTED_JURISDICTIONS.has(country.trim().toUpperCase());
}

/* ------------------------------- passwords -------------------------------- */

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

/**
 * Built-in breached-password sample. Deliberately small — it is the last line
 * of defence for the passwords that appear at the top of every credential dump
 * that still satisfy a 10-character minimum. A full HIBP range check runs in
 * the notification worker; this is the synchronous guard so a known-terrible
 * password can never be stored even if that service is down.
 */
export const BREACHED_PASSWORDS: ReadonlySet<string> = new Set([
  "password1234",
  "password123",
  "password1!",
  "passw0rd123",
  "qwerty123456",
  "qwertyuiop123",
  "1234567890",
  "12345678910",
  "iloveyou123",
  "letmein1234",
  "welcome1234",
  "welcome123!",
  "admin123456",
  "administrator",
  "football123",
  "baseball123",
  "sunshine123",
  "princess123",
  "trustno1234",
  "dragon12345",
  "monkey12345",
  "shadow12345",
  "master12345",
  "superman123",
  "batman12345",
  "michael1234",
  "jennifer123",
  "jordan23456",
  "harley12345",
  "abc123456789",
  "aaaaaaaaaa",
  "zaq12wsxcde3",
  "qazwsxedcrfv",
  "1qaz2wsx3edc",
  "asdfghjkl123",
  "zxcvbnm12345",
  "changeme123",
  "letmein2024",
  "password2024",
  "password2025",
  "crypto123456",
  "bitcoin12345",
]);

/** Common stems that make a password guessable regardless of the suffix. */
const WEAK_STEMS = [
  "password", "qwerty", "asdfgh", "zxcvbn", "letmein", "welcome",
  "iloveyou", "monkey", "dragon", "trustno", "changeme", "membertrail",
  "memberstrail", "mtttoken",
];

export interface PasswordProblem {
  code: string;
  message: string;
}

/**
 * Validates a candidate password. Returns every problem rather than the first
 * so the UI can show a complete checklist instead of making the user guess
 * one rule at a time.
 */
export function checkPassword(
  password: string,
  context: { email?: string; fullName?: string } = {},
): PasswordProblem[] {
  const problems: PasswordProblem[] = [];
  const value = password ?? "";

  if (value.length < PASSWORD_MIN_LENGTH) {
    problems.push({
      code: "TOO_SHORT",
      message: `Password must be at least ${PASSWORD_MIN_LENGTH} characters`,
    });
  }
  if (value.length > PASSWORD_MAX_LENGTH) {
    problems.push({
      code: "TOO_LONG",
      message: `Password must be at most ${PASSWORD_MAX_LENGTH} characters`,
    });
  }

  const classes = [
    /[a-z]/.test(value),
    /[A-Z]/.test(value),
    /[0-9]/.test(value),
    /[^A-Za-z0-9]/.test(value),
  ].filter(Boolean).length;

  if (classes < 3) {
    problems.push({
      code: "TOO_SIMPLE",
      message:
        "Password must combine at least three of: lowercase, uppercase, number, symbol",
    });
  }

  const lower = value.toLowerCase();

  if (BREACHED_PASSWORDS.has(lower)) {
    problems.push({
      code: "BREACHED",
      message: "This password appears in known breach data. Choose another.",
    });
  } else if (WEAK_STEMS.some((stem) => lower.includes(stem))) {
    problems.push({
      code: "PREDICTABLE",
      message: "Password contains a commonly guessed word. Choose another.",
    });
  }

  /* A password derived from the account's own identifiers is public knowledge. */
  const local = context.email?.split("@")[0]?.toLowerCase();
  if (local && local.length >= 4 && lower.includes(local)) {
    problems.push({
      code: "CONTAINS_EMAIL",
      message: "Password must not contain your email address",
    });
  }
  const nameParts = (context.fullName ?? "")
    .toLowerCase()
    .split(/\s+/)
    .filter((p) => p.length >= 4);
  if (nameParts.some((p) => lower.includes(p))) {
    problems.push({
      code: "CONTAINS_NAME",
      message: "Password must not contain your name",
    });
  }

  /* Single repeated character, or a straight run — both trivially cracked. */
  if (/^(.)\1+$/.test(value)) {
    problems.push({ code: "REPEATED", message: "Password must not be a single repeated character" });
  }

  return problems;
}

/* ------------------------------ misc helpers ------------------------------ */

/** Parses a jsonwebtoken-style duration ("15m", "30d", "45s") into seconds. */
export function parseDurationSeconds(value: string): number {
  const m = /^(\d+)\s*(s|m|h|d)?$/.exec(value.trim());
  if (!m) throw new Error(`Unsupported duration: ${value}`);
  const n = Number(m[1]);
  switch (m[2] ?? "s") {
    case "s": return n;
    case "m": return n * 60;
    case "h": return n * 3_600;
    case "d": return n * 86_400;
    default: return n;
  }
}

/** Whole years between a date-of-birth (YYYY-MM-DD) and now, UTC. */
export function ageInYears(dateOfBirth: string, now: Date = new Date()): number {
  const dob = new Date(`${dateOfBirth}T00:00:00.000Z`);
  if (Number.isNaN(dob.getTime())) return Number.NaN;
  let age = now.getUTCFullYear() - dob.getUTCFullYear();
  const beforeBirthday =
    now.getUTCMonth() < dob.getUTCMonth() ||
    (now.getUTCMonth() === dob.getUTCMonth() && now.getUTCDate() < dob.getUTCDate());
  if (beforeBirthday) age -= 1;
  return age;
}

/** True when the identifier looks like an email rather than a phone number. */
export function isEmailIdentifier(identifier: string): boolean {
  return identifier.includes("@");
}

/** E.164-ish normalisation: keep a leading + and digits only. */
export function normalisePhone(phone: string): string {
  const digits = phone.replace(/[^\d]/g, "");
  return `+${digits}`;
}

export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Country hint headers set by CDNs / edge proxies, in order of preference. */
export const IP_COUNTRY_HEADERS = [
  "cf-ipcountry",
  "x-vercel-ip-country",
  "x-geo-country",
  "x-appengine-country",
] as const;

/** Risk score added when a signal fires at registration. */
export const RISK_WEIGHTS = {
  countryMismatch: 25,
  selfReferralSuspected: 60,
  restrictedIpCountry: 40,
} as const;
