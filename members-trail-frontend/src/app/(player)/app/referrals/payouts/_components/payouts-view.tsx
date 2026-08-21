"use client";

import { useMemo, useState } from "react";
import {
  AlertTriangle, Download, FileWarning, Info, Landmark, Receipt, ShieldCheck,
} from "lucide-react";
import {
  Badge, Button, Callout, DataTable, DetailRow, LevelBadge, Modal, SearchInput,
  SegmentedControl, Select, StatTile, StatusPill, Textarea, useToast, type Column,
} from "@/components/ui";
import { BarSeries } from "@/components/charts";
import { useCommissionHistory, useReferralSummary } from "@/lib/hooks/use-data";
import { csvDownload, formatDate, formatToken } from "@/lib/utils";
import type { CommissionEntry } from "@/types";
import { RelativeTime, useReferenceNow } from "../../../_components/time";

type Range = "30d" | "90d" | "all";
const RANGE_DAYS: Record<Range, number> = { "30d": 30, "90d": 90, all: 100_000 };

const TRIGGER_LABEL: Record<CommissionEntry["triggerType"], string> = {
  iap: "In-app purchase",
  tournament_entry: "Tournament entry",
  subscription: "Premium Pass",
};

export function PayoutsView() {
  const { data: entries, isLoading } = useCommissionHistory();
  const { data: summary } = useReferralSummary();
  const referenceNow = useReferenceNow();
  const toast = useToast();

  const [range, setRange] = useState<Range>("90d");
  const [level, setLevel] = useState("all");
  const [query, setQuery] = useState("");
  const [detail, setDetail] = useState<CommissionEntry | null>(null);
  const [disputing, setDisputing] = useState<CommissionEntry | null>(null);
  const [disputeText, setDisputeText] = useState("");

  const filtered = useMemo(() => {
    const cutoff = referenceNow - RANGE_DAYS[range] * 86_400_000;
    const needle = query.trim().toLowerCase();
    return entries.filter((e) => {
      if (Date.parse(e.date) < cutoff) return false;
      if (level !== "all" && String(e.level) !== level) return false;
      if (needle) {
        const hay = `${e.id} ${e.downlineLabel} ${e.treasuryDepositRef} ${e.sourceEventId} ${TRIGGER_LABEL[e.triggerType]}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [entries, range, level, query, referenceNow]);

  const totals = useMemo(() => {
    const paid = filtered.filter((e) => e.status === "paid").reduce((s, e) => s + e.amount, 0);
    const pending = filtered.filter((e) => e.status !== "paid").reduce((s, e) => s + e.amount, 0);
    const spend = filtered.reduce((s, e) => s + e.eligibleSpend, 0);
    return { paid, pending, spend, count: filtered.length };
  }, [filtered]);

  const byTrigger = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of filtered) {
      const k = TRIGGER_LABEL[e.triggerType];
      m.set(k, (m.get(k) ?? 0) + e.amount);
    }
    return Array.from(m.entries()).map(([trigger, amount]) => ({ trigger, amount: Number(amount.toFixed(2)) }));
  }, [filtered]);

  const columns: Column<CommissionEntry>[] = [
    {
      key: "date",
      header: "Date",
      cell: (e) => (
        <span className="whitespace-nowrap">
          <span className="tnum block text-text-primary">{formatDate(e.date)}</span>
          <span className="block text-xs text-text-muted"><RelativeTime date={e.date} /></span>
        </span>
      ),
      sortValue: (e) => e.date,
    },
    {
      key: "downline",
      header: "Downline",
      cell: (e) => <span className="text-text-secondary">{e.downlineLabel}</span>,
      sortValue: (e) => e.downlineLabel,
    },
    { key: "level", header: "Level", cell: (e) => <LevelBadge level={e.level} />, sortValue: (e) => e.level },
    {
      key: "trigger",
      header: "Triggering event",
      hideBelow: "lg",
      cell: (e) => (
        <span className="text-text-secondary">
          {TRIGGER_LABEL[e.triggerType]}
          <span className="tnum ml-1.5 text-xs text-text-muted">₹{formatToken(e.eligibleSpend)}</span>
        </span>
      ),
      sortValue: (e) => e.eligibleSpend,
    },
    {
      key: "rate",
      header: "Rate",
      align: "right",
      hideBelow: "md",
      cell: (e) => <span className="tnum text-text-muted">{(e.rate * 100).toFixed(0)}%</span>,
      sortValue: (e) => e.rate,
    },
    {
      key: "amount",
      header: "Commission",
      align: "right",
      cell: (e) => <span className="tnum font-semibold text-text-primary">₹{formatToken(e.amount)}</span>,
      sortValue: (e) => e.amount,
    },
    { key: "status", header: "Status", cell: (e) => <StatusPill status={e.status} />, sortValue: (e) => e.status },
    {
      key: "funding",
      header: "Funded by",
      align: "right",
      hideBelow: "xl",
      cell: (e) => <span className="font-mono-num text-xs text-[var(--accent-hover)]">{e.treasuryDepositRef}</span>,
      sortValue: (e) => e.treasuryDepositRef,
    },
  ];

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Paid in window" value={totals.paid} decimals={2} prefix="₹" icon={<Receipt />} deltaLabel={`${filtered.filter((e) => e.status === "paid").length} settled entries`} compact />
        <StatTile label="Pending or queued" value={totals.pending} decimals={2} prefix="₹" icon={<Info />} deltaLabel="Awaiting KYC release or pool funding" compact />
        <StatTile label="Downline eligible spend" value={totals.spend} decimals={0} prefix="₹" icon={<Landmark />} deltaLabel="The real-money base your commission was calculated on" compact />
        <StatTile label="Lifetime earned" value={summary.earnedLifetime} decimals={2} prefix="₹" icon={<ShieldCheck />} deltaLabel="All levels, all time" compact />
      </div>

      <Callout tone="brand" title="Every line traces to the deposit that funded it" icon={<Landmark />} className="mt-5">
        <p className="mt-1">
          The <strong className="text-text-primary">Funded by</strong> column references the specific
          Treasury deposit — sourced from reconciled platform revenue — that paid each commission.
          Click any row to see the full derivation: the triggering revenue event, the rate applied,
          and the on-chain source event id. This is what makes the programme auditable rather than
          just asserted.
        </p>
      </Callout>

      {byTrigger.length > 0 && (
        <BarSeries
          className="mt-5"
          data={byTrigger}
          xKey="trigger"
          series={[{ key: "amount", label: "Commission earned (₹)" }]}
          title="Commission by triggering event type"
          description="Only these three real-money event types are eligible. Conversions, stakes and deposits never appear here."
          valueFormatter={(v) => `₹${formatToken(v)}`}
          height={200}
          horizontal
        />
      )}

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
        <Select
          className="w-full sm:w-44"
          value={level}
          onChange={(e) => setLevel(e.target.value)}
          options={[
            { value: "all", label: "All levels" },
            { value: "1", label: "Level 1 (8%)" },
            { value: "2", label: "Level 2 (3%)" },
            { value: "3", label: "Level 3 (1%)" },
          ]}
        />
        <SearchInput value={query} onValueChange={setQuery} placeholder="Reference, member or deposit…" className="w-full sm:max-w-xs" />
        <Button
          size="sm"
          variant="outline"
          className="sm:ml-auto"
          disabled={!filtered.length}
          icon={<Download className="size-3.5" />}
          onClick={() =>
            csvDownload(
              `members-trail-commission-${range}.csv`,
              filtered.map((e) => ({
                reference: e.id,
                date: e.date,
                downline: e.downlineLabel,
                level: e.level,
                triggering_event: TRIGGER_LABEL[e.triggerType],
                eligible_spend: e.eligibleSpend,
                rate_pct: e.rate * 100,
                commission: e.amount,
                status: e.status,
                treasury_deposit_ref: e.treasuryDepositRef,
                source_event_id: e.sourceEventId,
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
          keyOf={(e) => e.id}
          loading={isLoading}
          pageSize={12}
          onRowClick={setDetail}
          caption="Commission payout ledger with Treasury funding references"
          empty={{
            title: "No commission entries in this window",
            description: "Commission is only generated by a referred member's real-money spend.",
            action: <Button size="sm" onClick={() => { setRange("all"); setLevel("all"); setQuery(""); }}>Clear filters</Button>,
          }}
        />
      </div>

      {/* Detail */}
      <Modal
        open={!!detail}
        onClose={() => setDetail(null)}
        title="Commission derivation"
        description="Every input that produced this figure."
        icon={<Receipt className="size-5" />}
        size="md"
        footer={
          <>
            <Button
              variant="ghost"
              icon={<FileWarning className="size-3.5" />}
              onClick={() => { setDisputing(detail); setDetail(null); }}
            >
              Dispute this entry
            </Button>
            <Button onClick={() => setDetail(null)}>Close</Button>
          </>
        }
      >
        {detail && (
          <div className="space-y-4">
            <div className="rounded-xl border border-border-subtle bg-surface-inset px-4 py-1">
              <DetailRow label="Reference" mono value={detail.id} />
              <DetailRow label="Date" value={formatDate(detail.date, true)} />
              <DetailRow label="Downline member" value={detail.downlineLabel} />
              <DetailRow label="Level" value={<LevelBadge level={detail.level} />} />
              <DetailRow label="Status" value={<StatusPill status={detail.status} />} />
            </div>

            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
                The calculation
              </p>
              <div className="rounded-xl border border-border-subtle bg-surface-inset px-4 py-1">
                <DetailRow label="Triggering event" value={TRIGGER_LABEL[detail.triggerType]} />
                <DetailRow label="Eligible spend" value={`₹${formatToken(detail.eligibleSpend)}`} />
                <DetailRow label={`Level ${detail.level} rate`} value={`${(detail.rate * 100).toFixed(0)}%`} />
                <DetailRow
                  label="Commission"
                  value={<span className="text-[var(--accent-hover)]">₹{formatToken(detail.amount)}</span>}
                />
              </div>
              <p className="mt-2 text-xs leading-relaxed text-text-muted">
                ₹{formatToken(detail.eligibleSpend)} × {(detail.rate * 100).toFixed(0)}% = ₹
                {formatToken(detail.amount)}. The rate applies to net eligible revenue after processor
                fees, not gross.
              </p>
            </div>

            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
                Funding trace
              </p>
              <div className="rounded-xl border border-border-subtle bg-surface-inset px-4 py-1">
                <DetailRow label="Treasury deposit" mono value={detail.treasuryDepositRef} />
                <DetailRow label="On-chain source event" mono value={detail.sourceEventId} />
              </div>
            </div>

            <Callout tone="info" title="Why the status might be 'queued'" icon={<Info />}>
              <p className="mt-1">
                A commission only credits if the pool has enough funded balance at the moment of
                calculation. If it doesn&apos;t, the entry queues and pays once the next Treasury
                deposit lands. The distributor contract reverts rather than recording commission
                beyond what has been deposited.
              </p>
            </Callout>
          </div>
        )}
      </Modal>

      {/* Dispute */}
      <Modal
        open={!!disputing}
        onClose={() => { setDisputing(null); setDisputeText(""); }}
        title="Dispute a commission entry"
        description="This opens a support ticket routed to a compliance-trained agent."
        icon={<AlertTriangle className="size-5" />}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => { setDisputing(null); setDisputeText(""); }}>Cancel</Button>
            <Button
              disabled={disputeText.trim().length < 20}
              onClick={() => {
                toast.success("Dispute submitted", "Routed to compliance with SLA tracking. Check Support for updates.");
                setDisputing(null);
                setDisputeText("");
              }}
            >
              Submit dispute
            </Button>
          </>
        }
      >
        {disputing && (
          <div className="space-y-4">
            <div className="rounded-xl border border-border-subtle bg-surface-inset px-4 py-1">
              <DetailRow label="Entry" mono value={disputing.id} />
              <DetailRow label="Amount" value={`₹${formatToken(disputing.amount)}`} />
              <DetailRow label="Funded by" mono value={disputing.treasuryDepositRef} />
            </div>
            <Textarea
              label="What looks wrong?"
              required
              rows={5}
              value={disputeText}
              onChange={(e) => setDisputeText(e.target.value)}
              hint="Financial disputes are auto-routed to compliance-trained agents with SLA tracking, not general support."
              placeholder="Describe what you expected and what you see…"
              error={disputeText.length > 0 && disputeText.trim().length < 20 && "Please give us at least 20 characters."}
            />
          </div>
        )}
      </Modal>
    </>
  );
}
