"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Crown, Medal, Minus, Trophy, Users } from "lucide-react";
import {
  Avatar, Badge, Callout, DataTable, SegmentedControl, StatTile, type Column,
} from "@/components/ui";
import { Reveal } from "@/components/fx";
import { useLeaderboard } from "@/lib/hooks/use-data";
import { cn, formatCompact, formatNumber } from "@/lib/utils";
import type { LeaderboardEntry } from "@/types";
import { draw } from "../../../_components/derive";

type Period = "daily" | "weekly" | "alltime" | "friends";
type Metric = "points" | "staked" | "wins";

const METRIC_LABEL: Record<Metric, string> = {
  points: "Points earned",
  staked: "MTT staked",
  wins: "Tournament wins",
};

/**
 * The mock ledger holds one all-time Points board. Deriving the other views
 * deterministically from each entry's id keeps ranks stable across renders
 * while still showing a genuinely different board per filter.
 */
function project(rows: LeaderboardEntry[], period: Period, metric: Metric): LeaderboardEntry[] {
  const scale =
    metric === "staked" ? 0.42 : metric === "wins" ? 0.00026 : 1;
  const window =
    period === "daily" ? 0.035 : period === "weekly" ? 0.19 : period === "friends" ? 0.55 : 1;

  const projected = rows
    .filter((r) => (period === "friends" ? draw(`${r.userId}-friend`) > 0.55 || r.isCurrentUser : true))
    .map((r) => {
      const jitter = 0.72 + draw(`${r.userId}-${period}-${metric}`) * 0.56;
      const raw = r.metric * scale * window * jitter;
      return {
        ...r,
        metric: metric === "wins" ? Math.max(0, Math.round(raw)) : Math.round(raw),
        change: Math.round((draw(`${r.userId}-${period}-chg`) - 0.45) * 12),
      };
    })
    .sort((a, b) => b.metric - a.metric);

  return projected.map((r, i) => ({ ...r, rank: i + 1 }));
}

