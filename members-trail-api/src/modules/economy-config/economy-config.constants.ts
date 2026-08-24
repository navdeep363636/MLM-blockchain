import type { RevenueStream } from "@/database/entities";

/* ============================================================================
 * Runtime economy policy.
 *
 * Every number below is a POLICY number, not a constant: Finance and Compliance
 * must be able to change a cap or a threshold without a deploy, and every change
 * has to be versioned and audited. That is exactly what `platform_config` is
 * for, so these are the *shapes* stored there plus the fallback used before an
 * admin has ever written a value.
 *
 * The env defaults in `economyConfig` are the seed for the fallbacks — env is
 * the floor, platform_config is the live truth.
 * ========================================================================== */

export const ConfigKeys = {
  pointsCaps: "points.caps",
  conversionCaps: "conversion.caps",
  withdrawalPolicy: "withdrawal.policy",
  treasuryAllocation: "treasury.allocation",
  marketplacePolicy: "marketplace.policy",
} as const;

/** Per-user Points issuance ceilings. All windows are UTC days. */
export interface PointsCapsConfig {
  /** Ceiling across every source for one user in one UTC day. */
  dailyGlobal: number;
  /** Used when a game row does not define its own daily cap. */
  perGameDailyDefault: number;
  /** Used when a game row does not define its own session cap. */
  perSessionDefault: number;
}

/** Points → MTT conversion ceilings, measured in Points spent. */
export interface ConversionCapsConfig {
  dailyPoints: number;
  monthlyPoints: number;
}

export interface WithdrawalPolicyConfig {
  /** Above this MTT amount a request always goes to manual compliance review. */
  autoApproveMtt: string;
  /** Anti-fraud delay before the first withdrawal to a non-whitelisted address. */
  coolingOffHours: number;
  /** Rolling-window ceiling per KYC tier, in MTT. Tier 0 cannot withdraw. */
  tierLimitsMtt: Record<"0" | "1" | "2", string>;
  /** Width of the rolling window the tier limit is measured over. */
  rollingWindowDays: number;
}

/**
 * Share of NET revenue routed to the Treasury, per stream, in basis points —
 * plus the fiat reference price used to express an inflow in MTT.
 *
 * `fiatPerMtt` is admin-managed rather than oracle-derived on purpose: an inflow
 * must be recorded at the rate *in force when it was recorded*, and a
 * retroactively moving oracle price would silently change historical headroom.
 */
export interface TreasuryAllocationConfig {
  allocationBps: Record<RevenueStream, number>;
  fiatPerMtt: string;
  /** Portion of each inflow earmarked as the Treasury Reserve (FRD §8.4). */
  reserveBps: number;
}

/**
 * Marketplace rules. The fee is the platform's only take on a member-to-member
 * trade, and it is Treasury revenue — but NOT commissionable, because the
 * spender bought from another member, not from the platform (conventions §3).
 */
export interface MarketplacePolicyConfig {
  /** Platform fee on a sale, in basis points of the asking price. */
  feeBps: number;
  /** Minimum asking price, to stop dust listings from spamming the market. */
  minAskMtt: string;
  /** Ceiling on a single listing, as an anti-manipulation guard. */
  maxAskMtt: string;
  /** Listings older than this are expired by the cron. */
  listingTtlDays: number;
}

/** Streams that represent a genuine member purchase, and may therefore generate
 *  referral commission (conventions §3). Everything else funds the Treasury but
 *  is not attributable to a member's spend. */
export const COMMISSION_ELIGIBLE_STREAMS: readonly RevenueStream[] = [
  "iap",
  "tournament",
  "subscription",
] as const;

/** Payout ratio at or above which the compliance alert fires (bps of inflow). */
export const PAYOUT_RATIO_ALERT_BPS = 9_000;

/** A treasury outflow needs this many distinct approvers, none of whom may be
 *  the proposer (FRD AD-08, conventions §11). */
export const OUTFLOW_MIN_APPROVERS = 2;
