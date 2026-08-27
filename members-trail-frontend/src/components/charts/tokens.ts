/* ============================================================================
 * Chart palette tokens.
 *
 * Deliberately a separate module from impl.tsx: `seriesColor` is imported by
 * pages that render no chart at all, and if it lived alongside the recharts
 * imports every one of those pages would pull recharts into its bundle.
 * ========================================================================== */

export const SERIES_VARS = [
  "var(--series-1)", "var(--series-2)", "var(--series-3)", "var(--series-4)",
  "var(--series-5)", "var(--series-6)", "var(--series-7)", "var(--series-8)",
] as const;

/** Slot order is the CVD-safety mechanism — index in, never modulo-cycle past 8. */
export const seriesColor = (i: number) => SERIES_VARS[Math.min(i, SERIES_VARS.length - 1)];

export const SEQ_VARS = [
  "var(--seq-100)", "var(--seq-200)", "var(--seq-300)",
  "var(--seq-400)", "var(--seq-500)", "var(--seq-600)", "var(--seq-650)",
] as const;
