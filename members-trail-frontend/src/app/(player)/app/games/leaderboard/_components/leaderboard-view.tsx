"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, Crown, Medal, Minus, TriangleAlert, Trophy } from "lucide-react";
import {
  Avatar, Badge, Callout, DataTable, SegmentedControl, StatTile, type Column,
} from "@/components/ui";
import { Reveal } from "@/components/fx";
import { useLeaderboard } from "@/lib/hooks/use-data";
import { humanMessage } from "@/lib/api/errors";
import { cn, formatCompact, formatNumber } from "@/lib/utils";
import type { LeaderboardEntry } from "@/types";

/* The UI's period/metric labels are a thin display layer over the exact
 * values the `/leaderboard` endpoint accepts (`LEADERBOARD_PERIODS` /
 * `LEADERBOARD_METRICS` in the API's leaderboard DTO). There is no "Friends"
 * board or "MTT staked" metric on the server — earlier revisions of this view
 * faked both by scaling and jittering the one real (points, weekly) response
 * client-side, which silently re-ranked players on invented numbers. Every
 * tab below now maps to a period/metric the server actually computes; there
 * is nothing left to project. */
type Period = "daily" | "weekly" | "alltime";
type Metric = "points" | "score" | "wins";

const BACKEND_PERIOD: Record<Period, "daily" | "weekly" | "all_time"> = {
  daily: "daily",
  weekly: "weekly",
  alltime: "all_time",
};

const METRIC_LABEL: Record<Metric, string> = {
  points: "Points earned",
  score: "Game score",
  wins: "Tournament wins",
};

export function LeaderboardView() {
  const [period, setPeriod] = useState<Period>("weekly");
  const [metric, setMetric] = useState<Metric>("points");
  const { data: rows, isLoading, error } = useLeaderboard(metric, BACKEND_PERIOD[period]);

  const me = rows.find((r) => r.isCurrentUser);
  const podium = rows.slice(0, 3);

  const unit = metric === "wins" ? "wins" : "pts";

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
          ]}
        />
        <SegmentedControl
          value={metric}
          onValueChange={setMetric}
          size="sm"
          options={[
            { value: "points", label: "Points" },
            { value: "score", label: "Score" },
            { value: "wins", label: "Wins" },
          ]}
        />
      </div>

      {error && (
        <Callout tone="critical" title="Couldn't load the leaderboard" icon={<TriangleAlert />} className="mt-5">
          <p className="mt-1">{humanMessage(error)}</p>
        </Callout>
      )}

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
          deltaLabel={`This ${period === "alltime" ? "all-time total" : period + " window"}`}
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
            description: "Play a session to be the first one on the board.",
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
