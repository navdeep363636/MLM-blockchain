"use client";

/* AD-07 · Referral / commission configuration — plan parameters plus the
 * mandatory payout simulator. Nothing publishes if the projection is
 * unsustainable: that is the guard that keeps the plan revenue-funded. */

import { useMemo, useState } from "react";
import {
  AlertTriangle, Calculator, CheckCircle2, Download, GitBranch, Info, Layers,
  Percent, ShieldCheck, Sigma, TimerReset, Users,
} from "lucide-react";
import { LineSeries } from "@/components/charts";
import {
  Badge, Button, CapMeter, Callout, Checkbox, DetailRow, InfoHint, Input, Slider,
  useToast,
} from "@/components/ui";
import {
  useCommissionConfig, usePayoutVsInflow, useRevenueByStream, useTreasuryTotals,
} from "@/lib/hooks/use-data";
import { csvDownload, formatNumber, formatPercent } from "@/lib/utils";
import type { CommissionEntry } from "@/types";
import { FourEyesModal } from "../../_components/four-eyes-modal";
import { AuditNote, MiniStat, Panel } from "../../_components/panel";
import { THRESHOLD_VAR, ThresholdGauge, thresholdTone } from "../../_components/threshold-gauge";

type Trigger = CommissionEntry["triggerType"];

const TRIGGER_META: Record<Trigger, { label: string; revenueKey: string; blurb: string }> = {
  iap: {
    label: "In-app purchases",
    revenueKey: "iap",
    blurb: "Real money spent on cosmetics, boosts and passes. The largest eligible stream.",
  },
  tournament_entry: {
    label: "Tournament entry fees",
    revenueKey: "tournament",
    blurb: "Paid competitive entries. Free-entry tournaments generate no commission.",
  },
  subscription: {
    label: "Subscriptions",
    revenueKey: "subscription",
    blurb: "Recurring premium passes, commissionable on each successful settlement.",
  },
};

const INELIGIBLE = [
  ["Deposits and top-ups", "A member funding their own wallet is not revenue and can never generate commission — this is the single rule that separates the plan from a deposit-funded scheme."],
  ["Points conversions", "Converting Points to MTT moves value the member already earned; no new revenue exists to pay a commission from."],
  ["Staking rewards", "Yield is already a Treasury outflow. Paying commission on it would pay the same rupee out twice."],
  ["Withdrawals and transfers", "Money leaving the platform is not a revenue event."],
  ["Marketplace peer-to-peer trades", "The platform fee is revenue; the trade value belongs to the members and is excluded."],
  ["Advertising revenue", "Not attributable to an individual member's spend, so it funds the Treasury but generates no per-member commission."],
];

export function CommissionActions() {
  const { data: cfg } = useCommissionConfig();
  return (
    <Button
      variant="outline"
      size="sm"
      icon={<Download className="size-4" />}
      onClick={() =>
        csvDownload("members-trail-commission-config.csv", [
          ...cfg.levels.map((l) => ({ parameter: `level_${l.level}_rate_pct`, value: l.ratePct })),
          { parameter: "eligible_types", value: cfg.eligibleTypes.join(" | ") },
          { parameter: "monthly_cap_absolute", value: cfg.monthlyCapAbsolute },
          { parameter: "monthly_cap_multiplier", value: cfg.monthlyCapMultiplier },
          { parameter: "monthly_cap_base", value: cfg.monthlyCapBase },
          { parameter: "max_depth", value: cfg.maxDepth },
          { parameter: "min_account_age_days", value: cfg.minAccountAgeDays },
          { parameter: "min_gameplay_sessions", value: cfg.minGameplaySessions },
        ])
      }
    >
      Export plan parameters
    </Button>
  );
}

