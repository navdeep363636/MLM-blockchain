"use client";

/* Threshold gauge — the payout-ratio / utilisation instrument.
 *
 * Amber at >= 75%, red at >= 90%, and a hard ceiling marker at 100%. Status
 * colour is reserved, so it always ships with an icon and a text label. */

import { AlertTriangle, CheckCircle2, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";

export type ThresholdTone = "good" | "warning" | "critical";

export function thresholdTone(pct: number, warnAt = 75, critAt = 90): ThresholdTone {
  return pct >= critAt ? "critical" : pct >= warnAt ? "warning" : "good";
}

export const THRESHOLD_VAR: Record<ThresholdTone, string> = {
  good: "var(--color-good-500)",
  warning: "var(--color-warning-500)",
  critical: "var(--color-critical-500)",
};

const meta: Record<ThresholdTone, { label: string; text: string; bar: string; chip: string; Icon: typeof CheckCircle2 }> = {
  good: {
    label: "Within safe band",
    text: "text-good-400",
    bar: "bg-good-500",
    chip: "bg-good-500/12 text-good-400 ring-good-500/30",
    Icon: CheckCircle2,
  },
  warning: {
    label: "Approaching limit",
    text: "text-warning-400",
    bar: "bg-warning-500",
    chip: "bg-warning-500/12 text-warning-400 ring-warning-500/30",
    Icon: AlertTriangle,
  },
  critical: {
    label: "Breach imminent",
    text: "text-critical-400",
    bar: "bg-critical-500",
    chip: "bg-critical-500/12 text-critical-400 ring-critical-500/30",
    Icon: ShieldAlert,
  },
};

export function ThresholdGauge({
  value, ceiling = 100, warnAt = 75, critAt = 90, label, sublabel, statusLabel,
  className, size = "md", showScale = true,
}: {
  /** Current value, on the same scale as `ceiling` (percentages by default). */
  value: number;
  ceiling?: number;
  warnAt?: number;
  critAt?: number;
  label?: React.ReactNode;
  sublabel?: React.ReactNode;
  /** Override the derived status wording. */
  statusLabel?: string;
  className?: string;
  size?: "sm" | "md" | "lg";
  showScale?: boolean;
}) {
  const tone = thresholdTone(value, warnAt, critAt);
  const m = meta[tone];
  const pct = Math.max(0, Math.min(100, (value / ceiling) * 100));
  const num = size === "lg" ? "text-4xl" : size === "sm" ? "text-xl" : "text-2xl";
  const track = size === "lg" ? "h-4" : size === "sm" ? "h-2" : "h-3";

  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          {label && <p className="text-xs font-medium uppercase tracking-wider text-text-muted">{label}</p>}
          <p className={cn("font-display mt-1 font-semibold tracking-tight tnum", num, m.text)}>
            {value.toFixed(1)}
            <span className="ml-1 text-base font-medium text-text-muted">of {ceiling}%</span>
          </p>
          {sublabel && <p className="mt-1 text-xs leading-relaxed text-text-muted">{sublabel}</p>}
        </div>
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset",
            m.chip,
          )}
        >
          <m.Icon className="size-3.5" />
          {statusLabel ?? m.label}
        </span>
      </div>

      <div className="relative">
        <div className={cn("w-full overflow-hidden rounded-full bg-surface-3", track)}
          role="progressbar"
          aria-valuenow={Math.round(value)}
          aria-valuemin={0}
          aria-valuemax={ceiling}
          aria-label={typeof label === "string" ? label : "Threshold gauge"}
        >
          <div className={cn("h-full rounded-full transition-[width] duration-700", m.bar)} style={{ width: `${pct}%` }} />
        </div>
        {/* threshold markers, drawn on the ceiling scale */}
        {[warnAt, critAt].map((t) => (
          <span
            key={t}
            aria-hidden
            className="absolute top-0 h-full w-px bg-border-strong"
            style={{ left: `${(t / ceiling) * 100}%` }}
          />
        ))}
      </div>

      {showScale && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-text-muted">
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2 rounded-[2px] bg-good-500" />
            Safe &lt; {warnAt}%
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2 rounded-[2px] bg-warning-500" />
            Watch {warnAt}–{critAt - 1}%
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2 rounded-[2px] bg-critical-500" />
            Escalate ≥ {critAt}%
          </span>
          <span className="inline-flex items-center gap-1.5 font-medium text-text-secondary">
            <ShieldAlert className="size-3" />
            Hard ceiling {ceiling}%
          </span>
        </div>
      )}
    </div>
  );
}
