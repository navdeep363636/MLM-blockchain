"use client";

/* Deterministic time rendering for the player app.
 *
 * Nothing here reads the wall clock during render: the reference instant is
 * derived from the newest record in the ledger, so the server and the client
 * agree on the first paint. A mount-time offset is added afterwards so
 * countdowns still tick without ever risking a hydration mismatch. */

import { useEffect, useMemo, useState } from "react";
import { usePointsHistory, useTransactions } from "@/lib/hooks/use-data";
import { REFERENCE_NOW, cn, formatDate, formatDuration } from "@/lib/utils";

/** True only after the first client render. */
export function useMounted() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}

/** The newest timestamp present in the ledger — our "now". */
export function useReferenceNow(): number {
  const { data: points } = usePointsHistory();
  const { data: txs } = useTransactions();

  return useMemo(() => {
    let max = 0;
    for (const p of points) max = Math.max(max, Date.parse(p.date));
    for (const t of txs) max = Math.max(max, Date.parse(t.date));
    // Fall back to the shared reference if the ledger is empty, so relative
    // times never collapse to the epoch.
    return max || REFERENCE_NOW;
  }, [points, txs]);
}

/** Reference instant plus real elapsed time since mount. Ticks, never mismatches. */
export function useLiveNow(tickMs = 1000): number {
  const reference = useReferenceNow();
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const start = Date.now();
    const id = window.setInterval(() => setElapsed(Date.now() - start), tickMs);
    return () => window.clearInterval(id);
  }, [tickMs]);

  return reference + elapsed;
}

/** "3 hrs ago", measured against an explicit reference instant. */
export function agoFrom(date: string, referenceMs: number) {
  const seconds = Math.floor((referenceMs - Date.parse(date)) / 1000);
  if (seconds < 60) return "just now";
  const units: [number, string][] = [
    [60, "min"], [3600, "hr"], [86400, "day"], [604800, "wk"], [2592000, "mo"], [31536000, "yr"],
  ];
  let prev = 1;
  for (const [limit, label] of units) {
    if (seconds < limit) {
      const v = Math.floor(seconds / prev);
      return `${v} ${label}${v > 1 ? "s" : ""} ago`;
    }
    prev = limit;
  }
  const years = Math.floor(seconds / 31536000);
  return `${years} yr${years > 1 ? "s" : ""} ago`;
}

export function RelativeTime({ date, className }: { date: string; className?: string }) {
  const reference = useReferenceNow();
  return (
    <time dateTime={date} title={formatDate(date, true)} className={cn("whitespace-nowrap", className)}>
      {agoFrom(date, reference)}
    </time>
  );
}

/** Countdown to a future instant. Falls back to a label once it elapses. */
export function Countdown({
  to, prefix, elapsedLabel = "Ended", className,
}: {
  to: string;
  prefix?: string;
  elapsedLabel?: string;
  className?: string;
}) {
  const now = useLiveNow(1000);
  const seconds = Math.floor((Date.parse(to) - now) / 1000);

  if (seconds <= 0) {
    return <span className={cn("whitespace-nowrap", className)}>{elapsedLabel}</span>;
  }
  return (
    <span className={cn("tnum whitespace-nowrap", className)} title={formatDate(to, true)}>
      {prefix}{formatDuration(seconds)}
    </span>
  );
}
