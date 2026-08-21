"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle, ArrowRight, Coins, Info, Landmark, Lock, ShieldCheck, TrendingUp, Unlock,
} from "lucide-react";
import {
  Badge, Button, Callout, DetailRow, InfoHint, Modal, ProgressBar, StatTile,
} from "@/components/ui";
import { LineSeries } from "@/components/charts";
import { RevealGroup, RevealItem, SpotlightCard } from "@/components/fx";
import { useBalances, useStakePositions, useStakingPools } from "@/lib/hooks/use-data";
import { useOnChainPools, usePoolCount } from "@/lib/hooks/use-web3";
import { MTT_SYMBOL, CONTRACTS_CONFIGURED } from "@/lib/web3";
import { cn, daysLabel, formatCompact, formatPercent, formatToken } from "@/lib/utils";
import type { StakingPool } from "@/types";
import { blendedApr } from "../../_components/derive";
import { Countdown } from "../../_components/time";

export function PoolsView() {
  const { data: pools, isLoading } = useStakingPools();
  const { data: positions } = useStakePositions();
  const { data: balances } = useBalances();
  const { count } = usePoolCount();
  const { pools: onChainPools } = useOnChainPools(count);

  const [aprHistory, setAprHistory] = useState<StakingPool | null>(null);

  const positionByPool = useMemo(
    () => new Map(positions.map((p) => [p.poolId, p])),
    [positions],
  );

  /* Prefer live contract state for the figures the contract owns. */
  const merged = useMemo(
    () =>
      pools.map((p) => {
        const chain = onChainPools?.find((c) => c.poolId === p.poolId);
        return chain
          ? {
              ...p,
              active: chain.active,
              totalStaked: chain.totalStaked,
              totalRewardsFunded: chain.totalRewardsFunded,
              totalRewardsPaid: chain.totalRewardsPaid,
              earlyPenaltyBps: chain.earlyUnstakePenaltyBps,
              lockDays: Math.round(chain.lockDuration / 86_400),
            }
          : p;
      }),
    [pools, onChainPools],
  );

  const tvl = merged.reduce((s, p) => s + p.totalStaked, 0);
  const myApr = blendedApr(positions, pools);
  const totalFunded = merged.reduce((s, p) => s + p.totalRewardsFunded, 0);
  const totalPaid = merged.reduce((s, p) => s + p.totalRewardsPaid, 0);

  return (
    <>
      <Callout tone="warning" title="APR here is variable and never guaranteed" icon={<AlertTriangle />} className="mb-5">
        <p className="mt-1">
          Each pool&apos;s rate is <strong className="text-text-primary">recalculated every period
          from actual Revenue Treasury inflows</strong> — it is not a fixed or promised return, and it
          can fall as well as rise. A pool&apos;s reward balance can only grow when the Treasury
          multisig calls <code className="rounded bg-surface-3 px-1 font-mono text-[11px]">fundRewardPool()</code>,
          which means rewards are funded by real platform revenue rather than by other stakers&apos;
          principal. Read the{" "}
          <Link href="/legal/risk-disclosure">Risk Disclosure</Link> before staking.
        </p>
      </Callout>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Your staked total"
          value={balances.mttStaked}
          decimals={2}
          suffix={` ${MTT_SYMBOL}`}
          icon={<Coins />}
          tone="brand"
          deltaLabel={`Across ${positions.length} position${positions.length === 1 ? "" : "s"}`}
        />
        <StatTile
          label="Your blended rate"
          value={myApr}
          decimals={2}
          suffix="%"
          icon={<TrendingUp />}
          hint="Weighted by how much you have in each pool. Variable — recalculated each period from Treasury inflows."
          deltaLabel="Weighted across your positions"
        />
        <StatTile
          label="Pending rewards"
          value={balances.mttPendingRewards}
          decimals={2}
          suffix={` ${MTT_SYMBOL}`}
          icon={<Landmark />}
          deltaLabel="Accrued, unclaimed"
          footer={
            <Button href="/app/staking/rewards" size="xs" variant="ghost" fullWidth>
              Claim rewards
            </Button>
          }
        />
        <StatTile
          label="Platform TVL"
          value={tvl}
          compact
          icon={<ShieldCheck />}
          deltaLabel={`${formatCompact(totalPaid)} of ${formatCompact(totalFunded)} ${MTT_SYMBOL} funded rewards paid`}
          hint="Total value staked across all pools. Rewards paid can never exceed rewards funded — asserted on-chain."
        />
      </div>

      <RevealGroup className="mt-6 grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
        {(isLoading ? [] : merged).map((p) => {
          const mine = positionByPool.get(p.poolId);
          const utilisation = p.totalRewardsFunded > 0 ? (p.totalRewardsPaid / p.totalRewardsFunded) * 100 : 0;
          return (
            <RevealItem key={p.poolId}>
              <SpotlightCard
                className={cn(
                  "flex h-full flex-col rounded-[var(--radius-card)] border bg-surface-1 p-5",
                  mine ? "border-[var(--accent-ring)]" : "border-border-subtle",
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <span
                      className={cn(
                        "grid size-9 place-items-center rounded-xl",
                        p.lockDays === 0 ? "bg-surface-3 text-text-secondary" : "bg-accent-soft text-[var(--accent)]",
                      )}
                    >
                      {p.lockDays === 0 ? <Unlock className="size-4" /> : <Lock className="size-4" />}
                    </span>
                    <div>
                      <h3 className="font-display text-base font-semibold text-text-primary">{p.name}</h3>
                      <p className="text-xs text-text-muted">{daysLabel(p.lockDays)}</p>
                    </div>
                  </div>
                  {mine && <Badge tone="brand" dot>Staked</Badge>}
                </div>

                <div className="mt-4 rounded-xl border border-border-subtle bg-surface-inset p-3.5">
                  <p className="flex items-center gap-1 text-xs text-text-muted">
                    Current rate
                    <InfoHint>
                      Reward-pool inflow for the period, divided by total value staked, annualised.
                      Variable by design — never advertised as fixed or guaranteed.
                    </InfoHint>
                  </p>
                  <p className="tnum mt-0.5 font-display text-2xl font-semibold tracking-tight text-text-primary">
                    {formatPercent(p.currentApr)}
                    <span className="ml-1.5 text-xs font-medium text-text-muted">variable</span>
                  </p>
                </div>

                <dl className="mt-4 space-y-1 text-xs">
                  <div className="flex justify-between gap-2">
                    <dt className="text-text-muted">Total staked</dt>
                    <dd className="tnum text-text-secondary">{formatCompact(p.totalStaked)} {MTT_SYMBOL}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-text-muted">Early-exit penalty</dt>
                    <dd className="tnum text-text-secondary">
                      {p.earlyPenaltyBps / 100}%
                      <span className="text-text-muted"> of rewards</span>
                    </dd>
                  </div>
                  {mine && (
                    <>
                      <div className="flex justify-between gap-2">
                        <dt className="text-text-muted">Your stake</dt>
                        <dd className="tnum font-medium text-text-primary">{formatToken(mine.amount)}</dd>
                      </div>
                      <div className="flex justify-between gap-2">
                        <dt className="text-text-muted">Unlocks</dt>
                        <dd className="tnum text-text-secondary">
                          {p.lockDays === 0 ? "Anytime" : <Countdown to={mine.lockEnd} elapsedLabel="Unlocked" />}
                        </dd>
                      </div>
                    </>
                  )}
                </dl>

                <div className="mt-3">
                  <ProgressBar
                    value={utilisation}
                    max={100}
                    tone={utilisation > 90 ? "warning" : "good"}
                    label="Funded rewards distributed"
                    showLabel
                    height="h-1"
                  />
                </div>

                <div className="mt-4 flex flex-col gap-2 pt-1">
                  <Button
                    href={`/app/staking/manage?pool=${p.poolId}`}
                    size="sm"
                    fullWidth
                    disabled={!p.active}
                    iconRight={<ArrowRight className="size-3.5" />}
                  >
                    {mine ? "Manage" : p.active ? "Stake here" : "Inactive"}
                  </Button>
                  <Button size="xs" variant="ghost" fullWidth onClick={() => setAprHistory(p)}>
                    Rate history
                  </Button>
                </div>
              </SpotlightCard>
            </RevealItem>
          );
        })}
      </RevealGroup>

      {!CONTRACTS_CONFIGURED && (
        <p className="mt-4 text-xs text-text-muted">
          Pool figures shown from the demo ledger. With contract addresses configured, totals,
          penalties and lock periods are read directly from the staking contract.
        </p>
      )}

      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        <div className="rounded-[var(--radius-card)] border border-border-subtle bg-surface-1 p-5">
          <div className="flex items-center gap-3">
            <span className="grid size-9 place-items-center rounded-xl bg-accent-soft text-[var(--accent)]">
              <ShieldCheck className="size-4" />
            </span>
            <h3 className="text-sm font-semibold text-text-primary">What the contract guarantees</h3>
          </div>
          <ul className="mt-4 space-y-3">
            {[
              ["Your principal is never confiscated", "unstake() returns your full principal. The early-exit penalty applies only to pending, unclaimed rewards."],
              ["No admin escape hatch", "There is no withdraw or emergencyWithdraw function. No administrator call can move your stake."],
              ["Rewards can't exceed what was funded", "The contract tracks rewards funded versus rewards paid, and the second can never exceed the first."],
              ["Treasury-only funding", "fundRewardPool() is gated on the TREASURY_ROLE held by a multisig. Stakers' principal is never reward budget."],
            ].map(([t, d]) => (
              <li key={t} className="flex gap-2.5">
                <ShieldCheck className="mt-0.5 size-4 shrink-0 text-good-400" />
                <p className="text-sm leading-relaxed text-text-secondary">
                  <span className="font-medium text-text-primary">{t}.</span> {d}
                </p>
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-[var(--radius-card)] border border-border-subtle bg-surface-1 p-5">
          <div className="flex items-center gap-3">
            <span className="grid size-9 place-items-center rounded-xl bg-accent-soft text-[var(--accent)]">
              <Landmark className="size-4" />
            </span>
            <h3 className="text-sm font-semibold text-text-primary">How the rate is derived</h3>
          </div>
          <p className="mt-3 text-sm leading-relaxed text-text-muted">
            For any period, a pool&apos;s rate is the reward-pool inflow for that period divided by the
            total value staked in that pool, annualised. Both inputs move: if revenue rises the rate
            rises, and if more people stake the same funded pool each staker&apos;s share falls. That is
            arithmetic, not policy.
          </p>
          <div className="mt-4 rounded-xl border border-border-subtle bg-surface-inset p-3.5">
            <code className="block text-xs leading-relaxed text-text-secondary">
              APR = (inflow(period) / TVL(pool, period)) × (365 / period_days) × 100
            </code>
          </div>
          <p className="mt-3 text-xs leading-relaxed text-text-muted">
            Longer locks may carry a modestly higher rate to reward commitment — but no pool&apos;s rate
            is fixed, and none is guaranteed.
          </p>
        </div>
      </div>

      <Modal
        open={!!aprHistory}
        onClose={() => setAprHistory(null)}
        title={`${aprHistory?.name} — historical rate`}
        description="Past periods only. Past rates are not indicative of future rates."
        icon={<TrendingUp className="size-5" />}
        size="lg"
        footer={<Button variant="ghost" onClick={() => setAprHistory(null)}>Close</Button>}
      >
        {aprHistory && (
          <div className="space-y-4">
            <LineSeries
              data={aprHistory.aprHistory}
              xKey="period"
              series={[{ key: "apr", label: `${aprHistory.name} rate` }]}
              valueFormatter={(v) => `${v.toFixed(2)}%`}
              height={240}
              title="Realised rate by period"
              description="Derived from actual Treasury inflows in each period."
              footnote="Switch to the table view for exact figures. Rates are historical and not a forecast."
            />
            <div className="rounded-xl border border-border-subtle bg-surface-inset px-4 py-1">
              <DetailRow label="Lock period" value={daysLabel(aprHistory.lockDays)} />
              <DetailRow label="Reward stream duration" value={`${aprHistory.rewardsDurationDays} days`} />
              <DetailRow label="Early-exit penalty" value={`${aprHistory.earlyPenaltyBps / 100}% of unclaimed rewards`} />
              <DetailRow label="Rewards funded to date" value={`${formatToken(aprHistory.totalRewardsFunded)} ${MTT_SYMBOL}`} />
              <DetailRow label="Rewards paid to date" value={`${formatToken(aprHistory.totalRewardsPaid)} ${MTT_SYMBOL}`} />
            </div>
            <Callout tone="info" title="Why it moves" icon={<Info />}>
              <p className="mt-1">
                Every point on this chart is a realised outcome, not a projection. The rate fell in
                periods where more MTT was staked against a similar inflow, and rose where revenue
                grew faster than the staked total.
              </p>
            </Callout>
          </div>
        )}
      </Modal>
    </>
  );
}
