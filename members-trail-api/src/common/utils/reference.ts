import { randomInt } from "node:crypto";

/* ============================================================================
 * Human-readable business references.
 *
 * Sequential ids leak volume and invite enumeration, so external references are
 * prefixed and random. The prefix makes a reference self-describing in a support
 * ticket, which is worth more than it sounds at 2am.
 * ========================================================================== */

const ALPHABET = "0123456789ABCDEFGHJKLMNPQRSTUVWXYZ"; // no I or O

function rand(len: number): string {
  let out = "";
  for (let i = 0; i < len; i++) out += ALPHABET[randomInt(0, ALPHABET.length)];
  return out;
}

export const Ref = {
  user: () => `USR-${rand(8)}`,
  transaction: () => `TX-${rand(10)}`,
  pointsEntry: () => `PT-${rand(10)}`,
  conversion: () => `CV-${rand(10)}`,
  withdrawal: () => `WD-${rand(10)}`,
  deposit: () => `DP-${rand(10)}`,
  commission: () => `CM-${rand(10)}`,
  reward: () => `RW-${rand(10)}`,
  ticket: () => `TK-${rand(8)}`,
  kyc: () => `KYC-${rand(8)}`,
  alert: () => `FA-${rand(8)}`,
  treasuryInflow: () => `TD-${rand(10)}`,
  treasuryOutflow: () => `TO-${rand(10)}`,
  gameSession: () => `GS-${rand(12)}`,
  tournament: () => `TRN-${rand(8)}`,
  order: () => `OR-${rand(10)}`,
  audit: () => `AL-${rand(10)}`,
  batch: () => `BATCH-${rand(8)}`,
} as const;

/** Anonymised label for a downline member. FRD R-02 forbids exposing identity. */
export const anonLabel = (userRef: string): string => `Member #${userRef.replace(/^USR-/, "").slice(0, 6)}`;

/** Masks an email for display in logs and admin lists. */
export function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return "•••";
  const head = local.slice(0, Math.min(2, local.length));
  return `${head}${"•".repeat(Math.max(3, local.length - 2))}@${domain}`;
}

/** Masks a phone number, keeping the last two digits. */
export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits.length < 4 ? "••••" : `${"•".repeat(digits.length - 2)}${digits.slice(-2)}`;
}
