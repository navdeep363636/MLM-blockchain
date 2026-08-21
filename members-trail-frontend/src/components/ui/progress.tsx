"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

export function ProgressBar({
  value, max = 100, className, tone = "brand", showLabel, label, height = "h-2",
}: {
  value: number;
  max?: number;
  className?: string;
  tone?: "brand" | "good" | "warning" | "critical";
  showLabel?: boolean;
  label?: React.ReactNode;
  height?: string;
}) {
  const pct = max === 0 ? 0 : Math.min(100, Math.max(0, (value / max) * 100));
  const bg = {
    brand: "bg-[var(--accent)]", good: "bg-good-500",
    warning: "bg-warning-500", critical: "bg-critical-500",
  }[tone];

  return (
    <div className={cn("space-y-1.5", className)}>
      {(label || showLabel) && (
        <div className="flex items-baseline justify-between gap-2 text-xs">
          <span className="text-text-muted">{label}</span>
          {showLabel && <span className="tnum font-semibold text-text-secondary">{pct.toFixed(0)}%</span>}
        </div>
      )}
      <div
        className={cn("w-full overflow-hidden rounded-full bg-surface-3", height)}
        role="progressbar"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <motion.div
          className={cn("h-full rounded-full", bg)}
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
        />
      </div>
    </div>
  );
}

/**
 * Cap meter — the platform's compliance-critical control. Deliberately turns
 * amber past 75% and red past 90% so an approaching cap is impossible to miss.
 */
export function CapMeter({
  used, cap, label, unit = "", className, invertTone,
}: {
  used: number;
  cap: number;
  label?: React.ReactNode;
  unit?: string;
  className?: string;
  /** For treasury ratios where "high" is bad, tone flips at the same points. */
  invertTone?: boolean;
}) {
  const pct = cap === 0 ? 0 : Math.min(100, (used / cap) * 100);
  const tone = pct >= 90 ? "critical" : pct >= 75 ? "warning" : invertTone ? "good" : "brand";
  const fmt = (n: number) =>
    new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(n);

  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
        {label && <span className="text-xs text-text-muted">{label}</span>}
        <span className="tnum text-xs font-semibold text-text-secondary">
          {unit}{fmt(used)} <span className="font-normal text-text-muted">of {unit}{fmt(cap)}</span>
        </span>
      </div>
      <ProgressBar value={used} max={cap} tone={tone} height="h-1.5" />
    </div>
  );
}

/** Circular progress — quest completion, KYC steps, staking lock countdown. */
export function RingProgress({
  value, max = 100, size = 72, stroke = 6, children, tone = "var(--accent)", trackClassName,
}: {
  value: number;
  max?: number;
  size?: number;
  stroke?: number;
  children?: React.ReactNode;
  tone?: string;
  trackClassName?: string;
}) {
  const pct = max === 0 ? 0 : Math.min(1, Math.max(0, value / max));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;

  return (
    <div className="relative grid shrink-0 place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke}
          className={cn("stroke-[var(--surface-3)]", trackClassName)}
        />
        <motion.circle
          cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke}
          stroke={tone} strokeLinecap="round" strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: c * (1 - pct) }}
          transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
        />
      </svg>
      {children && <div className="absolute inset-0 grid place-items-center">{children}</div>}
    </div>
  );
}

/** Multi-step progress header — sign-up, KYC, withdrawal flows. */
export function Steps({
  steps, current, className,
}: {
  steps: string[];
  current: number;
  className?: string;
}) {
  return (
    <ol className={cn("flex w-full items-center gap-2", className)}>
      {steps.map((s, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li key={s} className="flex min-w-0 flex-1 items-center gap-2">
            <span
              className={cn(
                "grid size-7 shrink-0 place-items-center rounded-full text-xs font-semibold transition-all duration-300",
                done && "bg-good-500 text-white",
                active && "bg-[var(--accent)] text-white ring-4 ring-[var(--accent-soft)]",
                !done && !active && "bg-surface-3 text-text-muted ring-1 ring-border-default",
              )}
            >
              {done ? "✓" : i + 1}
            </span>
            <span
              className={cn(
                "hidden truncate text-xs font-medium sm:block",
                active ? "text-text-primary" : done ? "text-text-secondary" : "text-text-muted",
              )}
            >
              {s}
            </span>
            {i < steps.length - 1 && (
              <span
                className={cn(
                  "h-px min-w-3 flex-1 transition-colors duration-500",
                  done ? "bg-good-500" : "bg-border-default",
                )}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}
