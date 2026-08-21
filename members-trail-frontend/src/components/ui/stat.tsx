"use client";

import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import { AnimatedCounter, SpotlightCard } from "@/components/fx";
import { Sparkline } from "@/components/charts";
import { InfoHint } from "./tooltip";

/**
 * Stat tile. When the number IS the answer, this replaces a chart entirely
 * (see the dataviz form heuristic). The delta is a labelled, iconned change —
 * never colour alone.
 */
export function StatTile({
  label, value, prefix, suffix, decimals = 0, delta, deltaLabel, icon, hint,
  spark, sparkColor, className, compact, footer, tone,
}: {
  label: React.ReactNode;
  value: number | string;
  prefix?: string;
  suffix?: string;
  decimals?: number;
  /** Percentage change. Positive is treated as "up". */
  delta?: number;
  deltaLabel?: string;
  icon?: React.ReactNode;
  hint?: React.ReactNode;
  spark?: Record<string, unknown>[];
  sparkColor?: string;
  className?: string;
  compact?: boolean;
  footer?: React.ReactNode;
  tone?: "default" | "brand";
}) {
  const up = (delta ?? 0) > 0;
  const flat = delta === 0 || delta == null;
  const DeltaIcon = flat ? Minus : up ? ArrowUpRight : ArrowDownRight;

  return (
    <SpotlightCard
      className={cn(
        "rounded-[var(--radius-card)] border border-border-subtle bg-surface-1 transition-colors duration-300",
        "hover:border-[color-mix(in_oklab,var(--accent)_35%,var(--border-default))]",
        tone === "brand" && "border-[var(--accent-ring)] bg-[linear-gradient(155deg,var(--accent-soft),transparent_55%)]",
        className,
      )}
    >
      <div className={cn("relative", compact ? "p-4" : "p-5")}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-1.5">
            <p className="text-xs font-medium uppercase tracking-wider text-text-muted">{label}</p>
            {hint && <InfoHint>{hint}</InfoHint>}
          </div>
          {icon && (
            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-accent-soft text-[var(--accent)] [&>svg]:size-4">
              {icon}
            </span>
          )}
        </div>

        <div className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <p className={cn("font-display font-semibold tracking-tight text-text-primary", compact ? "text-xl" : "text-2xl")}>
            {typeof value === "number" ? (
              <AnimatedCounter value={value} decimals={decimals} prefix={prefix} suffix={suffix} />
            ) : (
              <span className="tnum">{prefix}{value}{suffix}</span>
            )}
          </p>
          {delta != null && (
            <span
              className={cn(
                "inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-xs font-semibold",
                flat ? "bg-surface-3 text-text-muted"
                     : up ? "bg-good-500/12 text-good-400"
                          : "bg-critical-500/12 text-critical-400",
              )}
            >
              <DeltaIcon className="size-3" />
              <span className="tnum">{Math.abs(delta).toFixed(1)}%</span>
            </span>
          )}
        </div>

        {deltaLabel && <p className="mt-1 text-xs text-text-muted">{deltaLabel}</p>}
        {spark && <Sparkline data={spark} color={sparkColor ?? "var(--series-1)"} className="mt-3" />}
        {footer && <div className="mt-3 border-t border-border-subtle pt-3">{footer}</div>}
      </div>
    </SpotlightCard>
  );
}

/** Hero number — one figure that carries a whole section. */
export function HeroStat({
  value, label, sublabel, prefix, suffix, decimals = 0, className,
}: {
  value: number;
  label: React.ReactNode;
  sublabel?: React.ReactNode;
  prefix?: string;
  suffix?: string;
  decimals?: number;
  className?: string;
}) {
  return (
    <div className={cn("text-center", className)}>
      <p className="font-display text-4xl font-semibold tracking-tight text-gradient-brand sm:text-5xl">
        <AnimatedCounter value={value} decimals={decimals} prefix={prefix} suffix={suffix} />
      </p>
      <p className="mt-1.5 text-sm font-medium text-text-secondary">{label}</p>
      {sublabel && <p className="mt-0.5 text-xs text-text-muted">{sublabel}</p>}
    </div>
  );
}

/** Compact label/value row — used inside cards, drawers and confirmation modals. */
export function DetailRow({
  label, value, mono, className, hint,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  mono?: boolean;
  className?: string;
  hint?: React.ReactNode;
}) {
  return (
    <div className={cn("flex items-start justify-between gap-4 py-2", className)}>
      <span className="flex items-center gap-1.5 text-sm text-text-muted">
        {label}
        {hint && <InfoHint>{hint}</InfoHint>}
      </span>
      <span className={cn("text-right text-sm font-medium text-text-primary", mono && "font-mono-num text-xs")}>
        {value}
      </span>
    </div>
  );
}
