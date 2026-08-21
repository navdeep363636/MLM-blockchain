"use client";

/* Detail drawer wrapper — every queue on the admin side opens one of these. */

import { Drawer } from "@/components/ui";
import { cn } from "@/lib/utils";

export function DetailDrawer({
  open, onClose, title, subtitle, badges, footer, children, width = "max-w-2xl",
}: {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  badges?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
  width?: string;
}) {
  return (
    <Drawer open={open} onClose={onClose} title={title} width={width} footer={footer}>
      {(subtitle || badges) && (
        <div className="mb-5 space-y-2.5">
          {subtitle && <p className="text-sm leading-relaxed text-text-muted">{subtitle}</p>}
          {badges && <div className="flex flex-wrap items-center gap-2">{badges}</div>}
        </div>
      )}
      <div className="space-y-6">{children}</div>
    </Drawer>
  );
}

export function DrawerSection({
  title, description, action, children, className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("space-y-3", className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted">{title}</h3>
          {description && <p className="mt-1 text-xs leading-relaxed text-text-muted">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Vertical timeline used for activity logs and ticket threads. */
export function Timeline({
  items,
}: {
  items: { title: React.ReactNode; meta?: React.ReactNode; body?: React.ReactNode; tone?: "default" | "warning" | "critical" | "good" }[];
}) {
  return (
    <ol className="space-y-0">
      {items.map((it, i) => (
        <li key={i} className="relative flex gap-3 pb-4 last:pb-0">
          <span className="relative flex flex-col items-center">
            <span
              className={cn(
                "mt-1.5 size-2 shrink-0 rounded-full",
                it.tone === "critical" ? "bg-critical-500"
                  : it.tone === "warning" ? "bg-warning-500"
                  : it.tone === "good" ? "bg-good-500"
                  : "bg-[var(--accent)]",
              )}
            />
            {i < items.length - 1 && <span className="mt-1 w-px flex-1 bg-border-default" />}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
              <p className="text-sm font-medium text-text-primary">{it.title}</p>
              {it.meta && <p className="tnum text-xs text-text-muted">{it.meta}</p>}
            </div>
            {it.body && <div className="mt-1 text-xs leading-relaxed text-text-secondary">{it.body}</div>}
          </div>
        </li>
      ))}
    </ol>
  );
}
