"use client";

/* ============================================================================
 * Starts a route's data fetch when a click becomes likely, not when it happens.
 *
 * WHY A DOCUMENT-LEVEL LISTENER
 * -----------------------------
 * The same reasoning as route-progress.tsx: intent arrives on an anchor, and
 * there are anchors in the sidebar, the header, the footer, inside tables, in
 * prose. Putting the handler on `NavLink` would cover the sidebar and miss every
 * other route into the same page — and a prefetch that works from one entry
 * point and not another is worse than none, because the page is fast on the
 * path you tested and slow on the path people use.
 *
 * `pointerover` rather than `mouseenter`: it bubbles, so one listener sees every
 * anchor including ones rendered later. Keyboard users get `focusin`, and touch
 * users get `touchstart`, which lands roughly 80-120ms before the tap completes.
 *
 * WHY THIS IS CHEAP
 * -----------------
 * `prefetchQuery` does nothing when the data is already fresh, so sweeping a
 * pointer down a twelve-item sidebar does not produce twelve request bursts —
 * only the entries whose data has actually gone stale. `seen` additionally stops
 * a route being re-armed on every hover within a short window, which is what
 * turns an indecisive pointer into a hammering loop.
 *
 * WARMING ON MOUNT
 * ----------------
 * The landing route of each shell also warms the one or two pages people go to
 * next, on an idle callback so it never competes with the current page's own
 * requests. This is a bet, and a wrong bet costs one request that would probably
 * have been made anyway.
 * ========================================================================== */

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";

import { prefetchRoute, specsForRoute } from "@/lib/data/route-prefetch";
import { useAuth } from "@/lib/auth/auth-context";

/** Re-arm a route at most this often, however many times it is hovered. */
const REARM_MS = 10_000;

/** Longest we hold a warm-up back waiting for the page to go quiet. */
const MAX_QUIET_WAIT_MS = 5_000;

/** Where people go next from each shell's landing page. */
const WARM_ON_MOUNT: Record<string, readonly string[]> = {
  "/app": ["/app/wallet", "/app/staking"],
  /* /admin deliberately warms nothing. Its one likely destination, /admin/users,
     opens on `adminMembers` — five paginated requests — which is far too much to
     spend on a guess. Hover intent covers it, and a member list is the kind of
     page a reader arrives at deliberately rather than by reflex. */
};

function idle(fn: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const ric = window.requestIdleCallback;
  if (typeof ric === "function") {
    const id = ric(fn, { timeout: 2_000 });
    return () => window.cancelIdleCallback?.(id);
  }
  const id = window.setTimeout(fn, 400);
  return () => window.clearTimeout(id);
}

/**
 * Runs `fn` once the query cache is quiet, so speculative work for the *next*
 * route never competes with the current page's own requests. Browsers cap a
 * single origin at six concurrent HTTP/1.1 connections, so a warm-up fired while
 * the dashboard is still fetching does not run alongside it — it queues in front
 * of the tail of it. Capped so a page that polls forever still warms eventually.
 */
function whenQuiet(qc: QueryClient, fn: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  let cancelIdle: (() => void) | null = null;
  let done = false;

  const run = () => {
    if (done) return;
    done = true;
    unsubscribe();
    window.clearTimeout(cap);
    cancelIdle = idle(fn);
  };

  const check = () => {
    if (qc.isFetching() === 0) run();
  };

  const unsubscribe = qc.getQueryCache().subscribe(check);
  const cap = window.setTimeout(run, MAX_QUIET_WAIT_MS);
  check();

  return () => {
    done = true;
    unsubscribe();
    window.clearTimeout(cap);
    cancelIdle?.();
  };
}

export function RoutePrefetcher() {
  const router = useRouter();
  const qc = useQueryClient();
  const { phase, sessionReady } = useAuth();
  const signedIn = phase === "authenticated";

  /* Warm the route the reader is ALREADY on, the instant the token lands.
   *
   * The hover map exists for the route they are going to; this is the same
   * registry pointed at the current path. It matters because a page's own hooks
   * live inside its components, several of which arrive as separate chunks -
   * measured on a cold /admin, the first data request went out at 1596ms on a
   * document whose scripts had landed by 217ms. Firing the specs here puts them
   * on the wire as soon as there is a credential to send, so the components
   * mount into a warm cache instead of starting the clock. */
  useEffect(() => {
    if (!sessionReady) return;
    prefetchRoute(qc, window.location.pathname, true);
  }, [sessionReady, qc]);

  /* Refs, not state: these are read inside a listener that must not be torn
     down and rebuilt every time the session phase settles. */
  const signedInRef = useRef(signedIn);
  signedInRef.current = signedIn;
  const seen = useRef(new Map<string, number>());

  useEffect(() => {
    const arm = (href: string) => {
      const path = href.split("?")[0].split("#")[0];
      const now = Date.now();
      const last = seen.current.get(path);
      if (last && now - last < REARM_MS) return;
      seen.current.set(path, now);

      /* The route's own JS and RSC payload. Next prefetches links in the
         viewport already, but not ones revealed by a scroll or a menu. */
      try { router.prefetch(path); } catch { /* not a routable href */ }
      prefetchRoute(qc, path, signedInRef.current);
    };

    const fromEvent = (target: EventTarget | null) => {
      const anchor = (target as Element | null)?.closest?.("a");
      if (!anchor) return;
      const href = anchor.getAttribute("href");
      const rel = anchor.getAttribute("target");
      if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) return;
      if (rel && rel !== "_self") return;
      if (anchor.hasAttribute("download")) return;
      let url: URL;
      try { url = new URL(href, window.location.href); } catch { return; }
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname) return;
      /* Nothing declared for this route means nothing to warm — skip the work
         rather than calling router.prefetch on every anchor on the page. */
      if (specsForRoute(url.pathname).length === 0) return;
      arm(url.pathname);
    };

    const onOver = (e: PointerEvent) => fromEvent(e.target);
    const onFocus = (e: FocusEvent) => fromEvent(e.target);
    const onTouch = (e: TouchEvent) => fromEvent(e.target);

    document.addEventListener("pointerover", onOver, { passive: true });
    document.addEventListener("focusin", onFocus);
    document.addEventListener("touchstart", onTouch, { passive: true });
    return () => {
      document.removeEventListener("pointerover", onOver);
      document.removeEventListener("focusin", onFocus);
      document.removeEventListener("touchstart", onTouch);
    };
  }, [qc, router]);

  /* Warm the likely next routes once the current page has had its turn. */
  useEffect(() => {
    if (!signedIn) return;
    const targets = WARM_ON_MOUNT[window.location.pathname];
    if (!targets) return;
    return whenQuiet(qc, () => {
      for (const href of targets) {
        router.prefetch(href);
        prefetchRoute(qc, href, true);
      }
    });
  }, [signedIn, qc, router]);

  return null;
}
