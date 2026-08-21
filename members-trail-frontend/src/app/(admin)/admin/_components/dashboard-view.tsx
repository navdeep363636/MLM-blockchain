"use client";

/* AD-01 · Admin dashboard — KPI row, revenue trend, and the compliance panel
 * that the whole platform is judged on. */

import Link from "next/link";
import {
  Activity, AlertTriangle, ArrowUpRight, BadgeCheck, Coins, Download, FileSpreadsheet,
  Landmark, Lock, ShieldAlert, ShieldCheck, Sparkles, Ticket as TicketIcon, TrendingUp, Users,
} from "lucide-react";
import { AreaTrend, LineSeries } from "@/components/charts";
import { Badge, Button, Callout, InfoHint, ProgressBar, SkeletonCard, StatTile } from "@/components/ui";
import { Reveal } from "@/components/fx";
import {
  useAdminKpis, useFraudAlerts, useKycQueue, usePayoutVsInflow, useRevenueByStream,
  useStakingTvlTrend, useTreasuryTotals,
} from "@/lib/hooks/use-data";
import { csvDownload, formatCompact, formatNumber, formatPercent } from "@/lib/utils";
import { MiniStat, Panel } from "./panel";
import { THRESHOLD_VAR, ThresholdGauge, thresholdTone } from "./threshold-gauge";

const REVENUE_SERIES = [
  { key: "iap", label: "In-app purchases" },
  { key: "tournament", label: "Tournament fees" },
  { key: "marketplace", label: "Marketplace fees" },
  { key: "advertising", label: "Advertising" },
  { key: "subscription", label: "Subscriptions" },
];

/* ------------------------- PageHeader action cluster ---------------------- */

export function DashboardActions() {
  const { data: kpis } = useAdminKpis();
  const { data: revenue } = useRevenueByStream();
  const { data: ratio } = usePayoutVsInflow();
  const { data: totals } = useTreasuryTotals();

  const exportExecutive = () => {
    csvDownload(
      "members-trail-executive-summary.csv",
      [
        { metric: "DAU", value: kpis.dau, unit: "users" },
        { metric: "MAU", value: kpis.mau, unit: "users" },
        { metric: "Points issued (30d)", value: kpis.pointsIssued30d, unit: "points" },
        { metric: "MTT circulating", value: kpis.mttCirculating, unit: "MTT" },
        { metric: "MTT staked", value: kpis.mttStaked, unit: "MTT" },
        { metric: "Treasury balance", value: kpis.treasuryBalanceMtt, unit: "MTT" },
        { metric: "Pending withdrawals", value: kpis.pendingWithdrawals, unit: "requests" },
        { metric: "Open KYC queue", value: kpis.openKycQueue, unit: "submissions" },
        { metric: "Open fraud alerts", value: kpis.openFraudAlerts, unit: "alerts" },
        { metric: "Commission payout ratio", value: kpis.commissionPayoutRatio, unit: "%" },
        { metric: "Staking payout ratio", value: kpis.stakingPayoutRatio, unit: "%" },
        { metric: "Real-revenue funded share", value: kpis.realRevenueFundedPct, unit: "%" },
        { metric: "Reconciled treasury inflow", value: totals.reconciledInflow, unit: "MTT" },
        { metric: "Treasury headroom", value: totals.headroom, unit: "MTT" },
        ...revenue.map((r) => ({
          metric: `Revenue ${r.month}`,
          value: r.iap + r.tournament + r.marketplace + r.advertising + r.subscription,
          unit: "USD",
        })),
        ...ratio.map((r) => ({ metric: `Payout ratio ${r.month}`, value: r.ratio, unit: "%" })),
      ],
    );
  };

  return (
    <>
      <Button variant="outline" size="sm" icon={<FileSpreadsheet className="size-4" />} onClick={exportExecutive}>
        Export executive report
      </Button>
      <Button href="/admin/treasury" size="sm" icon={<Landmark className="size-4" />}>
        Open Treasury
      </Button>
    </>
  );
}

/* --------------------------------- KPI row -------------------------------- */

