/* ============================================================================
 * Route-level loading fallbacks.
 *
 * WHY THESE EXIST AT ALL
 * ----------------------
 * The app shipped with no `loading.tsx` anywhere, which means no route segment
 * had a Suspense boundary. In the App Router that has one very specific
 * consequence: when you click a link, the router will not commit the navigation
 * until the new segment is ready — and until it commits, it keeps rendering the
 * PREVIOUS page. So a click produced no visible change at all, and then the new
 * page appeared some time later. Nothing was broken; there was simply nowhere
 * for the router to show progress, so it showed the past instead.
 *
 * A `loading.tsx` flips that: the router commits immediately, unmounts the old
 * page and renders the fallback. The navigation becomes visible on the same
 * frame as the click.
 *
 * These are server components on purpose — no "use client" — so a fallback costs
 * zero JavaScript and can be streamed before any of the route's own code has
 * loaded.
 *
 * WHY THEY ARE SHAPED, NOT SPINNERS
 * ---------------------------------
 * A spinner tells the reader "wait" and nothing else, and it re-centres content
 * that is about to move again when the real page lands. These mirror the actual
 * page geometry — header block, then the stat row or table the page is known to
 * have — so the skeleton and the content occupy the same space and the swap is a
 * fill rather than a jump.
 * ========================================================================== */

import { cn } from "@/lib/utils";

/*
 * A local `Skeleton` rather than the one from components/ui.
 *
 * That module is a client component and imports Button, so pulling it in here
 * would drag the ui barrel — and through it framer-motion — into the chunk for
 * every route's loading fallback. A fallback that needs JavaScript to appear is
 * useless precisely when it matters most: while JavaScript is still loading.
 * These files stay server components with no client dependency, so the skeleton
 * streams as HTML.
 */
function Skeleton({ className }: { className?: string }) {
  return <div className={cn("shimmer rounded-md", className)} aria-hidden />;
}

/** Matches the PageHeader in app-shell: breadcrumb, title, description. */
export function HeaderSkeleton({ actions = true }: { actions?: boolean }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0 space-y-2.5">
        <Skeleton className="h-2.5 w-28" />
        <Skeleton className="h-7 w-64 max-w-full" />
        <Skeleton className="h-3 w-[34rem] max-w-full" />
      </div>
      {actions && (
        <div className="flex gap-2">
          <Skeleton className="h-10 w-28 rounded-xl" />
        </div>
      )}
    </div>
  );
}

function Panel({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "rounded-[var(--radius-card)] border border-border-subtle bg-surface-1 p-5",
        "[box-shadow:var(--shadow-e2),inset_0_1px_0_0_var(--rim-light)]",
        className,
      )}
    >
      <Skeleton className="h-3 w-28" />
      <Skeleton className="mt-3 h-7 w-36" />
      <Skeleton className="mt-4 h-2.5 w-full" />
      <Skeleton className="mt-2 h-2.5 w-4/5" />
    </div>
  );
}

/** A row of stat tiles, as the dashboards, wallet and staking pages all open with. */
export function StatRowSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: count }, (_, i) => (
        <Panel key={i} />
      ))}
    </div>
  );
}

export function TableSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-[var(--radius-card)] border border-border-subtle bg-surface-1",
        "[box-shadow:var(--shadow-e2),inset_0_1px_0_0_var(--rim-light)]",
      )}
    >
      <div className="flex items-center gap-4 border-b border-border-default px-5 py-3">
        <Skeleton className="h-2.5 w-24" />
        <Skeleton className="h-2.5 w-20" />
        <Skeleton className="ml-auto h-2.5 w-16" />
      </div>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-4 border-b border-border-subtle px-5 py-3.5 last:border-0">
          <Skeleton className="size-8 shrink-0 rounded-full" />
          <Skeleton className="h-3 w-40 max-w-[30%]" />
          <Skeleton className="h-3 w-24 max-w-[18%]" />
          <Skeleton className="ml-auto h-3 w-16" />
        </div>
      ))}
    </div>
  );
}

/**
 * The default fallback for a dashboard route: header, stat row, then two panels.
 * Close enough to every page in the player and admin areas that the reader sees
 * the shape of what is arriving rather than a blank content column.
 */
export function DashboardRouteSkeleton({
  stats = 4, table = false,
}: { stats?: number; table?: boolean }) {
  return (
    <div
      /* Announced once, politely. Without a role the screen-reader user gets
         silence for exactly as long as the sighted user gets a skeleton. */
      role="status"
      aria-live="polite"
      aria-label="Loading page"
      className="animate-[fade-in_150ms_ease-out]"
    >
      <HeaderSkeleton />
      {stats > 0 && <StatRowSkeleton count={stats} />}
      {table ? (
        <div className="mt-6">
          <TableSkeleton />
        </div>
      ) : (
        <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <Panel className="min-h-[18rem]" />
          <Panel className="min-h-[18rem]" />
        </div>
      )}
    </div>
  );
}

/** For the marketing/public shell, which is a centred prose column. */
export function PublicRouteSkeleton() {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Loading page"
      className="mx-auto w-full max-w-7xl px-4 py-20 sm:px-6 lg:px-8"
    >
      <div className="mx-auto max-w-3xl space-y-4 text-center">
        <Skeleton className="mx-auto h-2.5 w-32" />
        <Skeleton className="mx-auto h-12 w-full" />
        <Skeleton className="mx-auto h-12 w-4/5" />
        <Skeleton className="mx-auto mt-6 h-3 w-full" />
        <Skeleton className="mx-auto h-3 w-11/12" />
      </div>
      <div className="mt-16 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <Panel key={i} className="min-h-[11rem]" />
        ))}
      </div>
    </div>
  );
}

/** For the auth card column — narrow, one panel. */
export function AuthRouteSkeleton() {
  return (
    <div role="status" aria-live="polite" aria-label="Loading" className="space-y-5">
      <div className="space-y-3">
        <Skeleton className="h-8 w-3/4" />
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-5/6" />
      </div>
      <div className="space-y-3 pt-2">
        <Skeleton className="h-11 w-full rounded-xl" />
        <Skeleton className="h-11 w-full rounded-xl" />
        <Skeleton className="h-11 w-full rounded-xl" />
      </div>
    </div>
  );
}
