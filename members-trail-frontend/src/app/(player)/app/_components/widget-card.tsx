"use client";

/* WidgetCard — the frame every dashboard widget and player panel sits in.
 * Optional `live` marks a figure that is read straight from the ledger. */

import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { LiveDot } from "@/components/fx";
import { cn } from "@/lib/utils";

export function WidgetCard({
  title, description, icon, action, footnote, live, href, hrefLabel, children,
  className, bodyClassName, tone = "default",
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  footnote?: React.ReactNode;
  /** Shows the live-ledger pulse in the header. */
  live?: boolean;
  href?: string;
  hrefLabel?: string;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  tone?: "default" | "brand" | "warning" | "critical";
}) {
  const ring = {
    default: "border-border-subtle",
    brand: "border-[var(--accent-ring)]",
    warning: "border-warning-500/40",
    critical: "border-critical-500/40",
  }[tone];

  return (
    <section
      className={cn(
        "flex flex-col overflow-hidden rounded-[var(--radius-card)] border bg-surface-1",
        ring,
        className,
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border-subtle px-5 py-4">
        <div className="flex min-w-0 items-start gap-3">
          {icon && (
            <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl bg-accent-soft text-[var(--accent)] [&>svg]:size-4">
              {icon}
            </span>
          )}
          <div className="min-w-0">
            <h3 className="flex flex-wrap items-center gap-2 text-[0.95rem] font-semibold text-text-primary">
              {title}
              {live && <LiveDot label="Live" />}
            </h3>
            {description && <p className="mt-0.5 text-sm text-text-muted">{description}</p>}
          </div>
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>

      <div className={cn("flex-1 px-5 py-4", bodyClassName)}>{children}</div>

      {(footnote || href) && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border-subtle px-5 py-3">
          {footnote ? (
            <p className="min-w-0 flex-1 text-xs leading-relaxed text-text-muted">{footnote}</p>
          ) : (
            <span />
          )}
          {href && (
            <Link
              href={href}
              className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-[var(--accent-hover)] transition-colors hover:text-[var(--accent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
            >
              {hrefLabel ?? "Open"}
              <ArrowUpRight className="size-3" />
            </Link>
          )}
        </div>
      )}
    </section>
  );
}

/** Small label/value pair used inside widgets. */
export function WidgetStat({
  label, value, sub, tone = "default", className,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tone?: "default" | "good" | "warning" | "critical" | "brand";
  className?: string;
}) {
  const colour = {
    default: "text-text-primary",
    good: "text-good-400",
    warning: "text-warning-400",
    critical: "text-critical-400",
    brand: "text-[var(--accent-hover)]",
  }[tone];

  return (
    <div className={cn("rounded-xl border border-border-subtle bg-surface-inset px-3 py-2.5", className)}>
      <p className="text-[11px] font-medium uppercase tracking-wider text-text-muted">{label}</p>
      <p className={cn("tnum mt-1 font-display text-base font-semibold", colour)}>{value}</p>
      {sub && <p className="mt-0.5 text-[11px] leading-relaxed text-text-muted">{sub}</p>}
    </div>
  );
}
