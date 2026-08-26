"use client";

import { cn } from "@/lib/utils";
import { HoloCard } from "@/components/fx";

/* ============================================================================
 * Card — the most-used surface in the app (it appears on all 67 routes), which
 * is why the depth treatment lives here rather than being sprinkled per screen.
 *
 * Four materials, in ascending order of "how much attention should this pull":
 *
 *   flat       a container. No shadow, no rim. For dense grids of many cards
 *              where elevation on every one of them would be visual noise.
 *   raised     the default. Rim light along the top edge + a short shadow.
 *   floating   a longer shadow and a lighter fill — for things that overlay
 *              (drawers, popovers, the wallet panel).
 *   holo       raised + pointer-tracked tilt and a specular highlight. For
 *              cards the user is meant to choose BETWEEN: pool cards, game
 *              cards, plan tiers.
 *
 * `hover` and `glow` are kept exactly as they were so no existing call site
 * changes behaviour; `material`, `interactive` and `accent` are additive.
 * ========================================================================== */

export type CardMaterial = "flat" | "raised" | "floating" | "holo";

const materials: Record<CardMaterial, string> = {
  flat: "bg-surface-1 border-border-subtle",
  raised:
    "bg-surface-1 border-border-subtle shadow-[var(--shadow-e2)] " +
    "[box-shadow:var(--shadow-e2),inset_0_1px_0_0_var(--rim-light)]",
  floating:
    "border-border-default bg-[linear-gradient(180deg,color-mix(in_oklab,var(--surface-2)_60%,transparent),transparent_38%)] " +
    "bg-surface-raised [box-shadow:var(--shadow-e4),inset_0_1px_0_0_var(--rim-light-strong)]",
  holo:
    "bg-surface-1 border-border-subtle [box-shadow:var(--shadow-e3),inset_0_1px_0_0_var(--rim-light)]",
};

export function Card({
  className, children, hover, glow, material = "raised", interactive, accent, ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  hover?: boolean;
  glow?: boolean;
  material?: CardMaterial;
  /** Adds the pointer-tracked tilt. Implied by material="holo". */
  interactive?: boolean;
  /** Draws the gradient hairline border — reserved for the primary card on a screen. */
  accent?: boolean;
}) {
  const body = (
    <div
      className={cn(
        "relative rounded-[var(--radius-card)] border",
        materials[material],
        accent && "ring-gradient",
        /* `hover` — the legacy prop, used on dozens of screens — gets light and
           elevation but deliberately NO transform.
           A transform (even `translateZ`) makes the card a containing block and
           a stacking context, which traps any tooltip or popover inside it: the
           card is hovered at exactly the moment its tooltip opens, so the next
           card in the grid would paint over the hint text. Depth here is
           carried by the shadow, the border and the sheen, all of which are
           safe on a container of unknown contents.
           `interactive` is the opt-in that does move, and it wraps in HoloCard
           below — use it on cards whose contents are inert. */
        hover &&
          "holo transition-[border-color,box-shadow,background-color] duration-[var(--dur-base)] ease-[var(--ease-tide)] " +
          "hover:border-[color-mix(in_oklab,var(--accent)_40%,var(--border-default))] " +
          "hover:[box-shadow:var(--shadow-e4),inset_0_1px_0_0_var(--rim-light-strong)]",
        interactive && "holo",
        glow && "glow-brand",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );

  /* The tilt needs a perspective ancestor, which HoloCard provides. Only pay
     for the wrapper when the card actually tilts. */
  if (material === "holo" || interactive) {
    return <HoloCard max={5} lift={18} className="h-full rounded-[var(--radius-card)]">{body}</HoloCard>;
  }
  return body;
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
    <div
      className={cn(
        "relative flex items-start justify-between gap-4 border-b border-border-subtle px-5 py-4",
        className,
      )}
    >
      {/* A single lit hairline where the header meets the body. It is the cue
          that the header is a separate plate laid on the card, not a heading
          inside it. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-[linear-gradient(90deg,transparent,var(--accent-ring),transparent)] opacity-40"
      />
      <div className="flex min-w-0 items-start gap-3">
        {icon && (
          <span
            className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl bg-accent-soft text-[var(--accent)]
                       ring-1 ring-inset ring-[var(--accent-ring)] [box-shadow:inset_0_1px_0_0_var(--rim-light)]"
          >
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
  return <div className={cn("relative px-5 py-4", className)} {...props} />;
}

export function CardFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "relative flex items-center gap-3 border-t border-border-subtle bg-[color-mix(in_oklab,var(--surface-inset)_45%,transparent)] px-5 py-3.5",
        className,
      )}
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
        <h2 className="font-display text-lg font-semibold tracking-tight text-text-primary">{children}</h2>
        {description && <p className="mt-1 text-sm text-text-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}

/**
 * A panel that is clearly *below* the page rather than above it — pressed in,
 * with the shadow on the inside. Used for code blocks, ledger extracts, JSON
 * payloads and anything quoted from elsewhere.
 */
export function InsetPanel({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("panel-inset p-4", className)} {...props} />;
}
