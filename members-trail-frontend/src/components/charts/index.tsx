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
 *
 * AND ONLY WHEN THE CHART IS ACTUALLY NEAR THE VIEWPORT
 * ----------------------------------------------------
 * `dynamic()` alone still starts the import the moment the component renders,
 * which on a dashboard means every chart on the page at once, during the busiest
 * moment of the page's life. Profiled on a 4x-throttled cold /admin, recharts
 * accounted for 470ms of main-thread time inside the first second — while the
 * page's own data requests were still queued behind it.
 *
 * So each export is additionally gated on an IntersectionObserver with a screen
 * of margin. A chart already on screen still loads immediately (the observer
 * fires for an intersecting element on its first callback), one below the fold
 * loads as it is scrolled towards, and one the reader never reaches costs
 * nothing. The skeleton reserves the chart's height either way, so gating adds
 * no layout shift over what `dynamic()`'s own loading state already did.
 * ========================================================================== */

import dynamic from "next/dynamic";
import { memo, useEffect, useRef, useState, type ComponentType } from "react";
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

/* Enough margin that a scroll reaches a drawn chart rather than a skeleton, but
   not so much that a 900px-tall dashboard counts every chart on the page as
   "near" and loads recharts for all of them during hydration anyway. */
const NEAR_VIEWPORT = "300px 0px";

/**
 * Renders `placeholder` until the slot is within a screen of the viewport, then
 * the chart. Falls back to rendering immediately where IntersectionObserver is
 * missing — a chart that never appears is a worse failure than one that costs.
 */
function whenNearViewport<P extends object>(
  Chart: ComponentType<P>,
  Placeholder: ComponentType<{ height?: number; className?: string }>,
) {
  function Gated(props: P & { height?: number; className?: string }) {
    const [show, setShow] = useState(false);
    const slot = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
      if (show) return;
      const el = slot.current;
      if (!el || typeof IntersectionObserver === "undefined") {
        setShow(true);
        return;
      }
      const io = new IntersectionObserver(
        (entries) => {
          if (entries.some((e) => e.isIntersecting)) {
            setShow(true);
            io.disconnect();
          }
        },
        { rootMargin: NEAR_VIEWPORT },
      );
      io.observe(el);
      return () => io.disconnect();
    }, [show]);

    if (show) return <Chart {...(props as P)} />;
    return (
      <div ref={slot}>
        <Placeholder height={props.height} className={props.className} />
      </div>
    );
  }
  Gated.displayName = `NearViewport(${Chart.displayName ?? Chart.name ?? "Chart"})`;
  return Gated;
}

export const ChartFrame = memo(
  whenNearViewport(
    dynamic(() => impl().then((m) => m.ChartFrame), { ssr: false, loading: () => <FrameSkeleton /> }),
    FrameSkeleton,
  ),
);

export const AreaTrend = memo(
  whenNearViewport(
    dynamic(() => impl().then((m) => m.AreaTrend), { ssr: false, loading: () => <FrameSkeleton /> }),
    FrameSkeleton,
  ),
);

export const LineSeries = memo(
  whenNearViewport(
    dynamic(() => impl().then((m) => m.LineSeries), { ssr: false, loading: () => <FrameSkeleton /> }),
    FrameSkeleton,
  ),
);

export const BarSeries = memo(
  whenNearViewport(
    dynamic(() => impl().then((m) => m.BarSeries), { ssr: false, loading: () => <FrameSkeleton /> }),
    FrameSkeleton,
  ),
);

export const DonutBreakdown = memo(
  whenNearViewport(
    dynamic(() => impl().then((m) => m.DonutBreakdown), { ssr: false, loading: () => <FrameSkeleton /> }),
    FrameSkeleton,
  ),
);

export const Sparkline = memo(
  whenNearViewport(
    dynamic(() => impl().then((m) => m.Sparkline), { ssr: false, loading: () => <SparkSkeleton /> }),
    SparkSkeleton,
  ),
);
