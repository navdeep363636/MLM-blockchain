"use client";

import { useMemo, useState } from "react";
import {
  ArrowDownToLine, CheckCircle2, Coins, Download, ExternalLink, Gift, Landmark, TrendingUp,
} from "lucide-react";
import {
  Badge, Button, Callout, DataTable, DetailRow, PillTabs, SegmentedControl,
  StatTile, type Column,
} from "@/components/ui";
import { AreaTrend } from "@/components/charts";
import { TxModal } from "@/components/web3";
import { useBalances, useRewardHistory, useStakePositions, useStakingPools } from "@/lib/hooks/use-data";
import { useStakeActions } from "@/lib/hooks/use-web3";
import { CONTRACTS_CONFIGURED, MTT_SYMBOL, txUrl } from "@/lib/web3";
import { csvDownload, formatCurrency, formatDate, formatToken, shortenHash } from "@/lib/utils";
import type { RewardEntry } from "@/types";
import { RelativeTime, useReferenceNow } from "../../../_components/time";

type Range = "30d" | "90d" | "all";
const RANGE_DAYS: Record<Range, number> = { "30d": 30, "90d": 90, all: 100_000 };

export function RewardsView() {
  const { data: rewards, isLoading } = useRewardHistory();
  const { data: positions } = useStakePositions();
  const { data: pools } = useStakingPools();
  const { data: balances } = useBalances();
  const referenceNow = useReferenceNow();

  const { claimRewards, ...tx } = useStakeActions();
  const [range, setRange] = useState<Range>("90d");
  const [poolFilter, setPoolFilter] = useState("all");
  const [txOpen, setTxOpen] = useState(false);
  const [claimingPool, setClaimingPool] = useState<number | null>(null);

  const filtered = useMemo(() => {
    const cutoff = referenceNow - RANGE_DAYS[range] * 86_400_000;
    return rewards.filter(
      (r) => Date.parse(r.date) >= cutoff && (poolFilter === "all" || String(r.poolId) === poolFilter),
    );
  }, [rewards, range, poolFilter, referenceNow]);

  const totals = useMemo(() => {
    const claimed = rewards.filter((r) => r.claimed).reduce((s, r) => s + r.accrued, 0);
    const unclaimed = rewards.filter((r) => !r.claimed).reduce((s, r) => s + r.accrued, 0);
    return { claimed, unclaimed, lifetime: claimed + unclaimed };
  }, [rewards]);

  /* Rewards accrued per week, for the trend chart. */
  const trend = useMemo(() => {
    const buckets = new Map<string, number>();
    for (const r of rewards) {
      const d = new Date(r.date);
      const key = formatDate(new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * 86_400_000));
      buckets.set(key, (buckets.get(key) ?? 0) + r.accrued);
    }
    return Array.from(buckets.entries())
      .map(([week, accrued]) => ({ week, accrued: Number(accrued.toFixed(2)) }))
      .sort((a, b) => Date.parse(a.week) - Date.parse(b.week))
      .slice(-14);
  }, [rewards]);

  const claim = async (poolId: number) => {
    setClaimingPool(poolId);
    if (!CONTRACTS_CONFIGURED) {
      setTxOpen(true);
      return;
    }
    setTxOpen(true);
    await claimRewards(poolId);
  };

  const columns: Column<RewardEntry>[] = [
    {
      key: "date",
      header: "Date",
      cell: (r) => (
        <span className="whitespace-nowrap">
          <span className="tnum block text-text-primary">{formatDate(r.date)}</span>
          <span className="block text-xs text-text-muted"><RelativeTime date={r.date} /></span>
        </span>
      ),
      sortValue: (r) => r.date,
    },
    {
      key: "pool",
      header: "Pool",
      cell: (r) => <Badge tone="info">{r.poolName}</Badge>,
      sortValue: (r) => r.poolName,
    },
    {
      key: "accrued",
      header: `Accrued (${MTT_SYMBOL})`,
      align: "right",
      cell: (r) => <span className="tnum font-medium text-text-primary">{formatToken(r.accrued, 4)}</span>,
      sortValue: (r) => r.accrued,
    },
    {
      key: "value",
      header: "Value",
      align: "right",
      hideBelow: "lg",
      cell: (r) => <span className="tnum text-text-muted">{formatCurrency(r.accrued * balances.usdRate)}</span>,
      sortValue: (r) => r.accrued,
    },
    {
      key: "status",
      header: "Status",
      cell: (r) =>
        r.claimed
          ? <Badge tone="good" icon={<CheckCircle2 className="size-3" />}>Claimed</Badge>
          : <Badge tone="brand" dot>Unclaimed</Badge>,
      sortValue: (r) => (r.claimed ? 1 : 0),
    },
    {
      key: "proof",
      header: "Proof",
      align: "right",
      hideBelow: "md",
      cell: (r) =>
        r.txHash ? (
          <a
            href={txUrl(r.txHash)}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono-num inline-flex items-center gap-1 text-xs text-[var(--accent-hover)] hover:underline"
          >
            {shortenHash(r.txHash)}
            <ExternalLink className="size-3" />
          </a>
        ) : (
          <span className="text-xs text-text-muted">—</span>
        ),
    },
  ];

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          tone="brand"
          label="Available to claim"
          value={balances.mttPendingRewards}
          decimals={4}
          suffix={` ${MTT_SYMBOL}`}
          icon={<Gift />}
          deltaLabel={`≈ ${formatCurrency(balances.mttPendingRewards * balances.usdRate)}`}
        />
        <StatTile
          label="Claimed lifetime"
          value={totals.claimed}
          decimals={2}
          suffix={` ${MTT_SYMBOL}`}
          icon={<ArrowDownToLine />}
          deltaLabel={`Across ${rewards.filter((r) => r.claimed).length} claims`}
        />
        <StatTile
          label="Total accrued"
          value={totals.lifetime}
          decimals={2}
          suffix={` ${MTT_SYMBOL}`}
          icon={<TrendingUp />}
          deltaLabel="Claimed plus unclaimed"
        />
        <StatTile
          label="Currently staked"
          value={balances.mttStaked}
          decimals={2}
          suffix={` ${MTT_SYMBOL}`}
          icon={<Coins />}
          deltaLabel={`Across ${positions.length} position${positions.length === 1 ? "" : "s"}`}
        />
      </div>

      {/* Per-position claim */}
      <div className="mt-5 overflow-hidden rounded-[var(--radius-card)] border border-border-subtle bg-surface-1">
        <div className="border-b border-border-subtle px-5 py-4">
          <h2 className="text-sm font-semibold text-text-primary">Claim by position</h2>
          <p className="mt-0.5 text-xs text-text-muted">
            Each pool is claimed separately — one transaction per pool, so you only pay gas where
            there&apos;s something worth collecting.
          </p>
        </div>
        <ul className="divide-y divide-border-subtle">
          {positions.map((p) => {
            const pool = pools.find((x) => x.poolId === p.poolId);
            return (
              <li key={p.poolId} className="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-text-primary">{pool?.name ?? `Pool ${p.poolId}`}</p>
                  <p className="tnum mt-0.5 text-xs text-text-muted">
                    {formatToken(p.amount)} {MTT_SYMBOL} staked · {pool ? `${pool.currentApr.toFixed(2)}% variable` : "—"}
                  </p>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <p className="tnum text-sm font-semibold text-[var(--accent-hover)]">
                      {formatToken(p.pendingRewards, 4)} {MTT_SYMBOL}
                    </p>
                    <p className="text-xs text-text-muted">
                      ≈ {formatCurrency(p.pendingRewards * balances.usdRate)}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    disabled={p.pendingRewards <= 0}
                    onClick={() => claim(p.poolId)}
                    icon={<ArrowDownToLine className="size-3.5" />}
                  >
                    Claim
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      <AreaTrend
        className="mt-5"
        data={trend}
        xKey="week"
        series={[{ key: "accrued", label: `Rewards accrued (${MTT_SYMBOL})` }]}
        title="Reward accrual by week"
        description="How much your positions earned each week. Movement reflects Treasury inflows and total value staked — not a schedule."
        valueFormatter={(v) => `${formatToken(v, 2)} ${MTT_SYMBOL}`}
        height={220}
        footnote="Accrual, not claims. A flat or falling week means less revenue was allocated, or more MTT was staked against the same pool."
      />

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <SegmentedControl
          value={range}
          onValueChange={setRange}
          size="sm"
          options={[
            { value: "30d", label: "30 days" },
            { value: "90d", label: "90 days" },
            { value: "all", label: "All time" },
          ]}
        />
        <PillTabs
          value={poolFilter}
          onValueChange={setPoolFilter}
          items={[
            { value: "all", label: "All pools", count: rewards.length },
            ...pools.map((p) => ({
              value: String(p.poolId),
              label: p.name,
              count: rewards.filter((r) => r.poolId === p.poolId).length,
            })),
          ]}
        />
        <Button
          size="sm"
          variant="outline"
          className="sm:ml-auto"
          disabled={!filtered.length}
          icon={<Download className="size-3.5" />}
          onClick={() =>
            csvDownload(
              `members-trail-rewards-${range}.csv`,
              filtered.map((r) => ({
                reference: r.id,
                date: r.date,
                pool: r.poolName,
                accrued_mtt: r.accrued,
                claimed: r.claimed ? "yes" : "no",
                tx_hash: r.txHash ?? "",
              })),
            )
          }
        >
          Export CSV
        </Button>
      </div>

      <div className="mt-4 overflow-hidden rounded-[var(--radius-card)] border border-border-subtle bg-surface-1">
        <DataTable
          columns={columns}
          rows={filtered}
          keyOf={(r) => r.id}
          loading={isLoading}
          pageSize={12}
          caption="Staking reward accrual and claim history by pool"
          empty={{
            title: "No reward entries in this window",
            description: "Rewards begin accruing from the block your stake confirms.",
            action: <Button size="sm" href="/app/staking">View pools</Button>,
          }}
        />
      </div>

      <Callout tone="info" title="Every reward traces to a Treasury deposit" icon={<Landmark />} className="mt-6">
        <p className="mt-1">
          A pool&apos;s reward balance can only grow when the Treasury multisig calls{" "}
          <code className="rounded bg-surface-3 px-1 font-mono text-[11px]">fundRewardPool()</code> with
          MTT reconciled against real platform revenue. The contract tracks rewards funded against
          rewards paid, and the second can never exceed the first — so a claim you make here is
          always backed by money the platform actually earned.
        </p>
      </Callout>

      <TxModal
        open={txOpen}
        onClose={() => setTxOpen(false)}
        state={CONTRACTS_CONFIGURED ? tx : { phase: "success", reset: () => {} }}
        title="Claim staking rewards"
        successMessage={
          CONTRACTS_CONFIGURED
            ? "Rewards transferred to your wallet."
            : "Recorded against the demo ledger — no contract addresses are configured."
        }
        summary={
          claimingPool != null ? (
            <>
              <DetailRow label="Pool" value={pools.find((p) => p.poolId === claimingPool)?.name ?? `Pool ${claimingPool}`} />
              <DetailRow
                label="Amount"
                value={`${formatToken(positions.find((p) => p.poolId === claimingPool)?.pendingRewards ?? 0, 4)} ${MTT_SYMBOL}`}
              />
            </>
          ) : undefined
        }
      />
    </>
  );
}
