"use client";

/* ============================================================================
 * A Link that shows its own pending state.
 *
 * The global indicator (route-progress.tsx) says "something is happening"; this
 * says "the thing you clicked is what's happening". On a sidebar of a dozen
 * items that distinction is the whole difference between a UI that feels
 * responsive and one that feels ignored — the reader needs to know their click
 * landed on the item they aimed at.
 *
 * WHY THE CLICK HANDLER WRITES TO THE DOM DIRECTLY
 * ------------------------------------------------
 * The obvious implementation is `useState` for an optimistic "claimed" flag, or
 * Next's own `useLinkStatus()`. Both were tried and both are invisible in the
 * case that matters. The App Router runs navigation inside `startTransition`,
 * and React defers every other re-render until that transition commits — so a
 * state-driven highlight paints at the same instant the new page does, which is
 * the one moment it is no longer needed. route-progress.tsx has the measured
 * numbers.
 *
 * Writing the class and the attribute straight onto the anchor sidesteps
 * React's scheduler entirely: the highlight moves with the pointer. The
 * teardown lives in route-progress.tsx (`clearLinkClaims`), which sweeps every
 * `[data-nav-pending]` when the navigation completes — imperative state needs
 * imperative cleanup, on the same frame the indicator itself is dismissed.
 *
 * `active` (the real, committed route match) is still React-driven, because by
 * the time it changes the render is already happening anyway.
 * ========================================================================== */

import Link from "next/link";
import { useCallback } from "react";
import { cn } from "@/lib/utils";

export interface NavLinkProps {
  href: string;
  children: React.ReactNode;
  className?: string;
  /** Applied while this link is the current route OR has just been clicked. */
  activeClassName?: string;
  active?: boolean;
  title?: string;
  onNavigate?: () => void;
  /** Where the pending indicator goes. Defaults to after the children. */
  indicatorClassName?: string;
  showIndicator?: boolean;
  /**
   * Passed straight to `next/link`. Leave it alone for one-off links; pass
   * `false` for a list of links that are all in the viewport at once, such as a
   * sidebar. Next prefetches every Link it can see as soon as the page loads,
   * which for the dashboard sidebar meant ~8 route chunks landing between 1.7s
   * and 2.1s on a cold /admin — while the page's own data was still in flight.
   * RoutePrefetcher warms the same routes on pointer intent instead.
   */
  prefetch?: boolean;
}

export function NavLink({
  href, children, className, activeClassName, active, title,
  onNavigate, indicatorClassName, showIndicator = true, prefetch,
}: NavLinkProps) {
  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLAnchorElement>) => {
      const el = e.currentTarget;
      /* Modified clicks open a new tab; this link is not becoming current. */
      if (e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) {
        if (showIndicator) el.setAttribute("data-nav-pending", "");
        if (activeClassName && !active) {
          const tokens = activeClassName.split(" ").filter(Boolean);
          el.classList.add(...tokens);
          /* Recorded so the sweep removes exactly what was added and nothing
             the component legitimately owns. */
          el.dataset.navClaimed = tokens.join(" ");
        }
      }
      onNavigate?.();
    },
    [onNavigate, activeClassName, active, showIndicator],
  );

  return (
    <Link
      href={href}
      title={title}
      prefetch={prefetch}
      onClick={handleClick}
      data-active={active || undefined}
      className={cn("nav-link", className, active && activeClassName)}
      /* The spinner is a ::after on [data-nav-pending] (globals.css) rather than
         a child element, so appearing costs no React render at all. */
    >
      {children}
    </Link>
  );
}
