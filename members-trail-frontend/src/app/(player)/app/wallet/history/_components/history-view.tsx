"use client";

import { useMemo, useState } from "react";
import {
  ArrowDownLeft, ArrowUpRight, Download, ExternalLink, FileText, Link2, Receipt, ShieldCheck,
} from "lucide-react";
import {
  Badge, Button, Callout, DataTable, DetailRow, Modal, SearchInput, SegmentedControl,
  Select, StatTile, StatusPill, type Column,
} from "@/components/ui";
import { useBalances, useTransactions } from "@/lib/hooks/use-data";
import { MTT_SYMBOL, txUrl } from "@/lib/web3";
import { cn, csvDownload, formatCurrency, formatDate, formatToken, shortenHash } from "@/lib/utils";
import type { Transaction, TxType } from "@/types";
import { RelativeTime, useReferenceNow } from "../../../_components/time";

const TYPE_LABEL: Record<TxType, string> = {
  conversion: "Points conversion",
  stake: "Stake",
  unstake: "Unstake",
  reward_claim: "Staking reward claim",
  commission_claim: "Commission claim",
  deposit: "Deposit",
  withdrawal: "Withdrawal",
  store_purchase: "Store purchase",
  marketplace_sale: "Marketplace sale",
  tournament_entry: "Tournament entry",
};

const TYPE_TONE: Record<TxType, "brand" | "good" | "info" | "warning" | "neutral" | "serious"> = {
  conversion: "brand",
  stake: "info",
  unstake: "info",
  reward_claim: "good",
  commission_claim: "good",
  deposit: "neutral",
  withdrawal: "warning",
  store_purchase: "serious",
  marketplace_sale: "neutral",
  tournament_entry: "warning",
};

type Range = "30d" | "90d" | "1y" | "all";
const RANGE_DAYS: Record<Range, number> = { "30d": 30, "90d": 90, "1y": 365, all: 100_000 };

