"use client";

import { useEffect, useState, type RefObject } from "react";

/* ============================================================================
 * Why every reveal in this directory needs this hook.
 *
 * A framer-motion `initial={{ opacity: 0 }}` is serialised into the server-
 * rendered HTML as `style="opacity:0"`. That is correct for an entrance
 * animation and catastrophic for perceived speed: the landing page shipped 85
 * elements at opacity 0 — including the hero headline, which is the element the
 * browser would otherwise report as First Contentful Paint. The page was fully
 * rendered and readable in the HTML, and the reader saw nothing until the
 * JavaScript had downloaded, parsed, hydrated, and run the first frame of an
 * animation. Measured on the landing page that was ~1.4s to first content, most
 * of it spent hiding content that was already there.
 *
 * An entrance animation only means anything for content the reader has not seen
 * yet. So: render everything visible (no `initial`), and after hydration arm the
 * reveal ONLY for elements that were below the fold at that moment. Those are
 * off-screen, so flipping them to hidden costs nothing visually, and they still
 * animate in properly when scrolled to.
 *
 * Content above the fold therefore never animates in — it is simply there, on
 * the first paint, which is the whole point.
 * ========================================================================== */

/**
 * True once we know this element started life below the fold and should
 * therefore animate on entry. Always false for content that was already
 * on screen when the page hydrated.
 */
export function useRevealArmed(ref: RefObject<HTMLElement | null>): boolean {
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    /* 0.9 rather than 1.0: an element straddling the fold is partly visible, and
     * animating a partly-visible element is the flash this hook exists to
     * avoid. */
    if (rect.top > window.innerHeight * 0.9) setArmed(true);
  }, [ref]);

  return armed;
}
