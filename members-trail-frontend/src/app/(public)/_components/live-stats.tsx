"use client";

/* Live stats strip. P-01 business rule: every statistic must come from
 * live/verified data — nothing on this strip is hard-coded. */

import { Coins, Gauge, Trophy, Users } from "lucide-react";
import { AnimatedCounter, LiveDot, Reveal } from "@/components/fx";
import { InfoHint, Skeleton } from "@/components/ui";
import { usePublicStats } from "@/lib/hooks/use-data";
import { cn } from "@/lib/utils";
import { Container } from "./shell";

export function LiveStatsStrip({ className }: { className?: string }) {
  const { data, isLoading } = usePublicStats();

  const items = [
    {
      key: "players",
      label: "Players active this month",
      value: data.totalPlayers,
      icon: <Users />,
      suffix: "",
      decimals: 0,
      hint: "Distinct accounts with at least one scored session in the trailing 30 days.",
    },
    {
      key: "staked",
      label: "MTT currently staked",
      value: data.mttStaked,
      icon: <Coins />,
      suffix: " MTT",
      decimals: 0,
      hint: "Sum of active stake principal across all pools, read from the staking contract.",
    },
    {
      key: "tournaments",
      label: "Tournaments run to date",
      value: data.tournamentsRun,
      icon: <Trophy />,
      suffix: "",
      decimals: 0,
      hint: "Completed, settled tournaments since launch — cancelled events are excluded.",
    },
    {
      key: "funded",
      label: "Payouts funded by real revenue",
      value: data.treasuryFundedPct,
      icon: <Gauge />,
      suffix: "%",
      decimals: 1,
      hint:
        "Share of staking rewards and commission paid from genuine platform revenue rather than " +
        "the 15% Treasury Reserve backstop. The target is 100% within the defined runway.",
    },
  ];

  return (
    <section
      className={cn("relative border-y border-border-subtle bg-surface-inset py-10 sm:py-12", className)}
      aria-labelledby="live-stats-heading"
    >
      <Container>
        <Reveal>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="live-stats-heading" className="text-sm font-semibold uppercase tracking-wider text-text-secondary">
              Platform activity
            </h2>
            <LiveDot label="Live platform data · cached, refreshed every few minutes" />
          </div>

          <dl className="mt-7 grid grid-cols-2 gap-x-6 gap-y-8 lg:grid-cols-4">
            {items.map((it) => (
              <div key={it.key} className="min-w-0">
                <dt className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-text-muted">
                  <span className="text-[var(--accent)] [&>svg]:size-3.5">{it.icon}</span>
                  <span className="truncate">{it.label}</span>
                  <InfoHint>{it.hint}</InfoHint>
                </dt>
                <dd className="mt-2">
                  {isLoading ? (
                    <Skeleton className="h-9 w-28" />
                  ) : (
                    <span className="font-display text-2xl font-semibold tracking-tight text-gradient-brand sm:text-3xl">
                      <AnimatedCounter value={it.value} decimals={it.decimals} suffix={it.suffix} />
                    </span>
                  )}
                </dd>
              </div>
            ))}
          </dl>

          <p className="mt-7 text-xs leading-relaxed text-text-muted">
            These figures are read from platform and on-chain data, not written into the page. They
            describe past and present activity only — they are not a forecast, and nothing here
            implies any level of future earnings for any individual player.
          </p>
        </Reveal>
      </Container>
    </section>
  );
}