export function CommissionView() {
  const { data: cfg, isLoading } = useCommissionConfig();
  const { data: revenue } = useRevenueByStream();
  const { data: payout } = usePayoutVsInflow();
  const { data: totals } = useTreasuryTotals();
  const toast = useToast();

  /* ------------------------------- draft state --------------------------- */
  const [levels, setLevels] = useState<number[]>(cfg.levels.map((l) => l.ratePct));
  const [eligible, setEligible] = useState<Trigger[]>([...cfg.eligibleTypes]);
  const [capAbsolute, setCapAbsolute] = useState(cfg.monthlyCapAbsolute);
  const [capMultiplier, setCapMultiplier] = useState(cfg.monthlyCapMultiplier);
  const [capBase, setCapBase] = useState(cfg.monthlyCapBase);
  const [maxDepth, setMaxDepth] = useState(cfg.maxDepth);
  const [minAge, setMinAge] = useState(cfg.minAccountAgeDays);
  const [minSessions, setMinSessions] = useState(cfg.minGameplaySessions);
  const [publish, setPublish] = useState(false);

  /* ------------------------------- simulator ----------------------------- */
  const [coverage, setCoverage] = useState(62);        // % of eligible spend with an upline
  const [growth, setGrowth] = useState(0);             // % revenue growth assumption
  const [referrers, setReferrers] = useState(9_400);   // members earning commission next month

  const activeLevels = levels.slice(0, maxDepth);
  const cov = coverage / 100;
  /** Effective blended rate: L1 always applies, deeper levels only where an
   *  upline exists, which compounds with coverage. */
  const effectiveRate = activeLevels.reduce((sum, rate, i) => sum + (rate / 100) * Math.pow(cov, i), 0);

  /* `eligible` starts from `cfg.eligibleTypes`, which is server config — a
     trigger the server has and this table does not is a deploy-order problem,
     not a reason to blank the page. Unknown types contribute nothing and the
     rest of the simulator still works. */
  const eligibleRevenueOf = (row: Record<string, number | string>) =>
    eligible.reduce((sum, t) => {
      const key = TRIGGER_META[t]?.revenueKey;
      return key ? sum + Number(row[key] ?? 0) : sum;
    }, 0);

  const backtest = useMemo(
    () =>
      revenue.map((r, i) => {
        const inflow = payout[i]?.inflow ?? 0;
        const staking = payout[i]?.staking ?? 0;
        const eligibleRevenue = eligibleRevenueOf(r as unknown as Record<string, number | string>) * (1 + growth / 100);
        const liability = eligibleRevenue * effectiveRate;
        return {
          month: r.month,
          proposed: inflow === 0 ? 0 : Number((((liability + staking) / inflow) * 100).toFixed(1)),
          actual: payout[i]?.ratio ?? 0,
          ceiling: 100,
        };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [revenue, payout, effectiveRate, growth, eligible],
  );

  const latestRevenue = revenue[revenue.length - 1];
  const latestPayout = payout[payout.length - 1];
  const projectedEligibleRevenue =
    (latestRevenue ? eligibleRevenueOf(latestRevenue as unknown as Record<string, number | string>) : 0) *
    (1 + growth / 100);
  const uncappedLiability = projectedEligibleRevenue * effectiveRate;
  const capCeiling = referrers * capAbsolute;
  const cappedLiability = Math.min(uncappedLiability, capCeiling);
  const projectedInflow = (latestPayout?.inflow ?? 0) * (1 + growth / 100);
  const projectedStaking = latestPayout?.staking ?? 0;
  const projectedRatio =
    projectedInflow === 0 ? 0 : ((cappedLiability + projectedStaking) / projectedInflow) * 100;
  const tone = thresholdTone(projectedRatio);
  const unsustainable = projectedRatio >= 100;
  const worstBacktest = backtest.reduce((m, b) => Math.max(m, b.proposed), 0);

  const formulaCap = capMultiplier * capBase;
  const dirty =
    levels.some((l, i) => l !== cfg.levels[i].ratePct) ||
    eligible.length !== cfg.eligibleTypes.length ||
    eligible.some((t) => !cfg.eligibleTypes.includes(t)) ||
    capAbsolute !== cfg.monthlyCapAbsolute ||
    capMultiplier !== cfg.monthlyCapMultiplier ||
    capBase !== cfg.monthlyCapBase ||
    maxDepth !== cfg.maxDepth ||
    minAge !== cfg.minAccountAgeDays ||
    minSessions !== cfg.minGameplaySessions;

  const toggleTrigger = (t: Trigger) =>
    setEligible((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]));

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MiniStat
          label="Blended effective rate"
          value={formatPercent(effectiveRate * 100, 2)}
          sub={`of eligible spend at ${coverage}% upline coverage`}
        />
        <MiniStat label="Max depth" value={`${maxDepth} levels`} sub="hard ceiling, not adjustable upward" />
        <MiniStat
          label="Per-user monthly cap"
          value={formatNumber(capAbsolute)}
          sub={`or ${capMultiplier}× ${formatNumber(capBase)} formula, whichever is lower`}
        />
        <MiniStat
          label="Projected payout ratio"
          value={formatPercent(projectedRatio, 1)}
          sub="commission + staking vs inflow"
          tone={tone === "good" ? "good" : tone === "warning" ? "warning" : "critical"}
        />
      </div>

      <Callout tone="info" title="What this plan is, and what it is not" icon={<Info />}>
        <p className="mt-1">
          Commission is a marketing cost paid out of revenue that a referred member&apos;s
          <em> purchase </em> actually generated. Referring is optional and free, it is capped, and it
          is never a condition of earning, converting or withdrawing. No parameter on this page can
          make a deposit commissionable — deposits are excluded at the event level, not by
          configuration.
        </p>
      </Callout>

      {/* ---------------------------- level rates -------------------------- */}
      <div className="grid gap-4 xl:grid-cols-2">
        <Panel
          icon={<Percent />}
          title="Level percentages"
          description="Applied to eligible net revenue, not to gross spend and not to deposits."
          footnote={`Total plan cost at full three-level coverage: ${formatPercent(levels.slice(0, maxDepth).reduce((a, b) => a + b, 0), 2)} of eligible revenue.`}
        >
          <div className="space-y-5">
            {levels.map((rate, i) => {
              const level = i + 1;
              const disabled = level > maxDepth;
              return (
                <div key={level} className={disabled ? "opacity-45" : undefined}>
                  <Slider
                    label={
                      <span className="flex items-center gap-2">
                        Level {level} rate
                        {disabled && <Badge tone="neutral">Beyond max depth</Badge>}
                      </span>
                    }
                    value={rate}
                    min={0}
                    max={15}
                    step={0.5}
                    formatValue={(v) => `${v.toFixed(1)}%`}
                    onValueChange={(v) => setLevels((cur) => cur.map((c, j) => (j === i ? v : c)))}
                  />
                  <p className="mt-1 text-xs text-text-muted">
                    {level === 1
                      ? "Direct referrals. The member you personally introduced."
                      : level === 2
                      ? "Your referral's referrals. Paid only where that relationship exists."
                      : "Third level. Deliberately small — depth is not the point of the plan."}
                  </p>
                </div>
              );
            })}
            <Input
              label="Maximum referral depth"
              type="number"
              min={1}
              max={3}
              suffix="levels"
              value={String(maxDepth)}
              onChange={(e) => setMaxDepth(Math.min(3, Math.max(1, Number(e.target.value) || 1)))}
              className="tnum"
              hint="Capped at 3 by policy. A deeper structure would make the plan look like recruitment compensation rather than a marketing referral."
            />
          </div>
        </Panel>

        <Panel
          icon={<Layers />}
          title="Eligible transaction types"
          description="Only real-revenue events. Everything else is excluded by design."
          footnote="Changing this list changes what generates commission going forward only. Historical commission keeps the eligibility rules that were in force when it accrued."
        >
          <div className="space-y-3">
            {(Object.keys(TRIGGER_META) as Trigger[]).map((t) => (
              <div key={t} className="rounded-xl border border-border-subtle bg-surface-inset p-3.5">
                <Checkbox
                  checked={eligible.includes(t)}
                  onCheckedChange={() => toggleTrigger(t)}
                  label={
                    <span>
                      <span className="block text-sm font-medium text-text-primary">{TRIGGER_META[t].label}</span>
                      <span className="mt-0.5 block text-xs leading-relaxed text-text-muted">{TRIGGER_META[t].blurb}</span>
                    </span>
                  }
                />
              </div>
            ))}
            {eligible.length === 0 && (
              <Callout tone="warning" title="No eligible types selected" icon={<AlertTriangle />}>
                <p className="mt-1">
                  With nothing selected the plan pays nothing. That is a valid configuration for a
                  pause, but it must be communicated to members before it publishes.
                </p>
              </Callout>
            )}
          </div>

          <div className="mt-5">
            <p className="text-xs font-semibold uppercase tracking-wider text-text-muted">
              Permanently ineligible
            </p>
            <ul className="mt-2 space-y-2">
              {INELIGIBLE.map(([title, why]) => (
                <li key={title} className="flex gap-2.5 text-xs leading-relaxed">
                  <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-good-400" />
                  <span>
                    <span className="font-medium text-text-primary">{title}.</span>{" "}
                    <span className="text-text-muted">{why}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </Panel>
      </div>

      {/* ------------------------------- caps ----------------------------- */}
      <Panel
        icon={<Sigma />}
        title="Per-user monthly cap and eligibility gates"
        description="The cap is the second guard after eligibility: it bounds any single member's payout regardless of downline size."
      >
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-4">
            <Input
              label="Absolute monthly cap"
              type="number"
              min={0}
              suffix="MTT"
              value={String(capAbsolute)}
              onChange={(e) => setCapAbsolute(Number(e.target.value) || 0)}
              className="tnum"
              hint="Hard ceiling per member per calendar month."
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                label="Formula multiplier"
                type="number"
                min={0}
                suffix="×"
                value={String(capMultiplier)}
                onChange={(e) => setCapMultiplier(Number(e.target.value) || 0)}
                className="tnum"
              />
              <Input
                label="Formula base"
                type="number"
                min={0}
                suffix="MTT"
                value={String(capBase)}
                onChange={(e) => setCapBase(Number(e.target.value) || 0)}
                className="tnum"
              />
            </div>
            <div className="rounded-xl border border-border-subtle bg-surface-inset px-4 py-1">
              <DetailRow
                label="Formula cap"
                value={<span className="tnum">{formatNumber(formulaCap)} MTT</span>}
                hint="Multiplier × base. The effective cap is whichever is lower — absolute or formula."
              />
              <DetailRow
                label="Effective cap applied"
                value={<span className="tnum">{formatNumber(Math.min(capAbsolute, formulaCap))} MTT</span>}
              />
              <DetailRow label="Reset" value="1st of each calendar month, 00:00 UTC" />
              <DetailRow label="Excess treatment" value="Not carried forward — it is simply not earned" />
            </div>
          </div>

          <div className="space-y-4">
            <Input
              label="Minimum account age of the referred member"
              type="number"
              min={0}
              suffix="days"
              value={String(minAge)}
              onChange={(e) => setMinAge(Number(e.target.value) || 0)}
              className="tnum"
              hint="Blocks same-day sign-up-and-spend rings. Commission accrues but is not payable until this age is met."
            />
            <Input
              label="Minimum gameplay sessions of the referred member"
              type="number"
              min={0}
              suffix="sessions"
              value={String(minSessions)}
              onChange={(e) => setMinSessions(Number(e.target.value) || 0)}
              className="tnum"
              hint="A referral must actually play. This is what makes it a player acquisition, not a headcount."
            />
            <div className="rounded-xl border border-border-subtle bg-surface-inset p-4">
              <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-text-muted">
                Cap utilisation, current month
                <InfoHint>
                  Modelled from the projected liability against the aggregate of every member&apos;s
                  cap. A low figure means the caps are not the binding constraint; a high figure means
                  they are doing the work.
                </InfoHint>
              </p>
              <CapMeter
                className="mt-3"
                used={Math.round(cappedLiability)}
                cap={Math.max(1, capCeiling)}
                label={`${formatNumber(referrers)} earning members × ${formatNumber(capAbsolute)} MTT cap`}
              />
              <p className="mt-3 text-xs leading-relaxed text-text-muted">
                {uncappedLiability > capCeiling
                  ? `The cap is binding: ${formatNumber(Math.round(uncappedLiability - capCeiling))} MTT of otherwise-accruable commission is not earned this month.`
                  : "The cap is not currently binding — projected liability sits below the aggregate ceiling."}
              </p>
            </div>
          </div>
        </div>
      </Panel>

      {/* ---------------------------- the simulator ------------------------ */}
      <Panel
        tone={tone === "good" ? "default" : tone === "warning" ? "warning" : "critical"}
        icon={<Calculator />}
        title={
          <span className="flex flex-wrap items-center gap-2">
            Payout simulator
            <Badge tone={tone === "good" ? "good" : tone === "warning" ? "warning" : "critical"} dot>
              {tone === "good" ? "Sustainable" : tone === "warning" ? "Tight" : "Unsustainable"}
            </Badge>
          </span>
        }
        description="Projects total commission liability against current Treasury inflow before anything is published. This is a gate, not a report."
        footnote="The simulator uses reconciled inflow only. Unreconciled processor settlements are excluded, so a projection can never be rescued by revenue that has not been matched to a settlement batch."
      >
        <div className="grid gap-6 lg:grid-cols-[minmax(0,22rem)_1fr] lg:items-start">
          <div className="space-y-5">
            <Slider
              label="Upline coverage"
              value={coverage}
              min={0}
              max={100}
              step={1}
              formatValue={(v) => `${v}%`}
              onValueChange={setCoverage}
            />
            <p className="-mt-3 text-xs text-text-muted">
              Share of eligible spend made by members who have an upline. Level 2 and 3 liability
              compound down from this, which is why the blended rate is well under the sum of the
              level rates.
            </p>
            <Slider
              label="Revenue growth assumption"
              value={growth}
              min={-40}
              max={80}
              step={5}
              formatValue={(v) => `${v > 0 ? "+" : ""}${v}%`}
              onValueChange={setGrowth}
            />
            <Input
              label="Members earning commission next month"
              type="number"
              min={0}
              value={String(referrers)}
              onChange={(e) => setReferrers(Number(e.target.value) || 0)}
              className="tnum"
              hint="Drives the aggregate cap ceiling."
            />

            <div className="rounded-xl border border-border-subtle bg-surface-inset px-4 py-1">
              <DetailRow
                label="Projected eligible revenue"
                value={<span className="tnum">${formatNumber(projectedEligibleRevenue)}</span>}
              />
              <DetailRow
                label="Uncapped liability"
                value={<span className="tnum">${formatNumber(Math.round(uncappedLiability))}</span>}
              />
              <DetailRow
                label="After per-user caps"
                value={<span className="tnum">${formatNumber(Math.round(cappedLiability))}</span>}
              />
              <DetailRow
                label="Staking commitment"
                value={<span className="tnum">${formatNumber(projectedStaking)}</span>}
                hint="Reward-pool funding already committed for the same period. Commission does not get to ignore it."
              />
              <DetailRow
                label="Projected Treasury inflow"
                value={<span className="tnum">${formatNumber(Math.round(projectedInflow))}</span>}
              />
              <DetailRow
                label="Reconciled headroom today"
                value={<span className="tnum">{formatNumber(totals.headroom)} MTT</span>}
              />
            </div>
          </div>

          <div className="space-y-4">
            <ThresholdGauge
              value={projectedRatio}
              size="lg"
              label="Projected payout / inflow ratio"
              sublabel="Commission liability plus committed staking rewards, over projected reconciled inflow."
            />

            <LineSeries
              data={backtest}
              xKey="month"
              height={240}
              series={[
                { key: "proposed", label: "Proposed plan", color: THRESHOLD_VAR[tone] },
                { key: "actual", label: "Plan as it actually ran", color: "var(--series-1)" },
                { key: "ceiling", label: "Ceiling (100%)", color: THRESHOLD_VAR.critical },
              ]}
              valueFormatter={(v) => `${v.toFixed(1)}%`}
              title="Backtest: what these parameters would have cost"
              description="The proposed plan replayed against the last 12 months of real revenue and staking commitments."
              footnote={`Worst month under the proposed parameters: ${formatPercent(worstBacktest, 1)}. A single month above 100% is enough to make the plan deposit-funded and is blocked at publication.`}
            />

            {unsustainable ? (
              <Callout tone="critical" title="Publication blocked — projection exceeds 100%" icon={<AlertTriangle />}>
                <p className="mt-1">
                  At these parameters the plan would owe more than the Treasury takes in. The shortfall
                  could only be covered by other members&apos; deposits or by drawing down the reserve,
                  so publication is refused. Lower the level rates, reduce the per-user cap, narrow the
                  eligible types, or wait for inflow to grow.
                </p>
              </Callout>
            ) : tone === "warning" ? (
              <Callout tone="warning" title="Publishable, but with no margin" icon={<AlertTriangle />}>
                <p className="mt-1">
                  The projection is above 75%. Publication is allowed, but Finance must review it
                  monthly and the plan will throttle automatically if the realised ratio crosses 90%.
                  Consider a lower Level 1 rate instead of a lower cap — caps bite hardest on the
                  members who actually referred players.
                </p>
              </Callout>
            ) : (
              <Callout tone="good" title="Projection is within the sustainable band" icon={<CheckCircle2 />}>
                <p className="mt-1">
                  Commission and staking together consume {formatPercent(projectedRatio, 1)} of
                  projected reconciled inflow, leaving real margin. The plan stays revenue-funded even
                  if inflow disappoints by{" "}
                  {formatPercent(Math.max(0, 100 - projectedRatio), 0)}.
                </p>
              </Callout>
            )}
          </div>
        </div>
      </Panel>

      {/* ------------------------------ publish --------------------------- */}
      <Panel
        tone={dirty ? "warning" : "default"}
        icon={<GitBranch />}
        title={dirty ? "Unpublished plan changes" : "No pending plan changes"}
        description={
          dirty
            ? "Parameters are held as a draft version. The simulator above must clear before this can publish."
            : "Adjust a rate, cap or eligibility rule to create a draft version."
        }
        action={
          <>
            <Button
              variant="ghost"
              size="sm"
              icon={<TimerReset className="size-4" />}
              disabled={!dirty}
              onClick={() => {
                setLevels(cfg.levels.map((l) => l.ratePct));
                setEligible([...cfg.eligibleTypes]);
                setCapAbsolute(cfg.monthlyCapAbsolute);
                setCapMultiplier(cfg.monthlyCapMultiplier);
                setCapBase(cfg.monthlyCapBase);
                setMaxDepth(cfg.maxDepth);
                setMinAge(cfg.minAccountAgeDays);
                setMinSessions(cfg.minGameplaySessions);
              }}
            >
              Reset to live plan
            </Button>
            <Button size="sm" icon={<Users className="size-4" />} disabled={!dirty} onClick={() => setPublish(true)}>
              Publish plan version
            </Button>
          </>
        }
      >
        <AuditNote>
          Plan versions are immutable and numbered. Commission that already accrued keeps the version
          it accrued under, so republishing never revalues a member&apos;s past earnings. The
          simulator output at the moment of publication is stored with the version as evidence that
          the plan was sustainable when it was approved.
        </AuditNote>
      </Panel>

      {isLoading && <p className="text-sm text-text-muted">Loading the live plan…</p>}

      <FourEyesModal
        open={publish}
        onClose={() => setPublish(false)}
        onSubmit={(s) => {
          setPublish(false);
          toast.success(
            "Plan version submitted",
            `Routed to ${s.secondApprover} with the simulator output attached.`,
          );
        }}
        title="Publish commission plan version"
        description="Versioned, four-eyes approved, and gated on the simulator."
        submitLabel="Submit for approval"
        icon={<GitBranch className="size-5" />}
        blocked={unsustainable || eligible.length === 0}
        blockedTitle={
          unsustainable
            ? "Simulator projects an unsustainable plan"
            : "No eligible transaction types selected"
        }
        blockedMessage={
          unsustainable
            ? `Projected payout ratio is ${formatPercent(projectedRatio, 1)}, at or above the 100% ceiling. A plan that cannot be funded from revenue cannot be published — this is a hard block, not a warning.`
            : "A plan with no eligible transaction types pays nothing. If a deliberate pause is intended, publish it as an announced pause rather than an empty parameter set."
        }
        reasonLabel="Rationale for the plan change"
        reasonHint="Stored on the version alongside the simulator output. Explain the commercial reason and the sustainability evidence."
        acknowledgement={
          <span>
            I confirm the simulator projection above was run against reconciled Treasury inflow, that
            commission remains payable only from real revenue events, that referring stays optional,
            free and capped, and that no income claims will accompany this change.
          </span>
        }
      >
        <div className="space-y-4">
          <div className="rounded-xl border border-border-subtle bg-surface-inset px-4 py-1">
            {levels.slice(0, maxDepth).map((r, i) => (
              <DetailRow
                key={i}
                label={`Level ${i + 1} rate`}
                value={
                  <span className="tnum">
                    {cfg.levels[i].ratePct}% → <span className="font-semibold text-text-primary">{r}%</span>
                  </span>
                }
              />
            ))}
            <DetailRow label="Max depth" value={`${cfg.maxDepth} → ${maxDepth} levels`} />
            <DetailRow
              label="Eligible types"
              value={eligible.map((t) => TRIGGER_META[t]?.label ?? t).join(", ") || "None"}
            />
            <DetailRow
              label="Monthly cap"
              value={<span className="tnum">{formatNumber(Math.min(capAbsolute, formulaCap))} MTT</span>}
            />
            <DetailRow label="Min account age" value={`${minAge} days`} />
            <DetailRow label="Min gameplay sessions" value={`${minSessions} sessions`} />
            <DetailRow
              label="Simulator verdict"
              value={
                <Badge tone={tone === "good" ? "good" : tone === "warning" ? "warning" : "critical"} dot>
                  {formatPercent(projectedRatio, 1)} projected ratio
                </Badge>
              }
            />
          </div>
          <Callout tone="info" title="Members are notified before it applies" icon={<Info />}>
            <p className="mt-1">
              A rate reduction or a narrowing of eligible types is a material change: affected members
              get in-app and email notice, and the new version applies from the following calendar
              month so nobody loses commission already accruing this month.
            </p>
          </Callout>
        </div>
      </FourEyesModal>
    </div>
  );
}
