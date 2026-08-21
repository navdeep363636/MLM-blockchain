"use client";

import { cn } from "@/lib/utils";

export function Card({
  className, children, hover, glow, ...props
}: React.HTMLAttributes<HTMLDivElement> & { hover?: boolean; glow?: boolean }) {
  return (
    <div
      className={cn(
        "relative rounded-[var(--radius-card)] border border-border-subtle bg-surface-1",
        hover &&
          "transition-[transform,border-color,box-shadow] duration-300 ease-[var(--ease-out-expo)] " +
          "hover:-translate-y-0.5 hover:border-[color-mix(in_oklab,var(--accent)_40%,var(--border-default))] " +
          "hover:shadow-[0_18px_50px_-24px_rgba(0,0,0,0.65)]",
        glow && "glow-brand",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  title, description, action, className, icon,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className={cn("flex items-start justify-between gap-4 border-b border-border-subtle px-5 py-4", className)}>
      <div className="flex min-w-0 items-start gap-3">
        {icon && (
          <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl bg-accent-soft text-[var(--accent)]">
            {icon}
          </span>
        )}
        <div className="min-w-0">
          <h3 className="truncate text-[0.95rem] font-semibold text-text-primary">{title}</h3>
          {description && <p className="mt-0.5 text-sm text-text-muted">{description}</p>}
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function CardBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-5 py-4", className)} {...props} />;
}

export function CardFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("flex items-center gap-3 border-t border-border-subtle px-5 py-3.5", className)}
      {...props}
    />
  );
}

/** Page-level section heading used across every dashboard route. */
export function SectionTitle({
  children, description, action, className,
}: {
  children: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-4 flex flex-wrap items-end justify-between gap-3", className)}>
      <div>
        <h2 className="text-lg font-semibold tracking-tight text-text-primary">{children}</h2>
        {description && <p className="mt-1 text-sm text-text-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}
