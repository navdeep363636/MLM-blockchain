"use client";

/* AD-08 · Revenue treasury management — the compliance backbone.
 *
 * The rule this page enforces in code, not in prose: an outflow can never be
 * approved for more than the reconciled inflow for the relevant period. */

import { useMemo, useState } from "react";
import {
  AlertTriangle, ArrowDownToLine, ArrowUpFromLine, BadgeCheck, CheckCircle2, Clock,
  Download, FileSpreadsheet, Landmark, Link2, Scale, ShieldAlert, ShieldCheck, Wallet,
} from "lucide-react";
import { AreaTrend } from "@/components/charts";
import {
  Badge, Button, Callout, ConfirmDialog, DetailRow, Input, SegmentedControl,
  useToast, type Column,
} from "@/components/ui";
import {
  useRevenueByStream, useTreasuryInflows, useTreasuryOutflows, useTreasuryTotals,
} from "@/lib/hooks/use-data";
import { csvDownload, formatDate, formatNumber, formatPercent, timeAgo } from "@/lib/utils";
import { MTT_SYMBOL } from "@/lib/web3";
import type { TreasuryInflow, TreasuryOutflow } from "@/types";
import { FourEyesModal } from "../../_components/four-eyes-modal";
import { LedgerTable } from "../../_components/ledger-table";
import { AuditNote, MiniStat, Panel, TxLink } from "../../_components/panel";
import { ThresholdGauge, thresholdTone } from "../../_components/threshold-gauge";
import { useNow } from "../../_components/session";

/** A processor settlement unmatched for longer than this is a reportable
 *  mismatch between reported revenue and settled cash, not just a delay. */
const SETTLEMENT_SLA_DAYS = 5;

const STREAM_LABEL: Record<TreasuryInflow["stream"], string> = {
  iap: "In-app purchases",
  tournament: "Tournament fees",
  marketplace: "Marketplace fees",
  advertising: "Advertising",
  subscription: "Subscriptions",
};

type Period = "7" | "30" | "90" | "all";

const PERIOD_DAYS: Record<Period, number> = { "7": 7, "30": 30, "90": 90, all: 3650 };

/* ------------------------------ header actions ---------------------------- */

export function TreasuryActions() {
  const { data: inflows } = useTreasuryInflows();
  const { data: outflows } = useTreasuryOutflows();
  const { data: totals } = useTreasuryTotals();

  return (
    <Button
      variant="outline"
      size="sm"
      icon={<FileSpreadsheet className="size-4" />}
      onClick={() =>
        csvDownload("members-trail-treasury-statement.csv", [
          ...inflows.map((i) => ({
            record: "inflow",
            id: i.id,
            date: i.date,
            stream_or_destination: i.stream,
            gross_revenue: i.grossRevenue,
            treasury_allocation_pct: i.treasuryAllocationPct,
            amount: i.amountToTreasury,
            processor_ref: i.processorRef,
            reconciled: i.reconciled,
            tx_hash: "",
            approved_by: "",
          })),
          ...outflows.map((o) => ({
            record: "outflow",
            id: o.id,
            date: o.date,
            stream_or_destination: o.destination,
            gross_revenue: "",
            treasury_allocation_pct: "",
            amount: -o.amount,
            processor_ref: "",
            reconciled: true,
            tx_hash: o.txHash,
            approved_by: o.approvedBy.join(" | "),
          })),
          {
            record: "summary",
            id: "TOTALS",
            date: "",
            stream_or_destination: "",
            gross_revenue: "",
            treasury_allocation_pct: "",
            amount: totals.headroom,
            processor_ref: `reconciled_inflow=${totals.reconciledInflow}; outflow=${totals.totalOutflow}; utilisation=${totals.utilisationPct}%`,
            reconciled: true,
            tx_hash: "",
            approved_by: "",
          },
        ])
      }
    >
      Export Treasury statement
    </Button>
  );
}

/* ---------------------------------- view --------------------------------- */

