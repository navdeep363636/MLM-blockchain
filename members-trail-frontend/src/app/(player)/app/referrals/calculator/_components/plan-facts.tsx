"use client";

/* ============================================================================
 * The parts of the commission-structure page that quote the plan.
 *
 * Split out of the page because the page is a server component with a `metadata`
 * export, and these need the live plan. The plan is a POLICY value — Finance
 * proposes it, Compliance approves it, and it is versioned in the database. A
 * copy compiled into the bundle would keep quoting the previous version after an
 * approval, and for a commission rate that is not a stale cache, it is an
 * incorrect promise on a page about how members get paid.
 *
 * While the plan is loading, and if no plan is active, these render a plain
 * "not published" state rather than placeholder numbers.
 * ========================================================================== */

import { Scale } from "lucide-react";
import { Callout, LevelBadge, Skeleton } from "@/components/ui";
import { usePublicReferralPlan } from "@/lib/hooks/use-data";
import { formatToken } from "@/lib/utils";

const LEVEL_BLURB: Record<number, string> = {
  1: "Someone who signed up with your code.",
  2: "Someone your direct referral brought in.",
  3: "One step further. This is where it stops.",
};

export function RateTable() {
  const { data: plan, isLoading } = usePublicReferralPlan();

  if (isLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-3">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-40 rounded-[var(--radius-card)]" />
        ))}
      </div>
    );
  }

  if (plan.levels.length === 0) {
    return (
      <Callout tone="warning" title="No commission plan is currently published">
        <p className="mt-1">
          Rates are shown here once a plan version has been approved. Nothing accrues in the
          meantime — and we would rather show you nothing than a rate that is not in force.
        </p>
      </Callout>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-3">
      {plan.levels.map((l) => (
        <div
          key={l.level}
          className="relative overflow-hidden rounded-[var(--radius-card)] border border-border-subtle bg-surface-1 p-5"
        >
          <span
            className="absolute inset-x-0 top-0 h-0.5"
            style={{ background: `var(--series-${l.level})` }}
          />
          <div className="flex items-baseline justify-between gap-3">
            <LevelBadge level={l.level} />
            <span className="tnum font-display text-2xl font-semibold tracking-tight text-text-primary">
              {l.ratePct}%
            </span>
          </div>
          <p className="mt-3 text-sm text-text-secondary">{LEVEL_BLURB[l.level]}</p>
          <p className="mt-2 text-xs leading-relaxed text-text-muted">
            Applied to that member&apos;s eligible real-money spend only.
          </p>
        </div>
      ))}
    </div>
  );
}

export function CapFormula() {
  const { data: plan, isLoading } = usePublicReferralPlan();
  if (isLoading || plan.levels.length === 0) return null;

  return (
    <Callout tone="brand" title="How your monthly cap is calculated" icon={<Scale />} className="mt-5">
      <p className="mt-1">
        <code className="rounded bg-surface-3 px-1.5 py-0.5 font-mono text-[11px] text-text-secondary">
          cap = min(₹{formatToken(plan.monthlyCapAbsolute, 0)}, {plan.monthlyCapMultiplier} × your
          trailing 3-month average real-money spend + ₹{formatToken(plan.monthlyCapBase, 0)})
        </code>
        <br />
        Tying the ceiling loosely to your own engagement as a player — rather than purely to how many
        people you recruit — is what keeps referral income secondary. Amounts above the cap are not
        paid and do not carry over into the following month.
      </p>
    </Callout>
  );
}

/** The eligibility gate whose thresholds come from the plan. */
export function EligibilityThreshold() {
  const { data: plan } = usePublicReferralPlan();
  if (plan.minAccountAgeDays === 0 && plan.minGameplaySessions === 0) {
    return <>Minimum account age and gameplay activity</>;
  }
  return (
    <>
      Minimum {plan.minAccountAgeDays} days and {plan.minGameplaySessions} sessions
    </>
  );
}
