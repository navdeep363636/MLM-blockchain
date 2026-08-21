"use client";

import { cn } from "@/lib/utils";
import { Button } from "./button";

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("shimmer rounded-md", className)} aria-hidden />;
}

export function SkeletonCard({ className }: { className?: string }) {
  return (
    <div className={cn("space-y-3 rounded-[var(--radius-card)] border border-border-subtle bg-surface-1 p-5", className)}>
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
        <span className="grid size-14 place-items-center rounded-2xl bg-surface-2 text-text-muted [&>svg]:size-6">
          {icon}
        </span>
      )}
      <div>
        <p className="font-semibold text-text-primary">{title}</p>
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
