import Decimal from "decimal.js";

/* ============================================================================
 * Money and token arithmetic.
 *
 * Rule: never use JavaScript floats for balances. 0.1 + 0.2 !== 0.3, and in a
 * ledger that difference becomes a reconciliation failure. Everything here is
 * Decimal-based, and DB columns are DECIMAL, not DOUBLE.
 *
 * MTT has 18 decimals on-chain. We store DECIMAL(36,18) so an 18-decimal wei
 * value round-trips exactly, and convert to/from wei only at the chain boundary.
 * ========================================================================== */

Decimal.set({ precision: 40, rounding: Decimal.ROUND_DOWN });

export const MTT_DECIMALS = 18;
export const POINTS_SCALE = 0; // Points are integers by definition.

export type Numeric = string | number | Decimal;

export const dec = (v: Numeric): Decimal => new Decimal(v ?? 0);

/** Fixed-scale string suitable for a DECIMAL(36,18) column. */
export const toDbAmount = (v: Numeric): string => dec(v).toFixed(MTT_DECIMALS, Decimal.ROUND_DOWN);

/** Human display, truncated (never rounded up — we don't credit rounding). */
export const toDisplay = (v: Numeric, dp = 4): string => dec(v).toFixed(dp, Decimal.ROUND_DOWN);

/**
 * Fiat: exactly two decimals, truncated.
 *
 * Lives here rather than in each service because three of them had defined it
 * privately and identically — and a rounding rule that exists in three places
 * is a rounding rule that will eventually differ in one of them.
 */
export const fiat = (v: Numeric): string => dec(v ?? 0).toFixed(2, Decimal.ROUND_DOWN);

/** Token units → wei, for contract calls. */
export function toWei(v: Numeric, decimals = MTT_DECIMALS): bigint {
  return BigInt(dec(v).mul(new Decimal(10).pow(decimals)).toFixed(0, Decimal.ROUND_DOWN));
}

/** Wei → token units, for storage and display. */
export function fromWei(v: bigint | string, decimals = MTT_DECIMALS): string {
  return new Decimal(v.toString()).div(new Decimal(10).pow(decimals)).toFixed(decimals, Decimal.ROUND_DOWN);
}

export const add = (a: Numeric, b: Numeric): string => toDbAmount(dec(a).plus(dec(b)));
export const sub = (a: Numeric, b: Numeric): string => toDbAmount(dec(a).minus(dec(b)));
export const mul = (a: Numeric, b: Numeric): string => toDbAmount(dec(a).mul(dec(b)));

export const gt = (a: Numeric, b: Numeric): boolean => dec(a).gt(dec(b));
export const gte = (a: Numeric, b: Numeric): boolean => dec(a).gte(dec(b));
export const lt = (a: Numeric, b: Numeric): boolean => dec(a).lt(dec(b));
export const lte = (a: Numeric, b: Numeric): boolean => dec(a).lte(dec(b));
export const isZero = (a: Numeric): boolean => dec(a).isZero();
export const isNeg = (a: Numeric): boolean => dec(a).isNegative();

/** Basis points, truncated down. 800 bps of 1000 = 80. */
export function applyBps(amount: Numeric, bps: number): string {
  return toDbAmount(dec(amount).mul(bps).div(10_000));
}

/** Points → MTT at `pointsPerMtt`. Truncates: a user never receives more than
 *  the rate entitles them to, and the remainder stays as Points. */
export function pointsToMtt(points: number, pointsPerMtt: number): string {
  if (pointsPerMtt <= 0) throw new Error("pointsPerMtt must be positive");
  return toDbAmount(dec(points).div(pointsPerMtt));
}

/** Clamp helper for caps: returns the payable portion given remaining headroom. */
export function clampToHeadroom(desired: Numeric, headroom: Numeric): { payable: string; capped: string } {
  const d = dec(desired);
  const h = dec(headroom);
  if (h.lte(0)) return { payable: toDbAmount(0), capped: toDbAmount(d) };
  if (d.lte(h)) return { payable: toDbAmount(d), capped: toDbAmount(0) };
  return { payable: toDbAmount(h), capped: toDbAmount(d.minus(h)) };
}

export { Decimal };
