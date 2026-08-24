import type { KycDocKind } from "@/database/entities";

/* ============================================================================
 * KYC policy constants (FRD A-05, AML Policy).
 * ========================================================================== */

/**
 * Provider confidence at or above which a submission is approved without a
 * human. Set high on purpose: a false auto-approval admits an unverified
 * identity to the withdrawal path, whereas a false referral to manual review
 * costs a reviewer two minutes.
 */
export const AUTO_APPROVE_CONFIDENCE = 85;

/** Below this the submission is rejected outright rather than queued. */
export const AUTO_REJECT_CONFIDENCE = 20;

/**
 * Record-keeping period. FATF Recommendation 11 and EU AMLD require five years
 * from the end of the business relationship; documents are purged by cron once
 * `retentionUntil` passes, and not before — deleting early is as much of a
 * breach as keeping them forever.
 */
export const AML_RETENTION_YEARS = 5;

/** Documents that must be present for each tier to be reviewable. */
export const REQUIRED_DOCUMENTS: Record<1 | 2, KycDocKind[]> = {
  1: ["id_front", "id_back", "selfie"],
  2: ["address_proof"],
};

/** Kinds accepted for a tier — anything else is a bad request. */
export const ALLOWED_DOCUMENTS: Record<1 | 2, KycDocKind[]> = {
  1: ["id_front", "id_back", "selfie"],
  2: ["id_front", "id_back", "selfie", "address_proof", "source_of_funds"],
};

/** Upload ceiling per document, mirrored from the presigned-upload policy. */
export const MAX_DOCUMENT_BYTES = 15 * 1024 * 1024;

export const ALLOWED_MIME_TYPES = [
  "image/jpeg", "image/png", "image/webp", "image/heic", "application/pdf",
] as const;

/** Provider name used for the inbound webhook's dedupe scope. */
export const KYC_WEBHOOK_PROVIDER = "kyc-provider";

export function retentionDeadline(from: Date = new Date()): Date {
  const d = new Date(from);
  d.setUTCFullYear(d.getUTCFullYear() + AML_RETENTION_YEARS);
  return d;
}
