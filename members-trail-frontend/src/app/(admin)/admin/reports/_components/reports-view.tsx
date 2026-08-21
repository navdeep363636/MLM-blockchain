"use client";

/* AD-10 · Reports & analytics — the five standing templates finance,
 * compliance and growth actually ask for, plus a custom builder. */

import { useMemo, useState } from "react";
import {
  BarChart3, CalendarClock, CheckCircle2, Download, FileSpreadsheet, Filter, Landmark,
  LineChart as LineIcon, Mail, PieChart, Share2, ShieldCheck, Sparkles, Users,
} from "lucide-react";
import { AreaTrend, BarSeries, LineSeries } from "@/components/charts";
import {
  Badge, Button, Callout, Checkbox, DetailRow, Input, Modal, Select, useToast,
} from "@/components/ui";
import {
  useCohortRetention, useKycFunnel, usePayoutVsInflow, useRevenueByStream, useStakingTvlTrend,
} from "@/lib/hooks/use-data";
import { csvDownload, formatNumber, formatPercent } from "@/lib/utils";
import { MTT_SYMBOL } from "@/lib/web3";
import { MiniStat, Panel } from "../../_components/panel";
import { THRESHOLD_VAR, thresholdTone } from "../../_components/threshold-gauge";

type TemplateId = "revenue" | "payout" | "kyc" | "cohort" | "tvl";

const TEMPLATES: { id: TemplateId; title: string; audience: string; blurb: string; Icon: typeof BarChart3 }[] = [
  {
    id: "revenue",
    title: "Revenue by stream",
    audience: "Finance",
    blurb: "Gross revenue split across in-app purchases, tournament fees, marketplace fees, advertising and subscriptions.",
    Icon: BarChart3,
  },
  {
    id: "payout",
    title: "Commission payout ratio",
    audience: "Compliance",
    blurb: "Commission and staking payouts as a share of reconciled Treasury inflow, against the 100% ceiling.",
    Icon: ShieldCheck,
  },
  {
    id: "kyc",
    title: "KYC funnel",
    audience: "Compliance",
    blurb: "Registration through to Tier 2 approval, with the drop-off at each verification stage.",
    Icon: Filter,
  },
  {
    id: "cohort",
    title: "Cohort retention",
    audience: "Growth",
    blurb: "Day 1, day 7 and day 30 retention by joining cohort.",
    Icon: Users,
  },
  {
    id: "tvl",
    title: "Staking TVL trend",
    audience: "Finance",
    blurb: "Total MTT locked across all pools and the number of unique stakers behind it.",
    Icon: Landmark,
  },
];

const METRICS = [
  { key: "revenue", label: "Gross revenue" },
  { key: "treasury_inflow", label: "Treasury inflow (reconciled)" },
  { key: "commission_paid", label: "Commission paid" },
  { key: "staking_rewards", label: "Staking rewards paid" },
  { key: "points_issued", label: "Points issued" },
  { key: "points_converted", label: "Points converted" },
  { key: "dau", label: "Daily active users" },
  { key: "kyc_approvals", label: "KYC approvals" },
  { key: "withdrawals", label: "Withdrawal volume" },
  { key: "payout_ratio", label: "Payout / inflow ratio" },
];

const DIMENSIONS = [
  { value: "month", label: "Month" },
  { value: "week", label: "Week" },
  { value: "day", label: "Day" },
  { value: "revenue_stream", label: "Revenue stream" },
  { value: "country", label: "Country" },
  { value: "kyc_tier", label: "KYC tier" },
  { value: "staking_pool", label: "Staking pool" },
  { value: "referral_level", label: "Referral level" },
];

/* ------------------------------ header actions --------------------------- */

export function ReportsActions() {
  const { data: revenue } = useRevenueByStream();
  return (
    <Button
      variant="outline"
      size="sm"
      icon={<FileSpreadsheet className="size-4" />}
      onClick={() =>
        csvDownload(
          "members-trail-revenue-by-stream.csv",
          revenue.map((r) => ({
            month: r.month,
            iap: r.iap,
            tournament: r.tournament,
            marketplace: r.marketplace,
            advertising: r.advertising,
            subscription: r.subscription,
            total: r.iap + r.tournament + r.marketplace + r.advertising + r.subscription,
          })),
        )
      }
    >
      Quick export: revenue
    </Button>
  );
}

