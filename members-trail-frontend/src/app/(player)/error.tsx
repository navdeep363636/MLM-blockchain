"use client";

/* A route-level error boundary.
 *
 * Without one, anything thrown while rendering a route walks all the way up to
 * the root and replaces the entire application — shell, navigation and all —
 * with Next's fallback. Catching it here keeps the chrome, so the reader can
 * navigate somewhere else instead of reloading. */

import { useEffect } from "react";
import { Button } from "@/components/ui";

export default function RouteError({
  error, reset,
}: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[route error]", error);
  }, [error]);

  return (
    <div role="alert" className="flex min-h-[50vh] flex-col items-center justify-center gap-4 px-4 text-center">
      <h2 className="font-display text-lg font-semibold text-text-primary">
        This page didn&apos;t load
      </h2>
      <p className="max-w-md text-sm text-text-muted">
        Something failed while rendering. Nothing you did is saved or lost — retrying
        re-runs just this page.
      </p>
      <div className="flex gap-2">
        <Button onClick={reset}>Try again</Button>
      </div>
      {error.digest && (
        <p className="text-xs text-text-muted">
          Reference <span className="font-mono-num">{error.digest}</span>
        </p>
      )}
    </div>
  );
}