function KpiRow() {
  const { data: k, isLoading } = useAdminKpis();
  const { data: kyc } = useKycQueue();
  const { data: alerts } = useFraudAlerts();

  if (isLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => <SkeletonCard key={i} />)}
      </div>
    );
  }

  const tiles: {
    label: string;
    value: number | string;
    suffix?: string;
    delta?: number;
    deltaLabel?: string;
    icon: React.ReactNode;
    href: string;
    cta: string;
    hint?: string;
  }[] = [
    {
      label: "Daily active users",
      value: k.dau,
      delta: k.dauDelta,
      deltaLabel: "vs. previous day",
      icon: <Activity />,
      href: "/admin/reports",
      cta: "Cohort retention",
    },
    {
      label: "Monthly active users",
      value: k.mau,
      delta: k.mauDelta,
      deltaLabel: "vs. previous month",
      icon: <Users />,
      href: "/admin/users",
      cta: "User management",
    },
    {
      label: "Points issued (30d)",
      value: formatCompact(k.pointsIssued30d),
      icon: <Sparkles />,
      href: "/admin/games",
      cta: "Points issuance rules",
      hint: "Points are an off-chain loyalty balance. Issuance is capped per game, per user, per day.",
    },
    {
      label: "MTT in circulation",
      value: formatCompact(k.mttCirculating),
      icon: <Coins />,
      href: "/admin/treasury",
      cta: "Treasury ledgers",
      hint: "Fixed 1,000,000,000 supply. There is no mint function — circulation only grows as allocation wallets release.",
    },
    {
      label: "MTT staked",
      value: formatCompact(k.mttStaked),
      icon: <Lock />,
      href: "/admin/staking",
      cta: "Staking pools",
      hint: "Staking yield is variable and recalculated from Treasury inflows. No fixed APR is ever published.",
    },
    {
      label: "Treasury balance",
      value: formatCompact(k.treasuryBalanceMtt),
      suffix: " MTT",
      icon: <Landmark />,
      href: "/admin/treasury",
      cta: "Inflow / outflow",
    },
    {
      label: "Pending withdrawals",
      value: k.pendingWithdrawals,
      deltaLabel: `${formatNumber(k.pendingWithdrawalsMtt)} MTT queued`,
      icon: <TrendingUp />,
      href: "/admin/treasury",
      cta: "Withdrawal queue",
    },
    {
      label: "Open KYC queue",
      value: kyc.filter((s) => s.status === "pending" || s.status === "more_info").length,
      deltaLabel: `${formatNumber(k.openKycQueue)} awaiting review platform-wide`,
      icon: <BadgeCheck />,
      href: "/admin/kyc",
      cta: "Review queue",
    },
    {
      label: "Open fraud alerts",
      value: alerts.filter((a) => a.status === "open" || a.status === "investigating").length,
      deltaLabel: `${alerts.filter((a) => a.severity === "critical").length} critical severity`,
      icon: <ShieldAlert />,
      href: "/admin/fraud",
      cta: "Alert queue",
    },
    {
      label: "Open support tickets",
      value: k.openTickets,
      icon: <TicketIcon />,
      href: "/admin/tickets",
      cta: "Agent workspace",
    },
  ];

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {tiles.map((t) => (
        <Link
          key={t.label}
          href={t.href}
          className="group block rounded-[var(--radius-card)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
        >
          <StatTile
            label={t.label}
            value={t.value}
            suffix={t.suffix}
            delta={t.delta}
            deltaLabel={t.deltaLabel}
            icon={t.icon}
            hint={t.hint}
            className="h-full"
            footer={
              <span className="inline-flex items-center gap-1 text-xs font-medium text-text-muted transition-colors group-hover:text-[var(--accent-hover)]">
                {t.cta}
                <ArrowUpRight className="size-3" />
              </span>
            }
          />
        </Link>
      ))}
    </div>
  );
}

/* ------------------------- The compliance centrepiece --------------------- */

