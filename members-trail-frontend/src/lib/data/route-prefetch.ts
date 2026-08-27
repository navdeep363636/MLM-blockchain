/* ============================================================================
 * What each route needs, so it can be fetched before the route exists.
 *
 * THE PROBLEM
 * -----------
 * A route's data hooks live inside its components, so the first request cannot
 * be issued until the router has committed the navigation and React has mounted
 * that tree. Measured against a 120ms API, the first byte of the destination's
 * data was requested ~105ms after the click, every time — and that was on top of
 * however long the request itself then took.
 *
 * Next's own prefetch does not help with this. It warms the route's static shell
 * and its `loading.tsx`, which is exactly the part that was already fast.
 *
 * WHAT THIS DOES
 * --------------
 * Declares, per route, which queries that route reads above the fold, drawn from
 * the same `Q` specs the hooks consume. NavLink runs them on hover, focus and
 * touch-start — the moment a click becomes likely rather than the moment it has
 * already happened. A pointer typically rests on a link for a few hundred
 * milliseconds before the button goes down, which is enough for a fast query to
 * be sitting in the cache when the component finally mounts and asks for it.
 *
 * WHAT IS DELIBERATELY NOT HERE
 * -----------------------------
 * Server-side fetching with `initialData`, which would be the stronger fix, is
 * not available to this app: the access token lives in memory in the API client
 * and the refresh token is an httpOnly cookie scoped to /auth, so the Next
 * server has no credential to fetch a member's data with. Changing that is an
 * auth-architecture decision with real security consequences, not a perf tweak.
 *
 * Every route is listed at MOST with what it shows first. Prefetching a whole
 * page's worth of queries on hover would trade one burst for another, and the
 * reader is looking at the top of the page, not the bottom of it.
 * ========================================================================== */

import type { QueryClient } from "@tanstack/react-query";
import { Q, type QuerySpec } from "@/lib/hooks/use-data";

type AnySpec = QuerySpec<unknown>;

const spec = (s: unknown) => s as AnySpec;

/**
 * Exact paths first, then prefixes. A prefix entry covers the sub-routes of a
 * section that share its opening reads — `/app/wallet/history` shows the same
 * transaction list `/app/wallet` does.
 */
const EXACT: Record<string, readonly AnySpec[]> = {
  "/app": [spec(Q.balance), spec(Q.pointsSummary), spec(Q.stakePositions), spec(Q.referralStats)],
  "/app/wallet": [spec(Q.balance), spec(Q.transactions)],
  "/app/staking": [spec(Q.stakingPools), spec(Q.stakePositions), spec(Q.balance)],
  "/app/referrals": [spec(Q.referralStats), spec(Q.referralCap), spec(Q.commissions)],
  "/app/games": [spec(Q.games), spec(Q.tournaments)],
  "/admin": [spec(Q.adminKpis), spec(Q.adminKycQueue)],
  "/admin/users": [spec(Q.adminMembers)],
  "/admin/kyc": [spec(Q.adminKycQueue)],
  "/admin/roles": [spec(Q.adminStaff)],
};

const PREFIX: Array<[string, readonly AnySpec[]]> = [
  ["/app/wallet", [spec(Q.balance), spec(Q.transactions)]],
  ["/app/staking", [spec(Q.stakingPools), spec(Q.stakePositions)]],
  ["/app/referrals", [spec(Q.referralStats), spec(Q.referralCap)]],
  ["/app/games", [spec(Q.games), spec(Q.tournaments)]],
];

/** The queries a route opens with, or an empty list for a route with no data. */
export function specsForRoute(href: string): readonly AnySpec[] {
  const path = href.split("?")[0].split("#")[0].replace(/\/+$/, "") || "/";
  const exact = EXACT[path];
  if (exact) return exact;
  for (const [prefix, specs] of PREFIX) {
    if (path === prefix || path.startsWith(`${prefix}/`)) return specs;
  }
  return [];
}

/**
 * Warm the cache for a route.
 *
 * `prefetchQuery` is a no-op when the data is already fresh, so this is safe to
 * fire on every hover — a reader sweeping the pointer down a sidebar does not
 * produce a request per item, only per item whose data has actually gone stale.
 * It also swallows its own errors: a prefetch that fails must not surface
 * anything, because the reader never asked for it. The real query will run when
 * the page mounts and will report the failure properly then.
 */
export function prefetchRoute(qc: QueryClient, href: string, signedIn: boolean): void {
  for (const s of specsForRoute(href)) {
    if (s.authed && !signedIn) continue;
    void qc
      .prefetchQuery({
        queryKey: s.queryKey,
        queryFn: s.queryFn,
        /* The spec's own freshness, so the value this puts in the cache is
           still fresh when the component mounts a moment later. Left off, this
           lands as already-stale and the mount refetches it immediately —
           which is a prefetch that costs a request and saves nothing. */
        staleTime: s.staleTime,
      })
      .catch(() => {});
  }
}
