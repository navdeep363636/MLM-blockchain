"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Suspense, useState } from "react";

import { ToastProvider } from "@/components/ui";
import { RouteProgress } from "@/components/layout/route-progress";
import { ThemeProvider } from "@/lib/hooks/use-theme";
import { AuthProvider } from "@/lib/auth/auth-context";
import { RealtimeProvider } from "@/lib/realtime/socket";

/* ============================================================================
 * Root providers — everything here is paid for by EVERY route, so the bar for
 * adding one is high.
 *
 * The wallet stack (wagmi + RainbowKit + connectors) used to live here and no
 * longer does; it is mounted per route group by components/web3/web3-provider.
 * See that file for why.
 * ========================================================================== */

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        /* Per-hook staleTime in use-data.ts overrides this. The default is a
         * floor for anything that forgets to set one. */
        staleTime: 20_000,
        retry: 1,
        /* Do NOT refetch on window focus by default. On a dashboard with
         * fifteen queries, alt-tabbing would fire fifteen requests every
         * time; the hooks that genuinely need to be current have short stale
         * times, and the socket invalidates the rest when something changes. */
        refetchOnWindowFocus: false,
        /* Left at the default `true`, which refetches on mount only when the
         * data is stale AND keeps the cached data on screen while it does. The
         * skeleton-on-every-navigation problem is a component-level one —
         * branching on `isFetching` instead of `isPending` — not something to
         * paper over with `refetchOnMount: false`, which would serve stale data
         * indefinitely between socket invalidations. */
        refetchOnReconnect: true,
      },
      mutations: {
        /* Never retried automatically. Every mutation carries an idempotency
         * key, so a retry would be SAFE — but "safe" is not "wanted": a user
         * who sees an error and a spinner cannot tell whether their stake
         * went through. Retrying is their decision. */
        retry: 0,
      },
    },
  });
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(makeQueryClient);

  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        {/* AuthProvider sits inside QueryClientProvider because it clears the
            cache on sign-out, and outside RealtimeProvider because the socket
            is authenticated with the session it establishes. */}
        <AuthProvider>
          <RealtimeProvider>
            <ToastProvider>
              {/* Acknowledges a click within a frame, however long the router
                  then takes. See route-progress.tsx. */}
              <Suspense fallback={null}>
                <RouteProgress />
              </Suspense>
              {children}
            </ToastProvider>
          </RealtimeProvider>
        </AuthProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
