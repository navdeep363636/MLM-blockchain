"use client";

/* Live stats strip. P-01 business rule: every statistic must come from
 * live/verified data — nothing on this strip is hard-coded. */

import { Coins, Gauge, Trophy, Users } from "lucide-react";
import { AnimatedCounter, LiveDot, MeshHaze, Reveal, Sheen } from "@/components/fx";
import { InfoHint, Skeleton } from "@/components/ui";
import { usePublicStats } from "@/lib/hooks/use-data";
import { cn } from "@/lib/utils";
import { Container } from "./shell";

export function LiveStatsStrip({ className }: { className?: string }) {
  const { data, isLoading } = usePublicStats();

  /* A tile whose figure the ledger cannot substantiate is DROPPED, not rendered
   * as 0. This strip sits next to the product's promises, and "0.0% of payouts
   * funded by real revenue" is a far worse claim to publish by accident than one
   * fewer tile. P-01 forbids hard-coding these numbers; it equally forbids
   * inventing one when the answer is "not yet known". */
  const items: {
    key: string;
    label: string;
    value: number | null;
    icon: React.ReactNode;
    suffix: string;
    decimals: number;
    hint: string;
  }[] = [
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

  const shown = items.filter((it): it is typeof it & { value: number } => it.value !== null);

  return (
    <section
      className={cn("scene relative isolate overflow-hidden border-y border-border-subtle bg-surface-inset py-10 sm:py-12", className)}
      aria-labelledby="live-stats-heading"
    >
      <MeshHaze opacity={0.2} />
      <Container className="relative">
        <Reveal>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="live-stats-heading" className="font-display text-sm font-semibold uppercase tracking-[0.16em] text-text-secondary">
              Platform activity
            </h2>
            <LiveDot label="Live platform data · cached, refreshed every few minutes" />
          </div>

          <dl className="mt-7 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {shown.map((it) => (
              /* Each figure sits on its own faintly raised plate. Four numbers
                 in a row with nothing between them read as a table; four plates
                 read as four facts. */
              <div
                key={it.key}
                className="group relative min-w-0 rounded-[var(--radius-card)] border border-border-subtle bg-surface-1/60 p-4
                           [box-shadow:inset_0_1px_0_0_var(--rim-light)] backdrop-blur-sm
                           transition-[border-color,box-shadow,transform] duration-[var(--dur-base)] ease-[var(--ease-tide)]
                           hover:-translate-y-0.5 hover:border-[color-mix(in_oklab,var(--accent)_32%,var(--border-default))]
                           hover:[box-shadow:var(--shadow-e3),inset_0_1px_0_0_var(--rim-light-strong)]"
              >
                <Sheen trigger={it.value} />
                <dt className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-text-muted">
                  <span className="text-[var(--accent)] [&>svg]:size-3.5">{it.icon}</span>
                  <span className="truncate">{it.label}</span>
                  <InfoHint>{it.hint}</InfoHint>
                </dt>
                <dd className="mt-2">
                  {isLoading ? (
                    <Skeleton className="h-9 w-28" />
                  ) : (
                    <span className="font-display text-2xl font-semibold tracking-tight text-gradient-sheen sm:text-3xl">
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