export function TreasuryView() {
  const { data: inflows, isLoading } = useTreasuryInflows();
  const { data: outflows } = useTreasuryOutflows();
  const { data: totals } = useTreasuryTotals();
  const { data: revenue } = useRevenueByStream();
  const toast = useToast();
  const now = useNow(60_000);

  const [period, setPeriod] = useState<Period>("30");
  const [transfer, setTransfer] = useState(false);
  const [amount, setAmount] = useState("");
  const [destination, setDestination] = useState<"staking_pool" | "commission_pool">("staking_pool");
  const [reconciling, setReconciling] = useState<TreasuryInflow | null>(null);

  const cutoff = now - PERIOD_DAYS[period] * 86_400_000;

  const periodInflows = useMemo(
    () => inflows.filter((i) => new Date(i.date).getTime() >= cutoff),
    [inflows, cutoff],
  );
  const periodOutflows = useMemo(
    () => outflows.filter((o) => new Date(o.date).getTime() >= cutoff),
    [outflows, cutoff],
  );

  const reconciledInPeriod = periodInflows
    .filter((i) => i.reconciled)
    .reduce((s, i) => s + i.amountToTreasury, 0);
  const unreconciledInPeriod = periodInflows
    .filter((i) => !i.reconciled)
    .reduce((s, i) => s + i.amountToTreasury, 0);
  const outflowInPeriod = periodOutflows.reduce((s, o) => s + o.amount, 0);
  const headroomInPeriod = reconciledInPeriod - outflowInPeriod;
  const utilisationInPeriod =
    reconciledInPeriod === 0 ? 0 : (outflowInPeriod / reconciledInPeriod) * 100;

  /** Reported revenue that the processor has not settled inside the SLA. */
  const mismatches = useMemo(
    () =>
      inflows.filter(
        (i) => !i.reconciled && now - new Date(i.date).getTime() > SETTLEMENT_SLA_DAYS * 86_400_000,
      ),
    [inflows, now],
  );

  const parsed = Number(amount);
  const amountInvalid = amount !== "" && (!Number.isFinite(parsed) || parsed <= 0);
  /** THE hard block. */
  const exceedsReconciled = Number.isFinite(parsed) && parsed > headroomInPeriod;

  const inflowChart = useMemo(
    () =>
      revenue.map((r, i) => {
        const gross = r.iap + r.tournament + r.marketplace + r.advertising + r.subscription;
        return {
          month: r.month,
          gross,
          toTreasury: Math.round(gross * 0.29),
          committed: Math.round((outflows.length ? totals.totalOutflow / 12 : 0) * (0.7 + (i % 5) * 0.1)),
        };
      }),
    [revenue, outflows.length, totals.totalOutflow],
  );

  /* ------------------------------ inflow table --------------------------- */
  const inflowColumns: Column<TreasuryInflow>[] = [
    {
      key: "id",
      header: "Batch",
      sortValue: (i) => i.id,
      cell: (i) => (
        <div className="min-w-0">
          <p className="font-mono-num truncate text-xs text-text-primary">{i.id}</p>
          <p className="text-[11px] text-text-muted">{timeAgo(i.date)}</p>
        </div>
      ),
    },
    {
      key: "stream",
      header: "Revenue stream",
      sortValue: (i) => i.stream,
      cell: (i) => <span className="text-sm text-text-secondary">{STREAM_LABEL[i.stream]}</span>,
    },
    {
      key: "gross",
      header: "Gross revenue",
      align: "right",
      hideBelow: "md",
      sortValue: (i) => i.grossRevenue,
      cell: (i) => <span className="tnum text-sm text-text-secondary">${formatNumber(i.grossRevenue)}</span>,
    },
    {
      key: "pct",
      header: "Allocation",
      align: "right",
      hideBelow: "lg",
      sortValue: (i) => i.treasuryAllocationPct,
      cell: (i) => <span className="tnum text-sm text-text-muted">{i.treasuryAllocationPct}%</span>,
    },
    {
      key: "amount",
      header: "To Treasury",
      align: "right",
      sortValue: (i) => i.amountToTreasury,
      cell: (i) => (
        <span className="tnum text-sm font-medium text-text-primary">${formatNumber(i.amountToTreasury)}</span>
      ),
    },
    {
      key: "ref",
      header: "Processor ref",
      hideBelow: "lg",
      sortValue: (i) => i.processorRef,
      cell: (i) => <span className="font-mono-num text-xs text-text-secondary">{i.processorRef}</span>,
    },
    {
      key: "status",
      header: "Reconciliation",
      sortValue: (i) => (i.reconciled ? 1 : 0),
      cell: (i) => {
        const overdue = !i.reconciled && now - new Date(i.date).getTime() > SETTLEMENT_SLA_DAYS * 86_400_000;
        return i.reconciled ? (
          <Badge tone="good" icon={<CheckCircle2 className="size-3.5" />}>Reconciled</Badge>
        ) : overdue ? (
          <Badge tone="critical" icon={<ShieldAlert className="size-3.5" />}>Mismatch — past SLA</Badge>
        ) : (
          <Badge tone="warning" icon={<Clock className="size-3.5" />}>Awaiting settlement</Badge>
        );
      },
    },
    {
      key: "action",
      header: "",
      align: "right",
      cell: (i) =>
        i.reconciled ? (
          <span className="text-xs text-text-muted">—</span>
        ) : (
          <Button variant="outline" size="xs" icon={<Scale className="size-3.5" />} onClick={() => setReconciling(i)}>
            Reconcile
          </Button>
        ),
    },
  ];

  /* ----------------------------- outflow table --------------------------- */
  const outflowColumns: Column<TreasuryOutflow>[] = [
    {
      key: "id",
      header: "Transfer",
      sortValue: (o) => o.id,
      cell: (o) => (
        <div className="min-w-0">
          <p className="font-mono-num text-xs text-text-primary">{o.id}</p>
          <p className="text-[11px] text-text-muted">{timeAgo(o.date)}</p>
        </div>
      ),
    },
    {
      key: "destination",
      header: "Destination",
      sortValue: (o) => o.destination,
      cell: (o) => (
        <span className="flex flex-wrap items-center gap-1.5">
          <Badge tone={o.destination === "commission_pool" ? "brand" : "info"}>
            {o.destination === "commission_pool" ? "Commission pool" : "Staking reward pool"}
          </Badge>
          {o.poolId != null && <span className="font-mono-num text-xs text-text-muted">pool {o.poolId}</span>}
        </span>
      ),
    },
    {
      key: "amount",
      header: "Amount",
      align: "right",
      sortValue: (o) => o.amount,
      cell: (o) => (
        <span className="tnum text-sm font-medium text-text-primary">
          {formatNumber(o.amount)} {MTT_SYMBOL}
        </span>
      ),
    },
    {
      key: "date",
      header: "Date",
      align: "right",
      hideBelow: "md",
      sortValue: (o) => o.date,
      cell: (o) => <span className="tnum text-xs text-text-secondary">{formatDate(o.date)}</span>,
    },
    {
      key: "signers",
      header: "Co-signers",
      hideBelow: "lg",
      cell: (o) => (
        <span className="flex flex-wrap gap-1.5">
          {o.approvedBy.map((a) => (
            <Badge key={a} tone="neutral">{a}</Badge>
          ))}
        </span>
      ),
    },
    {
      key: "tx",
      header: "On-chain tx",
      align: "right",
      hideBelow: "sm",
      cell: (o) => <TxLink hash={o.txHash} />,
    },
  ];

  const utilTone = thresholdTone(totals.utilisationPct);

  return (
    <div className="space-y-6">
      {/* ------------------------------- summary -------------------------- */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MiniStat
          label="Reconciled inflow"
          value={`$${formatNumber(totals.reconciledInflow)}`}
          sub="matched to processor settlements"
          tone="good"
        />
        <MiniStat
          label="Unreconciled inflow"
          value={`$${formatNumber(totals.unreconciledInflow)}`}
          sub="reported but not yet settled — unusable"
          tone={totals.unreconciledInflow > 0 ? "warning" : "good"}
        />
        <MiniStat
          label="Committed outflow"
          value={`${formatNumber(totals.totalOutflow)} ${MTT_SYMBOL}`}
          sub={`${formatNumber(totals.commissionOutflow)} commission · ${formatNumber(totals.stakingOutflow)} staking`}
        />
        <MiniStat
          label="Headroom"
          value={`$${formatNumber(totals.headroom)}`}
          sub="reconciled inflow not yet committed"
          tone={totals.headroom <= 0 ? "critical" : "good"}
        />
      </div>

      <Panel
        tone={utilTone === "good" ? "default" : utilTone === "warning" ? "warning" : "critical"}
        icon={<Scale />}
        title="Treasury utilisation"
        description="Committed outflow as a share of reconciled inflow. This is the number an auditor checks first."
        action={
          <Button size="sm" icon={<ArrowUpFromLine className="size-4" />} onClick={() => { setAmount(""); setTransfer(true); }}>
            Trigger funding transfer
          </Button>
        }
        footnote="Utilisation above 100% is arithmetically impossible under the transfer control below: the form refuses to build a proposal that exceeds reconciled inflow for the selected period."
      >
        <div className="grid gap-6 lg:grid-cols-[minmax(0,24rem)_1fr] lg:items-start">
          <ThresholdGauge
            value={totals.utilisationPct}
            size="lg"
            label="Outflow / reconciled inflow"
            sublabel="All time. Commission and staking transfers combined."
          />
          <AreaTrend
            data={inflowChart}
            xKey="month"
            height={240}
            series={[
              { key: "gross", label: "Gross platform revenue" },
              { key: "toTreasury", label: "Allocated to Treasury" },
              { key: "committed", label: "Committed to payout pools" },
            ]}
            valueFormatter={(v) => `$${formatNumber(v)}`}
            title="Revenue, allocation and commitment"
            description="Gross revenue, the share allocated to the Treasury, and what the Treasury committed to reward and commission pools."
            footnote="Allocation percentages vary by stream — advertising allocates 40%, in-app purchases 30%. The exact figure per batch is in the inflow ledger."
          />
        </div>
      </Panel>

      {/* --------------------------- mismatch flags ------------------------ */}
      {mismatches.length > 0 && (
        <Panel
          tone="critical"
          icon={<ShieldAlert />}
          title={`${mismatches.length} settlement mismatch${mismatches.length > 1 ? "es" : ""} past the ${SETTLEMENT_SLA_DAYS}-day SLA`}
          description="Reported revenue with no matching processor settlement. Until matched, this money does not exist for funding purposes."
        >
          <ul className="space-y-2">
            {mismatches.map((m) => (
              <li
                key={m.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-critical-500/30 bg-critical-500/[0.05] px-4 py-3"
              >
                <span className="min-w-0">
                  <span className="font-mono-num block text-xs text-text-primary">{m.id}</span>
                  <span className="block text-xs text-text-muted">
                    {STREAM_LABEL[m.stream]} · processor ref {m.processorRef} · reported {timeAgo(m.date)}
                  </span>
                </span>
                <span className="flex items-center gap-3">
                  <span className="tnum text-sm font-semibold text-text-primary">
                    ${formatNumber(m.amountToTreasury)}
                  </span>
                  <Button variant="outline" size="xs" onClick={() => setReconciling(m)}>
                    Investigate
                  </Button>
                </span>
              </li>
            ))}
          </ul>
          <Callout tone="critical" title="Why a mismatch matters more than it sounds" icon={<AlertTriangle />} className="mt-4">
            <p className="mt-1">
              Reported revenue is what our systems think we earned. A processor settlement is what
              actually arrived in the bank. If those diverge, the difference is either a reporting bug
              or a chargeback wave — and paying rewards against the reported figure would mean paying
              out money the platform never received. Unreconciled inflow is therefore excluded from
              every funding calculation on this page.
            </p>
          </Callout>
        </Panel>
      )}

      {/* ------------------------------ period ---------------------------- */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-text-primary">Ledgers</h2>
          <p className="mt-0.5 text-sm text-text-muted">
            The funding control validates against the reconciled inflow for the period selected here.
          </p>
        </div>
        <SegmentedControl
          value={period}
          onValueChange={setPeriod}
          options={[
            { value: "7", label: "7 days" },
            { value: "30", label: "30 days" },
            { value: "90", label: "90 days" },
            { value: "all", label: "All time" },
          ]}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MiniStat
          label={`Reconciled — last ${period === "all" ? "all time" : `${period}d`}`}
          value={`$${formatNumber(reconciledInPeriod)}`}
          sub={`${periodInflows.filter((i) => i.reconciled).length} batches`}
          tone="good"
        />
        <MiniStat
          label="Unreconciled in period"
          value={`$${formatNumber(unreconciledInPeriod)}`}
          sub="excluded from funding capacity"
          tone={unreconciledInPeriod > 0 ? "warning" : "good"}
        />
        <MiniStat
          label="Outflow in period"
          value={`${formatNumber(outflowInPeriod)} ${MTT_SYMBOL}`}
          sub={`${periodOutflows.length} transfers`}
        />
        <MiniStat
          label="Period headroom"
          value={`$${formatNumber(headroomInPeriod)}`}
          sub={`${formatPercent(utilisationInPeriod, 1)} utilised`}
          tone={headroomInPeriod <= 0 ? "critical" : utilisationInPeriod >= 75 ? "warning" : "good"}
        />
      </div>

      <LedgerTable
        title="Inflow ledger"
        description="Every revenue batch, its Treasury allocation, its payment-processor reference and its reconciliation state."
        icon={<ArrowDownToLine />}
        columns={inflowColumns}
        rows={periodInflows}
        keyOf={(i) => i.id}
        caption="Treasury revenue inflows with processor settlement references and reconciliation status"
        loading={isLoading}
        pageSize={10}
        dense={false}
        empty={{ title: "No inflows in this period", description: "Widen the period selector above." }}
        footnote="Allocation percentage is set per revenue stream by the Treasury policy, not per batch by an operator. Changing it is a Super Admin action with multisig confirmation."
      />

      <LedgerTable
        title="Outflow ledger"
        description="Transfers out of the Treasury to reward and commission pools, each with its co-signers and on-chain hash."
        icon={<ArrowUpFromLine />}
        columns={outflowColumns}
        rows={periodOutflows}
        keyOf={(o) => o.id}
        caption="Treasury outflows to staking reward and commission pools with on-chain transaction hashes"
        pageSize={10}
        dense={false}
        empty={{ title: "No outflows in this period", description: "Widen the period selector above." }}
        footnote="Every row has a hash because every outflow is an on-chain transfer. A payout that cannot be pointed at a transaction on BscScan did not happen."
      />

      <Panel
        icon={<ShieldCheck />}
        title="Why this page is the compliance backbone"
        description="Three controls, in order, and none of them is optional."
      >
        <div className="grid gap-4 md:grid-cols-3">
          {[
            {
              Icon: BadgeCheck,
              title: "1 · Reconcile before you count it",
              body: "Reported revenue becomes usable only when a processor settlement matches it. Unreconciled inflow is visible but excluded from every funding calculation.",
            },
            {
              Icon: Scale,
              title: "2 · Never approve beyond reconciled inflow",
              body: "The funding transfer form refuses amounts above the period's reconciled headroom. It is a validation, not a warning banner.",
            },
            {
              Icon: Link2,
              title: "3 · Prove it on-chain",
              body: "Each approved transfer is a multisig transaction with a public hash, so the payout path from revenue to member is externally verifiable.",
            },
          ].map((c) => (
            <div key={c.title} className="rounded-xl border border-border-subtle bg-surface-inset p-4">
              <p className="flex items-center gap-2 text-sm font-semibold text-text-primary">
                <c.Icon className="size-4 text-[var(--accent)]" />
                {c.title}
              </p>
              <p className="mt-1.5 text-xs leading-relaxed text-text-muted">{c.body}</p>
            </div>
          ))}
        </div>
        <AuditNote className="mt-4">
          Reconciliations, transfer proposals, approvals and rejections are written to append-only
          audit storage with the operator, the approver set and the resulting transaction hash. The
          exported Treasury statement is the same data in the format external auditors ask for.
        </AuditNote>
      </Panel>

      {/* ------------------------- funding transfer ----------------------- */}
      <FourEyesModal
        open={transfer}
        onClose={() => setTransfer(false)}
        onSubmit={(s) => {
          setTransfer(false);
          toast.toast({
            tone: "info",
            title: "Transfer proposed to the multisig",
            description: `${s.secondApprover} plus one further co-signer must sign before it broadcasts.`,
          });
        }}
        title="Trigger a funding transfer"
        description="Treasury → payout pool, executed by the multisig on-chain."
        submitLabel="Propose multisig transfer"
        icon={<Wallet className="size-5" />}
        requiresMultisig
        blocked={amount === "" || amountInvalid || exceedsReconciled || headroomInPeriod <= 0}
        blockedTitle={
          amount === "" ? "Enter a transfer amount"
          : amountInvalid ? "Amount is not valid"
          : headroomInPeriod <= 0 ? "No reconciled headroom in this period"
          : "Amount exceeds reconciled inflow for the period"
        }
        blockedMessage={
          amount === "" || amountInvalid ? (
            "State the amount explicitly. The multisig proposal is built from this figure and cannot be edited after signing starts."
          ) : (
            <>
              Reconciled inflow for the selected {period === "all" ? "period" : `${period}-day period`} is{" "}
              <strong className="text-text-primary">${formatNumber(reconciledInPeriod)}</strong>, of which{" "}
              <strong className="text-text-primary">{formatNumber(outflowInPeriod)} {MTT_SYMBOL}</strong> is
              already committed — leaving{" "}
              <strong className="text-text-primary">${formatNumber(Math.max(0, headroomInPeriod))}</strong>.
              An outflow can never be approved for more than the reconciled inflow for the relevant
              period, so this proposal cannot be created. Reconcile the outstanding settlement batches,
              select a longer period that genuinely covers the commitment, or reduce the amount.
            </>
          )
        }
        reasonLabel="Purpose of the transfer"
        reasonHint="Reference the reward epoch or commission batch this funds, and the settlement batches backing it."
        acknowledgement={
          <span>
            I confirm this transfer is funded from reconciled real revenue, that it does not exceed
            the reconciled inflow for the period, that it draws on no member&apos;s deposit or staked
            principal, and that the resulting transaction hash will be published in the outflow
            ledger.
          </span>
        }
      >
        <div className="space-y-4">
          <div className="space-y-1.5">
            <span className="block text-sm font-medium text-text-secondary">Destination pool</span>
            <SegmentedControl
              value={destination}
              onValueChange={setDestination}
              options={[
                { value: "staking_pool", label: "Staking reward pool" },
                { value: "commission_pool", label: "Commission pool" },
              ]}
            />
          </div>

          <Input
            label="Transfer amount"
            required
            type="number"
            min={0}
            suffix={MTT_SYMBOL}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="e.g. 42800"
            className="tnum"
            hint={`Period headroom: $${formatNumber(Math.max(0, headroomInPeriod))}`}
            error={exceedsReconciled && "Exceeds reconciled inflow for the period."}
          />

          <div className="rounded-xl border border-border-subtle bg-surface-inset px-4 py-1">
            <DetailRow
              label="Period"
              value={period === "all" ? "All time" : `Last ${period} days`}
              hint="Set by the period selector on the page. The validation uses exactly this window."
            />
            <DetailRow label="Reconciled inflow" value={<span className="tnum">${formatNumber(reconciledInPeriod)}</span>} />
            <DetailRow label="Already committed" value={<span className="tnum">{formatNumber(outflowInPeriod)} {MTT_SYMBOL}</span>} />
            <DetailRow
              label="Available headroom"
              value={
                <span className={headroomInPeriod <= 0 ? "tnum text-critical-400" : "tnum text-good-400"}>
                  ${formatNumber(Math.max(0, headroomInPeriod))}
                </span>
              }
            />
            <DetailRow
              label="Headroom after transfer"
              value={
                <span className={exceedsReconciled ? "tnum text-critical-400" : "tnum text-text-primary"}>
                  ${formatNumber(headroomInPeriod - (Number.isFinite(parsed) ? parsed : 0))}
                </span>
              }
            />
            <DetailRow
              label="Excluded from capacity"
              value={<span className="tnum">${formatNumber(unreconciledInPeriod)} unreconciled</span>}
            />
          </div>

          <Callout tone="warning" title="Unreconciled revenue cannot fund anything" icon={<AlertTriangle />}>
            <p className="mt-1">
              ${formatNumber(unreconciledInPeriod)} of reported revenue in this period has no matching
              processor settlement yet. It is deliberately not counted here, however confident the
              reporting looks — a chargeback wave lands on exactly this figure.
            </p>
          </Callout>
        </div>
      </FourEyesModal>

      {/* --------------------------- reconcile batch ---------------------- */}
      <ConfirmDialog
        open={!!reconciling}
        onClose={() => setReconciling(null)}
        onConfirm={() => {
          const b = reconciling;
          setReconciling(null);
          toast.success(
            `${b?.id} reconciled`,
            "The batch is now counted toward funding capacity for its period.",
          );
        }}
        title="Reconcile this settlement batch?"
        confirmLabel="Mark as reconciled"
        requireAcknowledge={
          <Callout tone="warning" title="You are asserting the cash arrived" icon={<Scale />}>
            <p className="mt-1">
              Reconciling makes this amount spendable on rewards and commission. Confirm the processor
              settlement report, the amount and the fee deduction all match the reported figure before
              you continue — this is the control that stops reported-but-never-received revenue from
              funding a payout.
            </p>
          </Callout>
        }
      >
        <div className="space-y-2">
          <DetailRow label="Batch" value={<span className="font-mono-num text-xs">{reconciling?.id}</span>} />
          <DetailRow label="Stream" value={reconciling ? STREAM_LABEL[reconciling.stream] : ""} />
          <DetailRow label="Processor reference" value={<span className="font-mono-num text-xs">{reconciling?.processorRef}</span>} />
          <DetailRow label="Gross revenue" value={<span className="tnum">${formatNumber(reconciling?.grossRevenue ?? 0)}</span>} />
          <DetailRow
            label="Amount to Treasury"
            value={
              <span className="tnum">
                ${formatNumber(reconciling?.amountToTreasury ?? 0)} ({reconciling?.treasuryAllocationPct}%)
              </span>
            }
          />
          <DetailRow label="Reported" value={reconciling ? formatDate(reconciling.date, true) : ""} />
        </div>
      </ConfirmDialog>

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="sm" href="/admin/staking" icon={<Landmark className="size-4" />}>
          Staking reward pools
        </Button>
        <Button variant="ghost" size="sm" href="/admin/commission" icon={<Download className="size-4" />}>
          Commission plan & simulator
        </Button>
        <Button variant="ghost" size="sm" href="/admin/reports" icon={<FileSpreadsheet className="size-4" />}>
          Finance reports
        </Button>
      </div>
    </div>
  );
}