export function LeaderboardView() {
  const { data: base, isLoading } = useLeaderboard();
  const [period, setPeriod] = useState<Period>("weekly");
  const [metric, setMetric] = useState<Metric>("points");

  const rows = useMemo(() => project(base, period, metric), [base, period, metric]);
  const me = rows.find((r) => r.isCurrentUser);
  const podium = rows.slice(0, 3);

  const unit = metric === "staked" ? "MTT" : metric === "wins" ? "wins" : "pts";

  const columns: Column<LeaderboardEntry>[] = [
    {
      key: "rank",
      header: "Rank",
      cell: (r) => (
        <span className="inline-flex items-center gap-2">
          {r.rank <= 3 ? (
            <Medal
              className={cn(
                "size-4",
                r.rank === 1 && "text-[var(--series-4)]",
                r.rank === 2 && "text-text-muted",
                r.rank === 3 && "text-[var(--series-1)]",
              )}
            />
          ) : (
            <span className="size-4" />
          )}
          <span className={cn("tnum", r.isCurrentUser ? "font-semibold text-[var(--accent-hover)]" : "text-text-secondary")}>
            {r.rank}
          </span>
        </span>
      ),
      sortValue: (r) => r.rank,
    },
    {
      key: "player",
      header: "Player",
      cell: (r) => (
        <span className="flex items-center gap-2.5">
          <Avatar name={r.displayName} size="xs" ring={r.isCurrentUser} />
          <span className={cn("truncate", r.isCurrentUser ? "font-semibold text-text-primary" : "text-text-secondary")}>
            {r.displayName}
          </span>
          {r.isCurrentUser && <Badge tone="brand">You</Badge>}
        </span>
      ),
      sortValue: (r) => r.displayName,
    },
    {
      key: "metric",
      header: METRIC_LABEL[metric],
      align: "right",
      cell: (r) => (
        <span className="tnum font-medium text-text-primary">
          {formatNumber(r.metric)} <span className="text-xs font-normal text-text-muted">{unit}</span>
        </span>
      ),
      sortValue: (r) => r.metric,
    },
    {
      key: "change",
      header: "Change",
      align: "right",
      hideBelow: "sm",
      cell: (r) => {
        const Icon = r.change === 0 ? Minus : r.change > 0 ? ArrowUp : ArrowDown;
        return (
          <span
            className={cn(
              "tnum inline-flex items-center gap-1 text-xs font-semibold",
              r.change === 0 ? "text-text-muted" : r.change > 0 ? "text-good-400" : "text-critical-400",
            )}
          >
            <Icon className="size-3" />
            {r.change === 0 ? "—" : Math.abs(r.change)}
          </span>
        );
      },
      sortValue: (r) => r.change,
    },
  ];

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl
          value={period}
          onValueChange={setPeriod}
          options={[
            { value: "daily", label: "Daily" },
            { value: "weekly", label: "Weekly" },
            { value: "alltime", label: "All-time" },
            { value: "friends", label: "Friends", icon: <Users className="size-3.5" /> },
          ]}
        />
        <SegmentedControl
          value={metric}
          onValueChange={setMetric}
          size="sm"
          options={[
            { value: "points", label: "Points" },
            { value: "staked", label: "MTT staked" },
            { value: "wins", label: "Wins" },
          ]}
        />
      </div>

      {/* Your rank, pinned above the table */}
      <div className="mt-5 grid gap-4 sm:grid-cols-3">
        <StatTile
          tone="brand"
          label="Your rank"
          value={me ? `#${me.rank}` : "Unranked"}
          icon={<Trophy />}
          deltaLabel={me ? `of ${formatNumber(rows.length)} ranked players` : "Play a session to enter the board"}
          delta={me?.change}
          compact
        />
        <StatTile
          label={METRIC_LABEL[metric]}
          value={me?.metric ?? 0}
          suffix={` ${unit}`}
          icon={<Medal />}
          deltaLabel={`This ${period === "alltime" ? "all-time total" : period === "friends" ? "friends board" : period + " window"}`}
          compact
        />
        <StatTile
          label="Gap to next rank"
          value={
            me && me.rank > 1
              ? (rows[me.rank - 2]?.metric ?? me.metric) - me.metric
              : 0
          }
          suffix={` ${unit}`}
          icon={<ArrowUp />}
          deltaLabel={me && me.rank > 1 ? `To overtake #${me.rank - 1}` : "You're at the top"}
          compact
        />
      </div>

      {/* Podium */}
      {!isLoading && podium.length === 3 && (
        <Reveal className="mt-6">
          <div className="grid gap-3 sm:grid-cols-3">
            {[podium[1], podium[0], podium[2]].map((r) => {
              const first = r.rank === 1;
              return (
                <div
                  key={r.userId}
                  className={cn(
                    "relative overflow-hidden rounded-[var(--radius-card)] border bg-surface-1 p-5 text-center",
                    first
                      ? "border-[var(--accent-ring)] glow-brand sm:-mt-3 sm:pb-8"
                      : "border-border-subtle",
                  )}
                >
                  {first && <Crown className="mx-auto mb-2 size-5 text-[var(--series-4)]" />}
                  <Avatar name={r.displayName} size={first ? "lg" : "md"} className="mx-auto" ring={r.isCurrentUser} />
                  <p className="mt-3 truncate text-sm font-semibold text-text-primary">{r.displayName}</p>
                  <p className="tnum mt-1 text-xs text-text-muted">
                    {formatCompact(r.metric)} {unit}
                  </p>
                  <span
                    className={cn(
                      "mt-3 inline-flex size-7 items-center justify-center rounded-full text-xs font-bold",
                      first ? "bg-[var(--accent)] text-white" : "bg-surface-3 text-text-secondary",
                    )}
                  >
                    {r.rank}
                  </span>
                </div>
              );
            })}
          </div>
        </Reveal>
      )}

      <div className="mt-6 overflow-hidden rounded-[var(--radius-card)] border border-border-subtle bg-surface-1">
        <DataTable
          columns={columns}
          rows={rows}
          keyOf={(r) => r.userId}
          loading={isLoading}
          pageSize={12}
          caption={`${METRIC_LABEL[metric]} leaderboard, ${period} window`}
          empty={{
            title: "No ranked players in this view",
            description: "Try a different period, or add friends to populate the friends board.",
          }}
        />
      </div>

      <Callout tone="info" title="How ranking works" icon={<Trophy />} className="mt-6">
        <p className="mt-1">
          Every entrant plays the same seeded board under the same rules, and scores are recomputed
          server-side before they count — so the board reflects skill, not client-side advantage.
          Ranks refresh a few minutes behind live play. Daily and weekly windows reset at 00:00 UTC.
        </p>
      </Callout>
    </>
  );
}