function CompliancePanel() {
  const { data: series, isLoading } = usePayoutVsInflow();
  const { data: k } = useAdminKpis();
  const { data: totals } = useTreasuryTotals();

  const latest = series[series.length - 1];
  const ratio = latest?.ratio ?? 0;
  const tone = thresholdTone(ratio);
  const peak = series.reduce((m, r) => Math.max(m, r.ratio), 0);

  const chartData = series.map((r) => ({ ...r, ceiling: 100 }));

  return (
    <Panel
      tone={tone === "good" ? "default" : tone === "warning" ? "warning" : "critical"}
      icon={<ShieldCheck />}
      title={
        <span className="flex flex-wrap items-center gap-2">
          Commission payouts vs. Treasury inflow
          <Badge tone={tone === "good" ? "good" : tone === "warning" ? "warning" : "critical"} dot>
            {tone === "good" ? "Sustainable" : tone === "warning" ? "Watch" : "Escalate now"}
          </Badge>
        </span>
      }
      description="The single most important compliance KPI on the platform. Total commission and staking payouts, divided by reconciled Treasury inflow for the same period."
      action={
        <Button href="/admin/treasury" variant="outline" size="sm" iconRight={<ArrowUpRight className="size-4" />}>
          Treasury ledgers
        </Button>
      }
      footnote="Ratio is computed from reconciled inflows only. Unreconciled processor settlements are excluded until a Finance admin matches the batch — an unreconciled deposit can never justify a payout."
    >
      <div className="grid gap-6 lg:grid-cols-[minmax(0,20rem)_1fr] lg:items-start">
        <div className="space-y-4">
          <ThresholdGauge
            value={ratio}
            size="lg"
            label={`Payout ratio · ${latest?.month ?? "current period"}`}
            sublabel="Commission + staking outflow as a share of reconciled revenue inflow."
          />

          <div className="grid gap-3 sm:grid-cols-2">
            <MiniStat
              label="Commission share"
              value={`${formatPercent(k.commissionPayoutRatio, 1)}`}
              sub="of inflow"
              tone={thresholdTone(k.commissionPayoutRatio) === "good" ? "good" : "warning"}
            />
            <MiniStat
              label="Staking share"
              value={`${formatPercent(k.stakingPayoutRatio, 1)}`}
              sub="of inflow"
              tone={thresholdTone(k.stakingPayoutRatio) === "good" ? "good" : "warning"}
            />
            <MiniStat
              label="12-month peak"
              value={`${formatPercent(peak, 1)}`}
              sub={series.find((s) => s.ratio === peak)?.month}
              tone={thresholdTone(peak) === "good" ? "good" : "warning"}
            />
            <MiniStat
              label="Headroom"
              value={formatCompact(totals.headroom)}
              sub="reconciled inflow not yet paid out"
              tone="good"
            />
          </div>
        </div>

        <div className="space-y-4">
          {isLoading ? (
            <SkeletonCard />
          ) : (
            <LineSeries
              data={chartData}
              xKey="month"
              height={260}
              series={[
                { key: "ratio", label: "Payout / inflow ratio", color: THRESHOLD_VAR[tone] },
                { key: "ceiling", label: "Compliance ceiling (100%)", color: THRESHOLD_VAR.critical },
              ]}
              valueFormatter={(v) => `${v.toFixed(1)}%`}
              title="Ratio over the last 12 months"
              description="Amber from 75%, red from 90%. The ceiling line is the point at which payouts would consume every rupee of revenue."
            />
          )}

          <Callout tone={tone === "critical" ? "critical" : "warning"} title="What breaching 100% would mean" icon={<AlertTriangle />}>
            <p className="mt-1">
              Above 100% the platform would be paying members more than it earned — which means the
              excess could only come from other members&apos; deposits or from the 15% Treasury
              Reserve. That is the definition of a deposit-funded scheme and it is the failure mode
              this entire design exists to prevent. If the ratio crosses 90%, commission accrual is
              throttled by the monthly cap engine and Finance must publish a revised plan before any
              further payout batch is approved. Breaching 100% halts all outflow approvals
              automatically.
            </p>
          </Callout>
        </div>
      </div>
    </Panel>
  );
}

/* ------------------- Real revenue vs reserve funding split ---------------- */

