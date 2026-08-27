"use client";

import { cn } from "@/lib/utils";
import { Button } from "./button";

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("shimmer rounded-md", className)} aria-hidden />;
}

/**
 * A skeleton that carries the depth of the surface it stands in for.
 *
 * Worth the extra element: a flat grey block inside an elevated card announces
 * "loading" as a different material, and the swap to real content then reads as
 * a layout jump. Matching the rim and shadow means only the text appears.
 */
export function SkeletonSurface({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        "shimmer rounded-[var(--radius-card)] [box-shadow:inset_0_1px_0_0_var(--rim-light)]",
        className,
      )}
    />
  );
}

export function SkeletonCard({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "space-y-3 rounded-[var(--radius-card)] border border-border-subtle bg-surface-1 p-5",
        "[box-shadow:var(--shadow-e2),inset_0_1px_0_0_var(--rim-light)]",
        className,
      )}
    >
      <Skeleton className="h-3 w-24" />
      <Skeleton className="h-7 w-36" />
      <Skeleton className="h-2.5 w-full" />
    </div>
  );
}

export function EmptyState({
  icon, title, description, action, className,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: { label: string; href?: string; onClick?: () => void };
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-3 px-6 py-16 text-center", className)}>
      {icon && (
        <span
          className="relative grid size-16 place-items-center rounded-2xl bg-surface-2 text-text-muted
                     ring-1 ring-inset ring-border-subtle
                     [box-shadow:inset_0_1px_0_0_var(--rim-light),var(--shadow-e3)] [&>svg]:size-7"
        >
          {/* Empty states are where a user has arrived expecting something. A
              lit tile reads as a place where content will appear, rather than
              as a failure. */}
          <span
            aria-hidden
            className="pointer-events-none absolute -inset-6 -z-10 rounded-full blur-2xl"
            style={{ background: "radial-gradient(circle, var(--accent-soft), transparent 70%)" }}
          />
          {icon}
        </span>
      )}
      <div>
        <p className="font-display font-semibold text-text-primary">{title}</p>
        {description && <p className="mx-auto mt-1 max-w-sm text-sm text-text-muted">{description}</p>}
      </div>
      {action && (
        <Button size="sm" href={action.href} onClick={action.onClick} className="mt-1">
          {action.label}
        </Button>
      )}
    </div>
  );
}
