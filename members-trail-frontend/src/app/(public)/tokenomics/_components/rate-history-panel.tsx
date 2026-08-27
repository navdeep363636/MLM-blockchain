"use client";

/* ============================================================================
 * The conversion rate, on a public page.
 *
 * This page used to render the full rate HISTORY from a bundled array. Two things
 * were wrong with that, and only one of them is staleness.
 *
 * The history — every superseded rate, who proposed it and who approved it — is
 * governance data. It is on `/admin/conversion/rates` behind a permission, and it
 * should stay there: the names of the two officers who signed off a rate change
 * are not public information.
 *
 * What a visitor legitimately needs is the rate in force and the next one if a
 * change is already scheduled, which is exactly what `/conversion/rate` serves,
 * unauthenticated. So that is what this renders — fewer rows than before, and all
 * of them true.
 * ========================================================================== */

import { useConversionRate } from "@/lib/hooks/use-data";
import { Callout, Skeleton } from "@/components/ui";
import { RateHistory } from "./allocation";

export function RateHistoryPanel() {
  const { data: rate, isLoading } = useConversionRate();

  if (isLoading) return <Skeleton className="h-40 rounded-[var(--radius-card)]" />;

  if (!rate.pointsPerMtt) {
    return (
      <Callout tone="warning" title="No conversion rate is currently published">
        <p className="mt-1">
          A rate takes effect once Finance has proposed it and Compliance has approved it. Until
          then there is nothing to quote, and we would rather show you that than a number.
        </p>
      </Callout>
    );
  }

  const rows = [
    {
      pointsPerMtt: rate.pointsPerMtt,
      effectiveFrom: rate.effectiveFrom,
      status: "active" as const,
    },
    ...(rate.nextPointsPerMtt !== null && rate.nextEffectiveFrom !== null
      ? [
          {
            pointsPerMtt: rate.nextPointsPerMtt,
            effectiveFrom: rate.nextEffectiveFrom,
            status: "scheduled" as const,
          },
        ]
      : []),
  ];

  return <RateHistory rows={rows} />;
}
