"use client";

/* ============================================================================
 * Navigation progress bar.
 *
 * THE PROBLEM
 * -----------
 * A `loading.tsx` boundary fixes the case where a route segment has work to do:
 * the router commits the navigation and shows a skeleton. But there is a window
 * BEFORE that — between the click and the router committing — where the App
 * Router is fetching the RSC payload and still rendering the old page. On a warm
 * prefetch that window is a few milliseconds and nobody notices. On a cold one,
 * a slow connection, or a dev server compiling the route on demand, it is
 * hundreds of milliseconds to seconds of a page that looks like it ignored the
 * click.
 *
 * So this bar is the acknowledgement: it appears within one frame of the click,
 * regardless of what the router is doing, and disappears when the URL has
 * actually changed.
 *
 * WHY A DOCUMENT-LEVEL LISTENER
 * -----------------------------
 * Next exposes `useLinkStatus()` for the pending state of an individual `<Link>`
 * (used in nav-link.tsx for the per-item spinner), but there is no public "the
 * router is navigating" signal. The alternative to listening here would be
 * replacing every `<Link>` in ~100 files with a wrapper that reports intent,
 * which is a lot of churn and one forgotten import away from a dead spot.
 *
 * A capture-phase listener on `document` sees every click on every internal
 * anchor — `<Link>` renders one — including ones added later by code that knows
 * nothing about this file. `startRouteProgress()` is exported for the handful of
 * places that navigate programmatically via `router.push`.
 *
 * The bar is deliberately NOT a fake percentage crawling to 90%. It eases toward
 * a ceiling it never reaches while work is outstanding, then completes. A bar
 * that pretends to know how far along it is starts lying the moment a request
 * takes longer than average.
 * ========================================================================== */

import { usePathname, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

/* Module-scope so `startRouteProgress` works from anywhere without a context. */
const listeners = new Set<() => void>();

/** Call immediately before a programmatic `router.push` / `router.replace`. */
export function startRouteProgress() {
  listeners.forEach((fn) => fn());
}

/** Below this, a transition is imperceptible and a flashing bar is just noise. */
const SHOW_AFTER_MS = 90;
/* A navigation that never completes must not leave the bar stuck on screen —
 * a redirect to the same URL, for instance, changes nothing for `usePathname`
 * to notice. */
const MAX_MS = 12_000;

export function RouteProgress() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [active, setActive] = useState(false);
  const [done, setDone] = useState(false);

  const showTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const maxTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const doneTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimers = useCallback(() => {
    for (const t of [showTimer, maxTimer, doneTimer]) {
      if (t.current) { clearTimeout(t.current); t.current = null; }
    }
  }, []);

  const begin = useCallback(() => {
    clearTimers();
    setDone(false);
    showTimer.current = setTimeout(() => setActive(true), SHOW_AFTER_MS);
    maxTimer.current = setTimeout(() => { setActive(false); setDone(false); }, MAX_MS);
  }, [clearTimers]);

  /* Register the imperative entry point. */
  useEffect(() => {
    listeners.add(begin);
    return () => { listeners.delete(begin); };
  }, [begin]);

  /* Every internal navigation starts with a click on an anchor. Capture phase so
   * we see it even if the app calls stopPropagation on its own handler. */
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      /* Modified clicks open a new tab — this page is not navigating. */
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

      const anchor = (e.target as Element | null)?.closest?.("a");
      if (!anchor) return;

      const href = anchor.getAttribute("href");
      const target = anchor.getAttribute("target");
      if (!href || (target && target !== "_self")) return;
      /* Same-document jumps, mailto:, tel:, downloads — not route changes. */
      if (href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) return;
      if (anchor.hasAttribute("download")) return;

      let url: URL;
      try { url = new URL(href, window.location.href); } catch { return; }
      if (url.origin !== window.location.origin) return;
      /* Clicking the link you are already on is not a navigation. */
      if (url.pathname + url.search === window.location.pathname + window.location.search) return;

      begin();
    };

    /* Back/forward is a navigation too, and the only signal is popstate. */
    const onPop = () => begin();

    document.addEventListener("click", onClick, true);
    window.addEventListener("popstate", onPop);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("popstate", onPop);
    };
  }, [begin]);

  /* The URL changing IS the navigation completing. */
  useEffect(() => {
    clearTimers();
    setActive((wasActive) => {
      if (wasActive) {
        /* Run the bar out to full so it reads as finished rather than cancelled. */
        setDone(true);
        doneTimer.current = setTimeout(() => setDone(false), 220);
      }
      return false;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, searchParams]);

  useEffect(() => clearTimers, [clearTimers]);

  if (!active && !done) return null;

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-x-0 top-0 z-[300] h-[2px] overflow-hidden"
    >
      <div
        className={
          done
            ? "h-full w-full bg-[linear-gradient(90deg,var(--color-brand-600),var(--accent))] transition-[width,opacity] duration-200 ease-out opacity-0"
            : "h-full animate-[route-progress_1.4s_cubic-bezier(0.2,0.8,0.2,1)_forwards] bg-[linear-gradient(90deg,var(--color-brand-600),var(--accent)_60%,var(--color-brand-300))] [box-shadow:0_0_10px_1px_var(--accent-ring)]"
        }
      />
    </div>
  );
}
