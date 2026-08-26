"use client";

/* ============================================================================
 * TEXT MOTION.
 *
 * Headlines that assemble as they enter. Two accessibility rules govern
 * everything here:
 *
 *   · Word-splitting keeps the spaces, so a screen reader reads the sentence
 *     normally and no `aria-label` is needed.
 *   · Character-splitting does NOT — "Members" as seven spans is read as seven
 *     letters by some engines. So `CharCascade` sets an `aria-label` on the
 *     container and hides the spans.
 *
 * And one design rule: the reveal is on the CONTAINER's entry, not per word's
 * own entry. Per-word observers make a long headline animate its last word
 * seconds after its first, on a slow scroll, which reads as broken.
 * ========================================================================== */

import { motion, useInView, useReducedMotion, type Variants } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/* The same guarantee as `Reveal` in ./index: if the observer never fires — fast
   programmatic scroll, print, restored scroll position — show anyway. A blank
   headline is a broken page. */
const FALLBACK_MS = 1000;

function useEntered(ref: React.RefObject<HTMLElement | null>, margin = "-12%") {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const inView = useInView(ref, { once: true, margin: margin as any });
  const [fallback, setFallback] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setFallback(true), FALLBACK_MS);
    return () => clearTimeout(t);
  }, []);
  return inView || fallback;
}

/* -------------------------------------------------------------------------- */

const wordParent = (stagger: number, delay: number): Variants => ({
  hidden: {},
  show: { transition: { staggerChildren: stagger, delayChildren: delay } },
});

const wordChild: Variants = {
  hidden: { y: "108%", rotateX: -52, opacity: 0 },
  show: {
    y: "0%",
    rotateX: 0,
    opacity: 1,
    transition: { duration: 0.78, ease: [0.16, 1, 0.3, 1] },
  },
};

/**
 * Words rise out of their own baseline, each rotating up from below the line —
 * the mask is a per-word `overflow: hidden`, so they appear to be printed on a
 * cylinder turning toward the reader.
 *
 * Pass `as="h1"` to keep the heading semantics. Children must be a plain
 * string; for mixed markup, use `LineReveal` around each line instead.
 */
export function WordReveal({
  children, className, as: Tag = "span", stagger = 0.055, delay = 0, highlight,
}: {
  children: string;
  className?: string;
  as?: "span" | "h1" | "h2" | "h3" | "p" | "div";
  stagger?: number;
  delay?: number;
  /** Words listed here get the brand gradient. Matched case-insensitively. */
  highlight?: string[];
}) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLSpanElement>(null);
  const shown = useEntered(ref);
  const words = children.split(" ");
  const hot = new Set((highlight ?? []).map((w) => w.toLowerCase().replace(/[^a-z0-9]/g, "")));

  if (reduce) return <Tag className={className}>{children}</Tag>;

  const MotionTag = motion[Tag] as typeof motion.span;

  return (
    <MotionTag
      ref={ref}
      className={cn("scene-near", className)}
      variants={wordParent(stagger, delay)}
      initial="hidden"
      animate={shown ? "show" : "hidden"}
    >
      {words.map((w, i) => (
        /* NOT `.clip-line` — that utility is `display: block`, and using it
           here put every word of the headline on its own line. The mask has to
           stay inline; the vertical padding/negative-margin pair gives the
           descenders (g, y, p) room inside the overflow clip. */
        <span
          key={`${w}-${i}`}
          className="inline-block overflow-hidden align-bottom pb-[0.16em] -mb-[0.16em]"
        >
          <motion.span
            variants={wordChild}
            className={cn(
              "inline-block origin-bottom will-change-transform",
              hot.has(w.toLowerCase().replace(/[^a-z0-9]/g, "")) && "text-gradient-brand",
            )}
            style={{ transformStyle: "preserve-3d" }}
          >
            {w}
          </motion.span>
          {i < words.length - 1 && <span className="inline-block">&nbsp;</span>}
        </span>
      ))}
    </MotionTag>
  );
}

/**
 * Reveals arbitrary children from behind a horizontal mask, one line at a time.
 * Use where the content is not a plain string (links, `<br>`, nested spans).
 */
