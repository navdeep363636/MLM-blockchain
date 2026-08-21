"use client";

import { useMemo, useState } from "react";
import {
  ArrowDownLeft, ArrowUpRight, Award, CalendarRange, Download, Repeat, Sparkles, TrendingUp,
} from "lucide-react";
import {
  Badge, Button, Callout, DataTable, SearchInput, SegmentedControl, Select,
  StatTile, type Column,
} from "@/components/ui";
import { AreaTrend } from "@/components/charts";
import { usePointsHistory } from "@/lib/hooks/use-data";
import { cn, csvDownload, formatDate, formatNumber } from "@/lib/utils";
import type { PointsEntry } from "@/types";
import { POINTS_SOURCE_LABEL, bestDay, pointsPerDay } from "../../../_components/derive";
import { RelativeTime, useReferenceNow } from "../../../_components/time";

type Range = "7d" | "30d" | "90d" | "all";

const RANGE_DAYS: Record<Range, number> = { "7d": 7, "30d": 30, "90d": 90, all: 100_000 };

const SOURCE_TONE: Record<PointsEntry["source"], "brand" | "good" | "info" | "warning" | "neutral" | "serious"> = {
  gameplay: "brand",
  quest: "good",
  ad: "info",
  tournament: "warning",
  purchase: "serious",
  referral_bonus: "neutral",
  conversion: "neutral",
};