function FundingSplit() {
  const { data: k } = useAdminKpis();
  const reserve = Number((100 - k.realRevenueFundedPct).toFixed(1));

  return (
    <Panel
      icon={<Landmark />}
      title="Payout funding source"
      description="Where reward and commission payouts actually came from this period."
      footnote="Target: 100% real-revenue funding within 12–18 months of launch. The 15% Treasury Reserve is a bootstrap backstop, not an operating subsidy."
    >
      <div className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <MiniStat
            label="Real revenue funded"
            value={formatPercent(k.realRevenueFundedPct, 1)}
            sub="from IAP, fees, ads and subscriptions"
            tone="good"
          />
          <MiniStat
            label="Reserve funded"
            value={formatPercent(reserve, 1)}
            sub="from the 15% Treasury Reserve bucket"
            tone={reserve > 20 ? "critical" : "warning"}
          />
        </div>

        <div className="space-y-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-text-muted">
              Progress to the 100% real-revenue target
              <InfoHint>
                Published on the public Tokenomics page for scrutiny. The reserve share must trend to
                zero; it may never become the ongoing funding source for staking rewards or referral
                commission.
              </InfoHint>
            </span>
            <span className="tnum text-xs font-semibold text-text-secondary">
              {formatPercent(k.realRevenueFundedPct, 1)} of 100%
            </span>
          </div>
          <ProgressBar value={k.realRevenueFundedPct} max={100} tone="good" height="h-2.5" />
        </div>

        <Callout tone="info" title="Reserve draw is disclosed, not hidden" icon={<ShieldCheck />}>
          <p className="mt-1">
            Every reserve-funded rupee is booked as a distinct Treasury outflow with its own
            reference, so the split above is reconstructable from the ledger rather than asserted.
            Members see the same percentage on the public Tokenomics page.
          </p>
        </Callout>
      </div>
    </Panel>
  );
}

/* --------------------------------- Trends -------------------------------- */

function Trends() {
  const { data: revenue, isLoading } = useRevenueByStream();
  const { data: tvl } = useStakingTvlTrend();
  const latest = tvl[tvl.length - 1];
  const first = tvl[0];
  const growth = first ? ((latest.tvl - first.tvl) / first.tvl) * 100 : 0;

  if (isLoading) {
    return (
      <div className="grid gap-4 xl:grid-cols-2">
        <SkeletonCard />
        <SkeletonCard />
      </div>
    );
  }

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <AreaTrend
        data={revenue}
        xKey="month"
        series={REVENUE_SERIES}
        stacked
        height={300}
        valueFormatter={(v) => `$${formatNumber(v)}`}
        title="Revenue by stream — 12 months"
        description="Gross platform revenue before the Treasury allocation split. Only these streams can fund a payout."
        footnote="Switch to the table view for exact monthly figures. Stacked totals are gross revenue, not Treasury allocation."
      />

      <div className="space-y-4">
        <AreaTrend
          data={tvl}
          xKey="month"
          series={[{ key: "tvl", label: "Total value locked (MTT)" }]}
          height={196}
          valueFormatter={(v) => `${formatNumber(v)} MTT`}
          title="Staking TVL trend"
          description="Total MTT locked across all pools."
          footnote="Rewards on this TVL are variable and recalculated from Treasury inflows — never a fixed APR."
        />
        <div className="grid gap-3 sm:grid-cols-3">
          <MiniStat label="Current TVL" value={`${formatCompact(latest.tvl)} MTT`} sub={latest.month} />
          <MiniStat label="Active stakers" value={formatNumber(latest.stakers)} sub="unique addresses" />
          <MiniStat label="12-month growth" value={formatPercent(growth, 1)} sub="TVL change" tone="good" />
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------- View --------------------------------- */

export function DashboardView() {
  return (
    <div className="space-y-8">
      <Reveal>
        <KpiRow />
      </Reveal>

      <Reveal delay={0.05}>
        <CompliancePanel />
      </Reveal>

      <Reveal delay={0.1}>
        <Trends />
      </Reveal>

      <Reveal delay={0.15}>
        <FundingSplit />
      </Reveal>

      <Callout tone="neutral" title="Every KPI here is a link, not a headline" icon={<Download />}>
        <p className="mt-1">
          Each card drills through to the page that owns the number, so an operations review can move
          from a figure to the underlying records in one click. The executive report export contains
          the same figures with the period stamped, for board and auditor distribution.
        </p>
      </Callout>
    </div>
  );
}
