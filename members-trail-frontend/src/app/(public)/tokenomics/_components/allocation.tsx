"use client";

import { Coins, Lock } from "lucide-react";
import { DonutBreakdown, seriesColor } from "@/components/charts";
import { Badge, DataTable, type Column } from "@/components/ui";
import { useTokenStats } from "@/lib/hooks/use-web3";
import { formatCompact, formatNumber } from "@/lib/utils";

/** FRD 8.2 — the six allocation buckets. Fixed at deployment, no minting. */
const TOTAL_SUPPLY = 1_000_000_000;

interface Bucket {
  name: string;
  pct: number;
  vesting: string;
  purpose: string;
}

const BUCKETS: Bucket[] = [
  { name: "Play-to-Earn Rewards Pool", pct: 40, vesting: "Released programmatically over 4 years", purpose: "Funds Points→MTT conversions and staking reward claims." },
  { name: "Revenue Treasury Reserve", pct: 15, vesting: "Locked 12 months, then linear over 24", purpose: "Bootstrap backstop only — not the ongoing funding source." },
  { name: "Team & Founders", pct: 15, vesting: "12-month cliff, then linear over 24 months", purpose: "On-chain vesting contract, not a time-locked transfer." },
  { name: "Liquidity (DEX pools)", pct: 15, vesting: "LP locked minimum 12 months post-listing", purpose: "Market depth for MTT trading pairs." },
  { name: "Marketing & Partnerships", pct: 10, vesting: "Linear release over 24 months", purpose: "Growth, campaigns and partner integrations." },
  { name: "Advisors", pct: 5, vesting: "6-month cliff, then linear over 18 months", purpose: "On-chain vesting contract per beneficiary." },
];

export function AllocationChart() {
  const { totalSupply, symbol, paused, onChain } = useTokenStats();
  const supply = totalSupply ?? TOTAL_SUPPLY;

  const data = BUCKETS.map((b, i) => ({
    name: b.name,
    value: (supply * b.pct) / 100,
    color: seriesColor(i),
  }));

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,26rem)_1fr] lg:items-start">
      <div>
        <DonutBreakdown
          data={data}
          title="Supply allocation"
          description={onChain ? "Live from the MTT contract" : "Per FRD Section 8.2"}
          innerValue={formatCompact(supply)}
          innerLabel={`${symbol ?? "MTT"} total supply`}
          valueFormatter={(v) => `${formatCompact(v)} MTT`}
          height={300}
          footnote="Slots are assigned in a fixed, colourblind-validated order. Switch to the table view for exact figures."
        />
        {onChain && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Badge tone="good" dot>Reading live contract state</Badge>
            {paused ? <Badge tone="critical">Transfers paused</Badge> : <Badge tone="neutral">Transfers active</Badge>}
          </div>
        )}
      </div>

      <div className="overflow-hidden rounded-[var(--radius-card)] border border-border-subtle bg-surface-1">
        <div className="border-b border-border-subtle px-5 py-4">
          <h3 className="text-sm font-semibold text-text-primary">Buckets and vesting</h3>
          <p className="mt-0.5 text-xs text-text-muted">
            Minted once at deployment to designated allocation wallets. There is no mint function in production.
          </p>
        </div>
        <ul className="divide-y divide-border-subtle">
          {BUCKETS.map((b, i) => (
            <li key={b.name} className="flex gap-3.5 px-5 py-4">
              <span className="mt-1.5 size-2.5 shrink-0 rounded-[3px]" style={{ background: seriesColor(i) }} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <p className="text-sm font-medium text-text-primary">{b.name}</p>
                  <p className="tnum text-sm font-semibold text-text-primary">
                    {b.pct}%
                    <span className="ml-2 font-normal text-text-muted">
                      {formatNumber((supply * b.pct) / 100)} MTT
                    </span>
                  </p>
                </div>
                <p className="mt-1 text-xs leading-relaxed text-text-muted">{b.purpose}</p>
                <p className="mt-1.5 inline-flex items-center gap-1.5 text-[11px] font-medium text-text-secondary">
                  <Lock className="size-3 text-[var(--accent)]" />
                  {b.vesting}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/* ------------------------- public conversion history --------------------- */

interface RateRow {
  pointsPerMtt: number;
  effectiveFrom: string;
  status: string;
  approvedBy?: string;
}

export function RateHistory({ rows }: { rows: RateRow[] }) {
  const columns: Column<RateRow>[] = [
    {
      key: "rate",
      header: "Rate",
      cell: (r) => (
        <span className="tnum font-medium text-text-primary">
          {formatNumber(r.pointsPerMtt)} Points = 1 MTT
        </span>
      ),
      sortValue: (r) => r.pointsPerMtt,
    },
    {
      key: "from",
      header: "Effective from",
      cell: (r) => (
        <span className="tnum text-text-secondary">
          {new Date(r.effectiveFrom).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
        </span>
      ),
      sortValue: (r) => r.effectiveFrom,
    },
    {
      key: "status",
      header: "Status",
      cell: (r) =>
        r.status === "active" ? <Badge tone="good" dot>Active</Badge>
        : r.status === "pending_approval" ? <Badge tone="warning" dot>Awaiting second approval</Badge>
        : r.status === "scheduled" ? <Badge tone="info" dot>Scheduled</Badge>
        : <Badge tone="neutral">Superseded</Badge>,
    },
    {
      key: "approver",
      header: "Second approver",
      hideBelow: "md",
      cell: (r) => <span className="text-text-muted">{r.approvedBy ?? "—"}</span>,
    },
  ];

  return (
    <div className="overflow-hidden rounded-[var(--radius-card)] border border-border-subtle bg-surface-1">
      <div className="flex items-start gap-3 border-b border-border-subtle px-5 py-4">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-accent-soft text-[var(--accent)]">
          <Coins className="size-4" />
        </span>
        <div>
          <h3 className="text-sm font-semibold text-text-primary">Conversion rate history</h3>
          <p className="mt-0.5 text-xs text-text-muted">
            Every change requires a Finance proposal plus a second admin&apos;s approval, and is retained permanently.
          </p>
        </div>
      </div>
      <DataTable
        columns={columns}
        rows={rows}
        keyOf={(r) => r.effectiveFrom}
        caption="History of Points-to-MTT conversion rates"
        dense
      />
    </div>
  );
}