export function PointsHistoryView() {
  const { data: entries, isLoading } = usePointsHistory();
  const referenceNow = useReferenceNow();

  const [range, setRange] = useState<Range>("30d");
  const [source, setSource] = useState("all");
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const cutoff = referenceNow - RANGE_DAYS[range] * 86_400_000;
    const needle = query.trim().toLowerCase();
    return entries.filter((e) => {
      if (Date.parse(e.date) < cutoff) return false;
      if (source !== "all" && e.source !== source) return false;
      if (needle) {
        const hay = `${e.id} ${e.gameTitle ?? ""} ${POINTS_SOURCE_LABEL[e.source]} ${e.note ?? ""}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [entries, range, source, query, referenceNow]);

  const totals = useMemo(() => {
    const earned = filtered.filter((e) => e.amount > 0).reduce((s, e) => s + e.amount, 0);
    const converted = filtered.filter((e) => e.amount < 0).reduce((s, e) => s + Math.abs(e.amount), 0);
    return { earned, converted, net: earned - converted };
  }, [filtered]);

  const best = useMemo(() => bestDay(filtered), [filtered]);
  const trend = useMemo(
    () => pointsPerDay(entries, range === "7d" ? 7 : range === "90d" ? 90 : 30),
    [entries, range],
  );

  const columns: Column<PointsEntry>[] = [
    {
      key: "date",
      header: "Date",
      cell: (e) => (
        <span className="whitespace-nowrap">
          <span className="tnum block text-text-primary">{formatDate(e.date, true)}</span>
          <span className="block text-xs text-text-muted"><RelativeTime date={e.date} /></span>
        </span>
      ),
      sortValue: (e) => e.date,
    },
    {
      key: "source",
      header: "Source",
      cell: (e) => <Badge tone={SOURCE_TONE[e.source]}>{POINTS_SOURCE_LABEL[e.source]}</Badge>,
      sortValue: (e) => e.source,
    },
    {
      key: "detail",
      header: "Detail",
      hideBelow: "md",
      cell: (e) => (
        <span className="text-text-secondary">{e.gameTitle ?? e.note ?? "—"}</span>
      ),
    },
    {
      key: "amount",
      header: "Points",
      align: "right",
      cell: (e) => (
        <span
          className={cn(
            "tnum inline-flex items-center gap-1 font-semibold",
            e.amount >= 0 ? "text-good-400" : "text-text-secondary",
          )}
        >
          {e.amount >= 0 ? <ArrowUpRight className="size-3" /> : <ArrowDownLeft className="size-3" />}
          {e.amount >= 0 ? "+" : "−"}{formatNumber(Math.abs(e.amount))}
        </span>
      ),
      sortValue: (e) => e.amount,
    },
    {
      key: "balance",
      header: "Running balance",
      align: "right",
      hideBelow: "lg",
      cell: (e) => <span className="tnum text-text-muted">{formatNumber(e.runningBalance)}</span>,
      sortValue: (e) => e.runningBalance,
    },
    {
      key: "id",
      header: "Ref",
      align: "right",
      hideBelow: "xl",
      cell: (e) => <span className="font-mono-num text-xs text-text-muted">{e.id}</span>,
    },
  ];

  const exportCsv = () => {
    csvDownload(
      `members-trail-points-${range}.csv`,
      filtered.map((e) => ({
        reference: e.id,
        date: e.date,
        source: POINTS_SOURCE_LABEL[e.source],
        detail: e.gameTitle ?? e.note ?? "",
        points: e.amount,
        running_balance: e.runningBalance,
      })),
    );
  };

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Points earned"
          value={totals.earned}
          icon={<Sparkles />}
          deltaLabel={`Across ${filtered.filter((e) => e.amount > 0).length} credits in this window`}
          compact
        />
        <StatTile
          label="Converted to MTT"
          value={totals.converted}
          icon={<Repeat />}
          deltaLabel="Shown as negative entries in the ledger"
          compact
        />
        <StatTile
          label="Net change"
          value={totals.net}
          icon={<TrendingUp />}
          deltaLabel="Earned minus converted out"
          compact
          tone={totals.net >= 0 ? "brand" : "default"}
        />
        <StatTile
          label="Best day"
          value={best ? best.earned : 0}
          icon={<Award />}
          deltaLabel={best ? `On ${formatDate(best.day)}` : "No credits in this window"}
          compact
        />
      </div>

      <AreaTrend
        className="mt-5"
        data={trend}
        xKey="day"
        series={[{ key: "points", label: "Points earned" }]}
        title="Points earned per day"
        description="Credits only — conversions out are excluded so the shape reflects earning, not spending."
        valueFormatter={(v) => `${formatNumber(v)} pts`}
        height={220}
        footnote="Server-validated sessions only. A session rejected by the Game Result Validator never appears here."
      />

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <SegmentedControl
          value={range}
          onValueChange={setRange}
          size="sm"
          options={[
            { value: "7d", label: "7 days" },
            { value: "30d", label: "30 days" },
            { value: "90d", label: "90 days" },
            { value: "all", label: "All time", icon: <CalendarRange className="size-3.5" /> },
          ]}
        />
        <Select
          className="w-full sm:w-52"
          value={source}
          onChange={(e) => setSource(e.target.value)}
          options={[
            { value: "all", label: "All sources" },
            ...Object.entries(POINTS_SOURCE_LABEL).map(([v, l]) => ({ value: v, label: l })),
          ]}
        />
        <SearchInput
          value={query}
          onValueChange={setQuery}
          placeholder="Search game, note or reference…"
          className="w-full sm:max-w-xs"
        />
        <Button
          size="sm"
          variant="outline"
          onClick={exportCsv}
          disabled={filtered.length === 0}
          icon={<Download className="size-3.5" />}
          className="sm:ml-auto"
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
          pageSize={15}
          caption="Complete Points earning and conversion ledger"
          empty={{
            title: "No entries in this window",
            description: "Widen the date range or clear the source filter.",
            action: <Button size="sm" onClick={() => { setRange("all"); setSource("all"); setQuery(""); }}>Clear filters</Button>,
          }}
        />
      </div>

      <Callout tone="info" title="Why some sessions don't appear" icon={<Sparkles />} className="mt-6">
        <p className="mt-1">
          Points are credited only after the backend recomputes your session result server-side. A
          session that disconnects before its result is signed, or that fails validation, is rejected
          and never reaches this ledger. If you believe a session was wrongly rejected, open a support
          ticket with the approximate time and the game — agents can inspect the raw session record.
        </p>
      </Callout>
    </>
  );
}
