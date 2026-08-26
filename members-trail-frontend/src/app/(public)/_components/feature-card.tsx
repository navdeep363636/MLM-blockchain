/* Reusable marketing cards. Server-safe wrappers around the fx primitives. */

import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { HoloCard, SpotlightCard } from "@/components/fx";
import { cn } from "@/lib/utils";

export function IconTile({
  children, className, size = "md",
}: { children: React.ReactNode; className?: string; size?: "sm" | "md" | "lg" }) {
  const sizes = {
    sm: "size-9 rounded-lg [&>svg]:size-4",
    md: "size-11 rounded-xl [&>svg]:size-5",
    lg: "size-14 rounded-2xl [&>svg]:size-6",
  } as const;
  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center bg-accent-soft text-[var(--accent)] ring-1 ring-inset ring-[var(--accent-ring)]",
        "[box-shadow:inset_0_1px_0_0_var(--rim-light),0_0_20px_-8px_var(--accent-ring)]",
        sizes[size],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Standard feature card. Pass `href` to make the whole card a link. */
export function FeatureCard({
  icon, title, description, children, href, footer, className, tilt,
}: {
  icon?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  children?: React.ReactNode;
  href?: string;
  footer?: React.ReactNode;
  className?: string;
  tilt?: boolean;
}) {
  const inner = (
    <SpotlightCard
      className={cn(
        "h-full rounded-[var(--radius-card)] border border-border-subtle bg-surface-1",
        "[box-shadow:var(--shadow-e2),inset_0_1px_0_0_var(--rim-light)]",
        "holo transition-[border-color,box-shadow] duration-[var(--dur-base)] ease-[var(--ease-tide)]",
        "hover:border-[color-mix(in_oklab,var(--accent)_38%,var(--border-default))]",
        "hover:[box-shadow:var(--shadow-e4),inset_0_1px_0_0_var(--rim-light-strong)]",
        className,
      )}
    >
      <div className="relative flex h-full flex-col p-5 sm:p-6">
        {icon && <IconTile className="mb-4 transition-transform duration-[var(--dur-base)] ease-[var(--ease-tide)] group-hover:scale-105">{icon}</IconTile>}
        <h3 className="flex items-start gap-1.5 text-[0.975rem] font-semibold text-text-primary">
          {title}
          {href && (
            <ArrowUpRight className="mt-0.5 size-3.5 shrink-0 text-text-muted transition-[transform,color] duration-[var(--dur-quick)] group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-[var(--accent)]" />
          )}
        </h3>
        {description && (
          <p className="mt-2 text-sm leading-relaxed text-text-secondary">{description}</p>
        )}
        {children && <div className="mt-4">{children}</div>}
        {footer && <div className="mt-auto pt-4">{footer}</div>}
      </div>
    </SpotlightCard>
  );

  /* `tilt` now buys the pointer-tracked HoloCard rather than the old TiltCard:
     same prop, same call sites, real perspective. Cards without it still get
     the sheen and the elevation change, which is the right default for a grid
     of eight — eight things tilting at once is a fairground. */
  const wrapped = tilt
    ? <HoloCard max={5} lift={20} className="h-full rounded-[var(--radius-card)]">{inner}</HoloCard>
    : inner;

  if (href) {
    return (
      <Link
        href={href}
        className="group block h-full rounded-[var(--radius-card)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
      >
        {wrapped}
      </Link>
    );
  }
  return <div className="group h-full">{wrapped}</div>;
}

/** Compact numbered/labelled fact used in dense grids. */
export function FactCard({
  label, value, note, icon, className,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  note?: React.ReactNode;
  icon?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "group rounded-[var(--radius-card)] border border-border-subtle bg-surface-1 p-5",
        "[box-shadow:var(--shadow-e2),inset_0_1px_0_0_var(--rim-light)]",
        "lift",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-medium uppercase tracking-wider text-text-muted">{label}</p>
        {icon && <IconTile size="sm">{icon}</IconTile>}
      </div>
      <p className="tnum mt-3 font-display text-2xl font-semibold tracking-tight text-text-primary">{value}</p>
      {note && <p className="mt-1.5 text-xs leading-relaxed text-text-muted">{note}</p>}
    </div>
  );
}
