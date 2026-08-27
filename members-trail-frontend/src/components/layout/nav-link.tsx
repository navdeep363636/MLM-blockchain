"use client";

/* ============================================================================
 * A Link that shows its own pending state.
 *
 * The global progress bar (route-progress.tsx) says "something is happening";
 * this says "the thing you clicked is what's happening". On a sidebar of a dozen
 * items that distinction is the whole difference between a UI that feels
 * responsive and one that feels ignored — the reader needs to know their click
 * landed on the item they aimed at.
 *
 * `useLinkStatus` is Next's own hook for this (15.3+). It only works in a
 * component rendered as a descendant of the `<Link>`, which is why the spinner
 * lives in its own tiny component rather than being computed in the parent.
 *
 * Two things this deliberately does NOT do:
 *
 *  - It does not delay the active/selected styling until the route commits. The
 *    clicked item takes the active treatment optimistically, on the click, so
 *    the highlight moves with the pointer instead of trailing the network.
 *  - It does not render a spinner for fast navigations. `useLinkStatus` flips
 *    pending immediately, and a spinner that appears and vanishes inside 100ms
 *    is a flicker, so the indicator fades in over a short delay via CSS.
 * ========================================================================== */

import Link from "next/link";
import { useLinkStatus } from "next/link";
import { useCallback, useState } from "react";
import { cn } from "@/lib/utils";

/** Rendered inside the Link, which is what `useLinkStatus` requires. */
function PendingDot({ className }: { className?: string }) {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  return (
    <span
      aria-hidden
      className={cn("size-3 shrink-0 rounded-full border-[1.5px] border-current border-t-transparent", className)}
      /* Inline rather than a Tailwind arbitrary value: this needs two comma-
       * separated animations, and a comma inside `[...]` is ambiguous to the
       * class parser. The 120ms delay on the fade is what stops a warm,
       * prefetched navigation from flashing a spinner nobody asked to see. */
      style={{
        opacity: 0,
        animation: "nav-spin 0.6s linear infinite, fade-in 120ms ease-out 120ms forwards",
      }}
    />
  );
}

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
}

export function NavLink({
  href, children, className, activeClassName, active, title,
  onNavigate, indicatorClassName, showIndicator = true,
}: NavLinkProps) {
  /* Optimistic selection. Cleared implicitly when `active` catches up, because
   * the parent re-renders with the new pathname and we OR the two together. */
  const [claimed, setClaimed] = useState(false);

  const handleClick = useCallback(() => {
    setClaimed(true);
    onNavigate?.();
  }, [onNavigate]);

  const isActive = active || claimed;

  return (
    <Link
      href={href}
      title={title}
      onClick={handleClick}
      data-active={isActive || undefined}
      className={cn(className, isActive && activeClassName)}
    >
      {children}
      {showIndicator && <PendingDot className={indicatorClassName} />}
    </Link>
  );
}