export function LineReveal({
  children, className, delay = 0, duration = 0.85,
}: { children: React.ReactNode; className?: string; delay?: number; duration?: number }) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const shown = useEntered(ref);

  if (reduce) return <div className={className}>{children}</div>;

  return (
    <div ref={ref} className={cn("clip-line", className)}>
      <motion.div
        initial={{ y: "104%", opacity: 0 }}
        animate={shown ? { y: "0%", opacity: 1 } : undefined}
        transition={{ duration, delay, ease: [0.16, 1, 0.3, 1] }}
        className="will-change-transform"
      >
        {children}
      </motion.div>
    </div>
  );
}

/**
 * Characters fade in from a random depth. Reserved for very short strings —
 * a wordmark, a number, a two-word label. On a sentence it is illegible noise.
 */
export function CharCascade({
  children, className, stagger = 0.028, delay = 0,
}: { children: string; className?: string; stagger?: number; delay?: number }) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLSpanElement>(null);
  const shown = useEntered(ref);
  const chars = [...children];

  if (reduce) return <span className={className}>{children}</span>;

  return (
    <span ref={ref} className={cn("scene-near inline-flex", className)} aria-label={children} role="text">
      {chars.map((c, i) => (
        <motion.span
          key={i}
          aria-hidden
          className="inline-block will-change-transform"
          initial={{ opacity: 0, z: -60, rotateY: i % 2 ? 42 : -42, y: 10 }}
          animate={shown ? { opacity: 1, z: 0, rotateY: 0, y: 0 } : undefined}
          transition={{ duration: 0.6, delay: delay + i * stagger, ease: [0.16, 1, 0.3, 1] }}
          style={{ transformStyle: "preserve-3d" }}
        >
          {c === " " ? " " : c}
        </motion.span>
      ))}
    </span>
  );
}

/**
 * A block that is wiped in by a moving mask, with a bright edge riding the wipe.
 * Good for images, charts and code blocks — anything that should not be
 * translated but should still arrive.
 */
export function MaskWipe({
  children, className, from = "bottom", delay = 0,
}: {
  children: React.ReactNode;
  className?: string;
  from?: "bottom" | "left" | "top" | "right";
  delay?: number;
}) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const shown = useEntered(ref);

  const axis = from === "left" || from === "right" ? "to right" : "to bottom";
  const flip = from === "right" || from === "top";

  if (reduce) return <div className={className}>{children}</div>;

  return (
    <div ref={ref} className={cn("relative", className)}>
      <motion.div
        initial={{ clipPath: flip ? "inset(0 0 0 100%)" : axis === "to right" ? "inset(0 100% 0 0)" : "inset(100% 0 0 0)" }}
        animate={shown ? { clipPath: "inset(0 0 0 0)" } : undefined}
        transition={{ duration: 1, delay, ease: [0.16, 1, 0.3, 1] }}
      >
        {children}
      </motion.div>
      <motion.span
        aria-hidden
        className="pointer-events-none absolute inset-0"
        initial={{ opacity: 0.9 }}
        animate={shown ? { opacity: 0 } : undefined}
        transition={{ duration: 1.1, delay, ease: "linear" }}
        style={{
          background: `linear-gradient(${axis === "to right" ? "90deg" : "180deg"}, transparent 55%, color-mix(in oklab, var(--accent) 30%, transparent) 78%, transparent)`,
        }}
      />
    </div>
  );
}

/**
 * Eyebrow / kicker with a hairline that draws itself. Small, and it is the
 * cheapest way to make a section header feel authored rather than templated.
 */
export function KickerRule({ children, className }: { children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const shown = useEntered(ref);
  return (
    <div ref={ref} className={cn("flex items-center gap-3", className)}>
      <span className="text-[0.7rem] font-semibold uppercase tracking-[0.22em] text-[var(--accent-hover)]">
        {children}
      </span>
      <motion.span
        aria-hidden
        className="h-px flex-1 origin-left"
        style={{ background: "linear-gradient(90deg, var(--accent-ring), transparent)" }}
        initial={{ scaleX: 0 }}
        animate={shown ? { scaleX: 1 } : undefined}
        transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
      />
    </div>
  );
}