export function HistoryView() {
  const { data: txs, isLoading } = useTransactions();
  const { data: balances } = useBalances();
  const referenceNow = useReferenceNow();

  const [range, setRange] = useState<Range>("90d");
  const [type, setType] = useState("all");
  const [status, setStatus] = useState("all");
  const [query, setQuery] = useState("");
  const [detail, setDetail] = useState<Transaction | null>(null);

  const filtered = useMemo(() => {
    const cutoff = referenceNow - RANGE_DAYS[range] * 86_400_000;
    const needle = query.trim().toLowerCase();
    return txs.filter((t) => {
      if (Date.parse(t.date) < cutoff) return false;
      if (type !== "all" && t.type !== type) return false;
      if (status !== "all" && t.status !== status) return false;
      if (needle) {
        const hay = `${t.id} ${TYPE_LABEL[t.type]} ${t.txHash ?? ""} ${t.sourceTag ?? ""}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [txs, range, type, status, query, referenceNow]);

  const totals = useMemo(() => {
    const inflow = filtered.filter((t) => t.amountMtt > 0).reduce((s, t) => s + t.amountMtt, 0);
    const outflow = filtered.filter((t) => t.amountMtt < 0).reduce((s, t) => s + Math.abs(t.amountMtt), 0);
    const onChain = filtered.filter((t) => t.txHash).length;
    return { inflow, outflow, net: inflow - outflow, onChain };
  }, [filtered]);

  const columns: Column<Transaction>[] = [
    {
      key: "date",
      header: "Date",
      cell: (t) => (
        <span className="whitespace-nowrap">
          <span className="tnum block text-text-primary">{formatDate(t.date, true)}</span>
          <span className="block text-xs text-text-muted"><RelativeTime date={t.date} /></span>
        </span>
      ),
      sortValue: (t) => t.date,
    },
    {
      key: "type",
      header: "Type",
      cell: (t) => <Badge tone={TYPE_TONE[t.type]}>{TYPE_LABEL[t.type]}</Badge>,
      sortValue: (t) => TYPE_LABEL[t.type],
    },
    {
      key: "amount",
      header: MTT_SYMBOL,
      align: "right",
      cell: (t) => (
        <span
          className={cn(
            "tnum inline-flex items-center gap-1 font-semibold",
            t.amountMtt >= 0 ? "text-good-400" : "text-text-secondary",
          )}
        >
          {t.amountMtt >= 0 ? <ArrowUpRight className="size-3" /> : <ArrowDownLeft className="size-3" />}
          {t.amountMtt >= 0 ? "+" : "−"}{formatToken(Math.abs(t.amountMtt))}
        </span>
      ),
      sortValue: (t) => t.amountMtt,
    },
    {
      key: "fiat",
      header: "Value",
      align: "right",
      hideBelow: "lg",
      cell: (t) => (
        <span className="tnum text-text-muted">
          {t.amountFiat != null ? formatCurrency(t.amountFiat) : formatCurrency(Math.abs(t.amountMtt) * balances.usdRate)}
        </span>
      ),
      sortValue: (t) => t.amountFiat ?? Math.abs(t.amountMtt),
    },
    { key: "status", header: "Status", cell: (t) => <StatusPill status={t.status} />, sortValue: (t) => t.status },
    {
      key: "proof",
      header: "On-chain",
      align: "right",
      hideBelow: "md",
      cell: (t) =>
        t.txHash ? (
          <a
            href={txUrl(t.txHash)}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="font-mono-num inline-flex items-center gap-1 text-xs text-[var(--accent-hover)] hover:underline"
          >
            {shortenHash(t.txHash)}
            <ExternalLink className="size-3" />
          </a>
        ) : (
          <span className="text-xs text-text-muted">off-chain</span>
        ),
    },
  ];

  const exportCsv = () => {
    csvDownload(
      `members-trail-transactions-${range}.csv`,
      filtered.map((t) => ({
        reference: t.id,
        date: t.date,
        type: TYPE_LABEL[t.type],
        mtt_amount: t.amountMtt,
        fiat_amount: t.amountFiat ?? "",
        status: t.status,
        source_tag: t.sourceTag ?? "",
        tx_hash: t.txHash ?? "",
      })),
    );
  };

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label={`${MTT_SYMBOL} in`} value={totals.inflow} decimals={2} icon={<ArrowUpRight />} deltaLabel="Conversions, rewards, claims, sales" compact />
        <StatTile label={`${MTT_SYMBOL} out`} value={totals.outflow} decimals={2} icon={<ArrowDownLeft />} deltaLabel="Stakes, purchases, withdrawals, entries" compact />
        <StatTile label="Net movement" value={totals.net} decimals={2} icon={<Receipt />} deltaLabel="In minus out for this window" compact tone={totals.net >= 0 ? "brand" : "default"} />
        <StatTile label="Verifiable on-chain" value={totals.onChain} icon={<Link2 />} deltaLabel={`of ${filtered.length} entries carry a tx hash`} compact />
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <SegmentedControl
          value={range}
          onValueChange={setRange}
          size="sm"
          options={[
            { value: "30d", label: "30d" },
            { value: "90d", label: "90d" },
            { value: "1y", label: "1 year" },
            { value: "all", label: "All" },
          ]}
        />
        <Select
          className="w-full sm:w-56"
          value={type}
          onChange={(e) => setType(e.target.value)}
          options={[{ value: "all", label: "All types" }, ...Object.entries(TYPE_LABEL).map(([v, l]) => ({ value: v, label: l }))]}
        />
        <Select
          className="w-full sm:w-44"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          options={[
            { value: "all", label: "Any status" },
            { value: "completed", label: "Completed" },
            { value: "pending", label: "Pending" },
            { value: "processing", label: "Processing" },
            { value: "failed", label: "Failed" },
          ]}
        />
        <SearchInput value={query} onValueChange={setQuery} placeholder="Reference or tx hash…" className="w-full sm:max-w-xs" />
        <div className="flex gap-2 sm:ml-auto">
          <Button size="sm" variant="outline" onClick={exportCsv} disabled={!filtered.length} icon={<Download className="size-3.5" />}>
            CSV
          </Button>
          <Button size="sm" variant="ghost" onClick={() => window.print()} icon={<FileText className="size-3.5" />}>
            Statement
          </Button>
        </div>
      </div>

      <div className="mt-4 overflow-hidden rounded-[var(--radius-card)] border border-border-subtle bg-surface-1">
        <DataTable
          columns={columns}
          rows={filtered}
          keyOf={(t) => t.id}
          loading={isLoading}
          pageSize={15}
          onRowClick={setDetail}
          caption="Complete financial activity ledger with on-chain proof"
          empty={{
            title: "No transactions in this view",
            description: "Widen the date range or clear the type and status filters.",
            action: <Button size="sm" onClick={() => { setRange("all"); setType("all"); setStatus("all"); setQuery(""); }}>Clear filters</Button>,
          }}
        />
      </div>

      <Callout tone="info" title="Verify anything here independently" icon={<ShieldCheck />} className="mt-6">
        <p className="mt-1">
          Every on-chain event carries its transaction hash and links straight to BscScan. Conversions,
          stakes, unstakes, reward claims, commission claims and MTT withdrawals are all verifiable
          without taking our word for it. Deposits and store purchases are off-chain ledger entries,
          reconciled against the payment processor.
        </p>
      </Callout>

      <Modal
        open={!!detail}
        onClose={() => setDetail(null)}
        title="Transaction detail"
        icon={<Receipt className="size-5" />}
        size="sm"
        footer={
          <>
            {detail?.txHash && (
              <Button variant="ghost" href={txUrl(detail.txHash)} iconRight={<ExternalLink className="size-3.5" />}>
                View on BscScan
              </Button>
            )}
            <Button onClick={() => setDetail(null)}>Close</Button>
          </>
        }
      >
        {detail && (
          <div className="space-y-4">
            <div className="rounded-xl border border-border-subtle bg-surface-inset px-4 py-1">
              <DetailRow label="Reference" mono value={detail.id} />
              <DetailRow label="Type" value={TYPE_LABEL[detail.type]} />
              <DetailRow label="Date" value={formatDate(detail.date, true)} />
              <DetailRow
                label={`${MTT_SYMBOL} amount`}
                value={
                  <span className={detail.amountMtt >= 0 ? "text-good-400" : "text-text-primary"}>
                    {detail.amountMtt >= 0 ? "+" : "−"}{formatToken(Math.abs(detail.amountMtt))}
                  </span>
                }
              />
              {detail.amountFiat != null && <DetailRow label="Fiat value" value={formatCurrency(detail.amountFiat)} />}
              <DetailRow label="Status" value={<StatusPill status={detail.status} />} />
              {detail.sourceTag && <DetailRow label="AML source tag" value={detail.sourceTag} />}
              {detail.txHash && <DetailRow label="Transaction hash" mono value={shortenHash(detail.txHash)} />}
            </div>
            {detail.status === "failed" && (
              <Callout tone="critical" title="This transaction failed">
                <p className="mt-1">
                  No funds moved. Failed on-chain transactions still consume gas, which the platform
                  absorbed. If you expected this to succeed, open a support ticket with the reference.
                </p>
              </Callout>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}