/* ------------------------------ template chart --------------------------- */

function TemplateChart({ id }: { id: TemplateId }) {
  const { data: revenue } = useRevenueByStream();
  const { data: payout } = usePayoutVsInflow();
  const { data: funnel } = useKycFunnel();
  const { data: cohort } = useCohortRetention();
  const { data: tvl } = useStakingTvlTrend();

  const ratioData = useMemo(() => payout.map((p) => ({ ...p, ceiling: 100 })), [payout]);
  const latestRatio = payout[payout.length - 1]?.ratio ?? 0;
  const tone = thresholdTone(latestRatio);

  const funnelData = useMemo(() => {
    const top = funnel[0]?.count ?? 1;
    return funnel.map((f) => ({ stage: f.stage, count: f.count, share: Number(((f.count / top) * 100).toFixed(1)) }));
  }, [funnel]);

  switch (id) {
    case "revenue":
      return (
        <AreaTrend
          data={revenue}
          xKey="month"
          stacked
          height={340}
          series={[
            { key: "iap", label: "In-app purchases" },
            { key: "tournament", label: "Tournament fees" },
            { key: "marketplace", label: "Marketplace fees" },
            { key: "advertising", label: "Advertising" },
            { key: "subscription", label: "Subscriptions" },
          ]}
          valueFormatter={(v) => `$${formatNumber(v)}`}
          title="Revenue by stream — trailing 12 months"
          description="Gross revenue before the Treasury allocation split. Only these streams can fund a payout."
          footnote="Advertising allocates 40% to the Treasury, in-app purchases 30%, marketplace 25% — so stream mix changes the funding capacity even at flat total revenue."
        />
      );
    case "payout":
      return (
        <LineSeries
          data={ratioData}
          xKey="month"
          height={340}
          series={[
            { key: "ratio", label: "Payout / inflow ratio", color: THRESHOLD_VAR[tone] },
            { key: "ceiling", label: "Compliance ceiling (100%)", color: THRESHOLD_VAR.critical },
          ]}
          valueFormatter={(v) => `${v.toFixed(1)}%`}
          title="Commission payout ratio vs Treasury inflow"
          description="The compliance KPI. Commission plus staking payouts over reconciled inflow, month by month."
          footnote="Amber from 75%, red from 90%. Sustained readings above 90% throttle commission accrual automatically; 100% halts outflow approvals."
        />
      );
    case "kyc":
      return (
        <BarSeries
          data={funnelData}
          xKey="stage"
          horizontal
          height={340}
          series={[{ key: "count", label: "Members reaching this stage" }]}
          valueFormatter={(v) => formatNumber(v)}
          title="KYC funnel"
          description="Ordinal stages, largest at the top. Each bar is the count that reached that stage, not the count that stopped there."
          footnote="Tier 1 unlocks withdrawals and commission release; Tier 2 is required above the enhanced-due-diligence threshold, which is why its bar is deliberately small."
        />
      );
    case "cohort":
      return (
        <BarSeries
          data={cohort}
          xKey="month"
          height={340}
          series={[
            { key: "d1", label: "Day 1 retention" },
            { key: "d7", label: "Day 7 retention" },
            { key: "d30", label: "Day 30 retention" },
          ]}
          valueFormatter={(v) => `${v}%`}
          title="Cohort retention"
          description="Share of each joining cohort still active after 1, 7 and 30 days."
          footnote="Grouped rather than stacked: the three windows are overlapping populations, so stacking them would imply a total that does not exist."
        />
      );
    case "tvl":
      return (
        <AreaTrend
          data={tvl}
          xKey="month"
          height={340}
          series={[{ key: "tvl", label: `Total value locked (${MTT_SYMBOL})` }]}
          valueFormatter={(v) => `${formatNumber(v)} ${MTT_SYMBOL}`}
          title="Staking TVL trend"
          description="Total MTT locked across every pool."
          footnote={`Behind the latest figure: ${formatNumber(tvl[tvl.length - 1]?.stakers ?? 0)} unique stakers. Rewards on this balance are variable and recalculated from Treasury inflows — never a fixed APR.`}
        />
      );
  }
}

