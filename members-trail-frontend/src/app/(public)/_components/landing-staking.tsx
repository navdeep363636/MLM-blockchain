"use client";

/* Staking teaser. Every number here is labelled as the *current, variable*
 * period rate — CONVENTIONS.md forbids printing a fixed or guaranteed APR. */

import { AlertTriangle, ArrowRight, Lock, Timer } from "lucide-react";
import { Badge, Button, Callout, InfoHint, SkeletonCard } from "@/components/ui";
import { AnimatedCounter, RevealGroup, RevealItem } from "@/components/fx";
import { Sparkline } from "@/components/charts";
import { useStakingPools } from "@/lib/hooks/use-data";
import { daysLabel, formatCompact } from "@/lib/utils";

export function StakingTeaser() {
  const { data: pools, isLoading } = useStakingPools();
  const active = pools.filter((p) => p.active);

  if (isLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => <SkeletonCard key={i} className="h-48" />)}
      </div>
    );
  }

  return (
    <>
      <RevealGroup className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" stagger={0.06}>
        {active.map((p) => (
          <RevealItem key={p.poolId} className="h-full">
            {/* Elevation and sheen, but no tilt: each pool card carries an
                InfoHint explaining how the rate is derived, and a transform
                would trap that tooltip inside the card. */}
            <div className="h-full">
              <div
                className="holo flex h-full flex-col rounded-[var(--radius-card)] border border-border-subtle bg-surface-1 p-5
                           [box-shadow:var(--shadow-e2),inset_0_1px_0_0_var(--rim-light)]
                           transition-[border-color,box-shadow] duration-[var(--dur-base)] ease-[var(--ease-tide)]
                           hover:border-[color-mix(in_oklab,var(--accent)_35%,var(--border-default))]
                           hover:[box-shadow:var(--shadow-e4),inset_0_1px_0_0_var(--rim-light-strong)]"
              >
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-text-primary">{p.name}</h3>
                <Badge tone="neutral" icon={p.lockDays === 0 ? <Timer className="size-3" /> : <Lock className="size-3" />}>
                  {p.lockDays === 0 ? "No lock" : daysLabel(p.lockDays)}
                </Badge>
              </div>

              <div className="mt-4 flex items-baseline gap-1.5">
                <span className="font-display text-3xl font-semibold tracking-tight text-gradient-sheen">
                  <AnimatedCounter value={p.currentApr} decimals={1} suffix="%" />
                </span>
                <InfoHint>
                  Current-period rate only. Pool APR = (reward-pool inflow for the period ÷ total value
                  staked) × (365 ÷ period days). It is recalculated from actual Revenue Treasury
                  inflows and can move up or down, including to zero.
                </InfoHint>
              </div>
              <p className="mt-1 text-xs font-medium text-text-muted">
                Variable rate, current period — not guaranteed
              </p>

              <div className="mt-4">
                <Sparkline
                  data={p.aprHistory.map((h) => ({ value: h.apr }))}
                  color="var(--series-1)"
                  height={30}
                />
                <p className="mt-1 text-[11px] text-text-muted">Trailing periods, same pool</p>
              </div>

              <dl className="mt-4 space-y-1.5 border-t border-border-subtle pt-3 text-xs">
                <div className="flex justify-between gap-2">
                  <dt className="text-text-muted">Total staked</dt>
                  <dd className="tnum font-medium text-text-primary">{formatCompact(p.totalStaked)} MTT</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-text-muted">Rewards funded</dt>
                  <dd className="tnum font-medium text-text-primary">{formatCompact(p.totalRewardsFunded)} MTT</dd>
                </div>
                {p.earlyPenaltyBps > 0 && (
                  <div className="flex justify-between gap-2">
                    <dt className="text-text-muted">Early exit penalty</dt>
                    <dd className="tnum font-medium text-text-primary">
                      {(p.earlyPenaltyBps / 100).toFixed(0)}% of unclaimed rewards
                    </dd>
                  </div>
                )}
              </dl>
              </div>
            </div>
          </RevealItem>
        ))}
      </RevealGroup>

      <Callout tone="warning" title="Yield is variable and never guaranteed" icon={<AlertTriangle />} className="mt-6">
        The percentages above are the rates that <em>have just been</em> funded for the current period.
        They are derived from real revenue that flowed into each pool&apos;s reward balance — not promised
        in advance, not fixed, and not a forecast. If revenue falls, the rate falls. Your stake
        principal is never used to pay another member, and staking is entirely optional: you can
        convert Points to MTT and withdraw without staking at all.
      </Callout>

      <div className="mt-6 flex flex-wrap gap-3">
        <Button href="/how-it-works#stake" variant="outline" iconRight={<ArrowRight className="size-4" />}>
          How staking rewards are funded
        </Button>
        <Button href="/tokenomics" variant="ghost">Read the tokenomics</Button>
      </div>
    </>
  );
}
