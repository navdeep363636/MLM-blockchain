"use client";

/* ============================================================================
 * AllocationChart reads the token's on-chain supply, so it needs the wallet
 * stack — and it is the only thing on any public route that does.
 *
 * Importing it eagerly put ~220 kB of wagmi + connectors into the tokenomics
 * page's first load, for a chart that sits well below the fold. Loading it after
 * hydration means the page's text and specification table paint on the same
 * budget as every other marketing page, and the chart fills in behind them.
 *
 * The skeleton reserves the chart's height so nothing below it moves.
 * ========================================================================== */

import dynamic from "next/dynamic";

export const AllocationChartLazy = dynamic(
  () => import("./allocation-web3").then((m) => m.AllocationChartWithWeb3),
  {
    ssr: false,
    loading: () => (
      <div
        className="shimmer rounded-[var(--radius-card)] border border-border-subtle bg-surface-1"
        style={{ height: 420 }}
        aria-hidden
      />
    ),
  },
);