function templateRows(
  id: TemplateId,
  data: {
    revenue: ReturnType<typeof useRevenueByStream>["data"];
    payout: ReturnType<typeof usePayoutVsInflow>["data"];
    funnel: ReturnType<typeof useKycFunnel>["data"];
    cohort: ReturnType<typeof useCohortRetention>["data"];
    tvl: ReturnType<typeof useStakingTvlTrend>["data"];
  },
): Record<string, unknown>[] {
  switch (id) {
    case "revenue":
      return data.revenue.map((r) => ({ ...r, total: r.iap + r.tournament + r.marketplace + r.advertising + r.subscription }));
    case "payout":
      return data.payout.map((p) => ({ ...p }));
    case "kyc":
      return data.funnel.map((f) => ({ ...f }));
    case "cohort":
      return data.cohort.map((c) => ({ ...c }));
    case "tvl":
      return data.tvl.map((t) => ({ ...t }));
  }
}

/* ---------------------------------- view --------------------------------- */

export function ReportsView() {
  const [template, setTemplate] = useState<TemplateId>("revenue");
  const [schedule, setSchedule] = useState(false);
  const [share, setShare] = useState(false);
  const toast = useToast();

  const revenue = useRevenueByStream();
  const payout = usePayoutVsInflow();
  const funnel = useKycFunnel();
  const cohort = useCohortRetention();
  const tvl = useStakingTvlTrend();

  /* custom builder state */
  const [metrics, setMetrics] = useState<string[]>(["revenue", "treasury_inflow", "payout_ratio"]);
  const [dimension, setDimension] = useState("month");
  const [secondary, setSecondary] = useState("revenue_stream");
  const [from, setFrom] = useState("2025-09-01");
  const [to, setTo] = useState("2026-08-31");
  const [format, setFormat] = useState("csv");
  const [frequency, setFrequency] = useState("monthly");
  const [recipients, setRecipients] = useState("finance@memberstrail.com, compliance@memberstrail.com");

  const active = TEMPLATES.find((t) => t.id === template)!;
  const rangeInvalid = from !== "" && to !== "" && new Date(from).getTime() > new Date(to).getTime();
  const builderReady = metrics.length > 0 && !rangeInvalid && from !== "" && to !== "";

  const latestRevenue = revenue.data[revenue.data.length - 1];
  const totalLatest = latestRevenue
    ? latestRevenue.iap + latestRevenue.tournament + latestRevenue.marketplace + latestRevenue.advertising + latestRevenue.subscription
    : 0;
  const latestRatio = payout.data[payout.data.length - 1]?.ratio ?? 0;
  const tier1 = funnel.data.find((f) => f.stage.includes("Tier 1"))?.count ?? 0;
  const registered = funnel.data[0]?.count ?? 1;

  const exportTemplate = () =>
    csvDownload(
      `members-trail-${template}-report.csv`,
      templateRows(template, {
        revenue: revenue.data,
        payout: payout.data,
        funnel: funnel.data,
        cohort: cohort.data,
        tvl: tvl.data,
      }),
    );

  const exportCustom = () => {
    const rows = revenue.data.map((r, i) => {
      const row: Record<string, unknown> = { period: r.month };
      if (metrics.includes("revenue")) row.gross_revenue = r.iap + r.tournament + r.marketplace + r.advertising + r.subscription;
      if (metrics.includes("treasury_inflow")) row.treasury_inflow = payout.data[i]?.inflow ?? 0;
      if (metrics.includes("commission_paid")) row.commission_paid = payout.data[i]?.commission ?? 0;
      if (metrics.includes("staking_rewards")) row.staking_rewards = payout.data[i]?.staking ?? 0;
      if (metrics.includes("payout_ratio")) row.payout_ratio_pct = payout.data[i]?.ratio ?? 0;
      if (metrics.includes("points_issued")) row.points_issued = Math.round((r.iap + r.tournament) * 4.2);
      if (metrics.includes("points_converted")) row.points_converted = Math.round((r.iap + r.tournament) * 2.6);
      if (metrics.includes("dau")) row.dau = Math.round(34_000 + i * 640);
      if (metrics.includes("kyc_approvals")) row.kyc_approvals = Math.round(11_400 + i * 380);
      if (metrics.includes("withdrawals")) row.withdrawal_volume = Math.round((payout.data[i]?.inflow ?? 0) * 0.36);
      if (metrics.includes("staking_rewards") || metrics.includes("revenue")) row.tvl = tvl.data[i]?.tvl ?? 0;
      row.primary_dimension = dimension;
      row.secondary_dimension = secondary;
      return row;
    });
    csvDownload("members-trail-custom-report.csv", rows);
  };

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MiniStat label="Latest month revenue" value={`$${formatNumber(totalLatest)}`} sub={latestRevenue?.month} />
        <MiniStat
          label="Payout ratio"
          value={formatPercent(latestRatio, 1)}
          sub="commission + staking vs inflow"
          tone={thresholdTone(latestRatio) === "good" ? "good" : "warning"}
        />
        <MiniStat
          label="KYC Tier 1 conversion"
          value={formatPercent((tier1 / registered) * 100, 1)}
          sub="of registered members"
        />
        <MiniStat
          label="Staking TVL"
          value={`${formatNumber(tvl.data[tvl.data.length - 1]?.tvl ?? 0)}`}
          sub={MTT_SYMBOL}
        />
      </div>

      {/* --------------------------- template picker ---------------------- */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,20rem)_1fr] lg:items-start">
        <Panel
          icon={<PieChart />}
          title="Report templates"
          description="Standing reports, each owned by the team that reads it."
          padded={false}
        >
          <ul className="divide-y divide-border-subtle">
            {TEMPLATES.map((t) => {
              const on = t.id === template;
              return (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => setTemplate(t.id)}
                    aria-pressed={on}
                    className={
                      on
                        ? "flex w-full items-start gap-3 bg-accent-soft px-4 py-3.5 text-left"
                        : "flex w-full items-start gap-3 px-4 py-3.5 text-left transition-colors hover:bg-surface-2"
                    }
                  >
                    <t.Icon className={on ? "mt-0.5 size-4 shrink-0 text-[var(--accent)]" : "mt-0.5 size-4 shrink-0 text-text-muted"} />
                    <span className="min-w-0">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className={on ? "text-sm font-semibold text-[var(--accent-hover)]" : "text-sm font-medium text-text-primary"}>
                          {t.title}
                        </span>
                        <Badge tone="neutral">{t.audience}</Badge>
                      </span>
                      <span className="mt-1 block text-xs leading-relaxed text-text-muted">{t.blurb}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </Panel>

        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-lg font-semibold tracking-tight text-text-primary">{active.title}</h2>
              <p className="mt-0.5 text-sm text-text-muted">Owned by {active.audience}. Switch to the table view inside the chart for exact figures.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" icon={<Download className="size-4" />} onClick={exportTemplate}>
                Export CSV
              </Button>
              <Button variant="outline" size="sm" icon={<CalendarClock className="size-4" />} onClick={() => setSchedule(true)}>
                Schedule
              </Button>
              <Button variant="ghost" size="sm" icon={<Share2 className="size-4" />} onClick={() => setShare(true)}>
                Share
              </Button>
            </div>
          </div>

          <TemplateChart id={template} />
        </div>
      </div>

      {/* ---------------------------- custom builder ---------------------- */}
      <Panel
        icon={<Sparkles />}
        title="Custom report builder"
        description="Pick metrics, dimensions and a date range. Generation runs against the warehouse, not the live transactional store."
        action={
          <>
            <Button
              variant="outline"
              size="sm"
              icon={<Download className="size-4" />}
              disabled={!builderReady}
              onClick={exportCustom}
            >
              Export {format.toUpperCase()}
            </Button>
            <Button
              size="sm"
              icon={<LineIcon className="size-4" />}
              disabled={!builderReady}
              onClick={() =>
                toast.success(
                  "Report queued",
                  `${metrics.length} metric${metrics.length > 1 ? "s" : ""} by ${dimension}, ${from} to ${to}. You will be emailed when it is ready.`,
                )
              }
            >
              Generate
            </Button>
          </>
        }
        footnote="Reports that include personally identifiable fields are watermarked with the requester's identity and expire after 7 days. Aggregate reports carry no PII and can be shared freely."
      >
        <div className="grid gap-6 lg:grid-cols-[1fr_minmax(0,22rem)]">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-text-muted">Metrics</p>
            <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
              {METRICS.map((m) => (
                <Checkbox
                  key={m.key}
                  checked={metrics.includes(m.key)}
                  onCheckedChange={() =>
                    setMetrics((cur) => (cur.includes(m.key) ? cur.filter((x) => x !== m.key) : [...cur, m.key]))
                  }
                  label={m.label}
                />
              ))}
            </div>
            {metrics.length === 0 && (
              <p className="mt-3 text-xs font-medium text-critical-400">Select at least one metric.</p>
            )}
          </div>

          <div className="space-y-4">
            <Select
              label="Primary dimension"
              value={dimension}
              onChange={(e) => setDimension(e.target.value)}
              options={DIMENSIONS}
              hint="Rows in the output."
            />
            <Select
              label="Secondary dimension"
              value={secondary}
              onChange={(e) => setSecondary(e.target.value)}
              options={[{ value: "none", label: "None" }, ...DIMENSIONS]}
              hint="Optional breakdown within each row."
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                label="From"
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="tnum"
              />
              <Input
                label="To"
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="tnum"
                error={rangeInvalid && "End date is before the start date."}
              />
            </div>
            <Select
              label="Output format"
              value={format}
              onChange={(e) => setFormat(e.target.value)}
              options={[
                { value: "csv", label: "CSV — machine readable" },
                { value: "pdf", label: "PDF — board pack" },
              ]}
            />
          </div>
        </div>
      </Panel>

      <Callout tone="info" title="Two reports the board should never stop reading" icon={<ShieldCheck />}>
        <p className="mt-1">
          Revenue by stream tells you whether the business works. The commission payout ratio tells you
          whether the rewards are affordable. Everything else on this page is context for those two —
          and if the second one ever crosses 100%, no growth figure elsewhere makes up for it.
        </p>
      </Callout>

      {/* ------------------------------ schedule -------------------------- */}
      <Modal
        open={schedule}
        onClose={() => setSchedule(false)}
        title={`Schedule: ${active.title}`}
        description="Recurring delivery to a fixed recipient list."
        icon={<CalendarClock className="size-5" />}
        footer={
          <>
            <Button variant="ghost" onClick={() => setSchedule(false)}>Cancel</Button>
            <Button
              onClick={() => {
                setSchedule(false);
                toast.success("Schedule saved", `${active.title} will be delivered ${frequency}.`);
              }}
            >
              Save schedule
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Select
            label="Frequency"
            value={frequency}
            onChange={(e) => setFrequency(e.target.value)}
            options={[
              { value: "daily", label: "Daily — 07:00 UTC" },
              { value: "weekly", label: "Weekly — Monday 07:00 UTC" },
              { value: "monthly", label: "Monthly — 1st, 07:00 UTC" },
              { value: "quarterly", label: "Quarterly — first business day" },
            ]}
          />
          <Input
            label="Recipients"
            value={recipients}
            onChange={(e) => setRecipients(e.target.value)}
            hint="Internal distribution lists only. External recipients need a Compliance sign-off."
          />
          <div className="rounded-xl border border-border-subtle bg-surface-inset px-4 py-1">
            <DetailRow label="Report" value={active.title} />
            <DetailRow label="Owner" value={active.audience} />
            <DetailRow label="Format" value={format.toUpperCase()} />
            <DetailRow label="Contains PII" value="No — aggregate only" />
          </div>
        </div>
      </Modal>

      {/* -------------------------------- share --------------------------- */}
      <Modal
        open={share}
        onClose={() => setShare(false)}
        title={`Share: ${active.title}`}
        description="Generates a signed, expiring link rather than an attachment."
        icon={<Share2 className="size-5" />}
        footer={
          <>
            <Button variant="ghost" onClick={() => setShare(false)}>Cancel</Button>
            <Button
              icon={<Mail className="size-4" />}
              onClick={() => {
                setShare(false);
                toast.success("Share link created", "Valid for 7 days, watermarked with your identity, access logged.");
              }}
            >
              Create link
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Input
            label="Stakeholders"
            value={recipients}
            onChange={(e) => setRecipients(e.target.value)}
            hint="Each recipient gets their own link so access can be traced individually."
          />
          <Callout tone="warning" title="Links expire and are logged" icon={<CheckCircle2 />}>
            <p className="mt-1">
              Shared reports are read-only, expire after seven days, and record every view with the
              viewer&apos;s identity and IP. Board packs that leave the organisation additionally need
              a Compliance sign-off recorded against the share.
            </p>
          </Callout>
        </div>
      </Modal>
    </div>
  );
}
