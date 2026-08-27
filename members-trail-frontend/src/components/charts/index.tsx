"use client";

/* ============================================================================
 * Chart entry point — a lazy boundary in front of ./impl.
 *
 * WHY
 * ---
 * impl.tsx imports recharts, which is the single heaviest dependency in the
 * app. It was reached through components/ui/stat.tsx, which is re-exported from
 * the components/ui barrel that ~110 files import — so recharts was in the
 * first-load JS of essentially every route, including the ~20 that render no
 * chart at all.
 *
 * Splitting it here means recharts is fetched only when a chart is about to be
 * on screen, in parallel with the data it will plot, instead of blocking the
 * first paint of every page.
 *
 * The skeletons below reserve exactly the height the real chart will occupy
 * (`height` defaults match impl.tsx: 280 for frames, 36 for sparklines), so the
 * swap costs no layout shift.
 *
 * Each export is wrapped in memo(): the chart tree is expensive to reconcile and
 * its props are stable objects, so a parent re-render — hovering a stat tile,
 * a sibling query settling — must not re-render recharts.
 * ========================================================================== */

import dynamic from "next/dynamic";
import { memo } from "react";
import { cn } from "@/lib/utils";

export { SERIES_VARS, SEQ_VARS, seriesColor } from "./tokens";
export type { SeriesDef } from "./impl";

function FrameSkeleton({ height = 280 }: { height?: number }) {
  return (
    <div
      className="shimmer rounded-[var(--radius-card)] border border-border-subtle bg-surface-1"
      style={{ height: height + 64 }}
      aria-hidden
    />
  );
}

function SparkSkeleton({ height = 36, className }: { height?: number; className?: string }) {
  return <div className={cn("w-full", className)} style={{ height }} aria-hidden />;
}

const impl = () => import("./impl");

export const ChartFrame = memo(
  dynamic(() => impl().then((m) => m.ChartFrame), { ssr: false, loading: () => <FrameSkeleton /> }),
);

export const AreaTrend = memo(
  dynamic(() => impl().then((m) => m.AreaTrend), { ssr: false, loading: () => <FrameSkeleton /> }),
);

export const LineSeries = memo(
  dynamic(() => impl().then((m) => m.LineSeries), { ssr: false, loading: () => <FrameSkeleton /> }),
);

export const BarSeries = memo(
  dynamic(() => impl().then((m) => m.BarSeries), { ssr: false, loading: () => <FrameSkeleton /> }),
);

export const DonutBreakdown = memo(
  dynamic(() => impl().then((m) => m.DonutBreakdown), { ssr: false, loading: () => <FrameSkeleton /> }),
);

export const Sparkline = memo(
  dynamic(() => impl().then((m) => m.Sparkline), { ssr: false, loading: () => <SparkSkeleton /> }),
);
