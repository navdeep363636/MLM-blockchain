/* Suspense fallback for this route. See components/layout/route-skeletons.tsx
 * for why one of these sits beside every page.tsx. */

import { cn } from "@/lib/utils";

/* Local, so the fallback carries no client JavaScript. */
function Skeleton({ className }: { className?: string }) {
  return <div className={cn("shimmer rounded-md", className)} aria-hidden />;
}

/* A legal document is one long prose column, so a card grid would be the wrong
 * shape and the swap would read as a layout jump. */
export default function Loading() {
  return (
    <div role="status" aria-live="polite" aria-label="Loading page" className="mx-auto max-w-3xl px-4 py-20 sm:px-6">
      <Skeleton className="h-10 w-2/3" />
      <Skeleton className="mt-4 h-3 w-40" />
      <div className="mt-10 space-y-3">
        {Array.from({ length: 14 }, (_, i) => (
          <Skeleton key={i} className={i % 4 === 3 ? "h-3 w-3/5" : "h-3 w-full"} />
        ))}
      </div>
    </div>
  );
}
