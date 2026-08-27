"use client";

/* ============================================================================
 * Motion & effect primitives. Every one of these respects
 * prefers-reduced-motion (framer-motion's useReducedMotion, plus the global
 * CSS override in globals.css).
 * ========================================================================== */

import {
  AnimatePresence, motion, useInView, useMotionValue, useReducedMotion,
  useScroll, useSpring, useTransform, type Variants,
} from "framer-motion";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { useRevealArmed } from "./reveal-gate";

/* ------------------------------- Reveal ---------------------------------- */

/**
 * Scroll-reveal primitives.
 *
 * These drive `animate` from an explicit `useInView` result rather than
 * `whileInView`, plus a mount-time fallback timer. That matters: an
 * IntersectionObserver can be outrun by fast programmatic scrolling, print
 * layout, or a restored scroll position, and a section stuck at opacity 0 is a
 * blank page to the user. The fallback guarantees content becomes visible
 * within FALLBACK_MS whether or not the observer ever fires.
 */
/*
 * 1200ms before. An IntersectionObserver callback for content that is already
 * on screen lands within a frame or two, so the only thing a long fallback ever
 * did was hold content at opacity 0 for over a second when the observer had
 * genuinely failed. 180ms is still comfortably longer than the observer needs
 * and short enough that a failure is invisible rather than a blank page.
 */
const FALLBACK_MS = 180;

/* One duration and one easing for every reveal, so the whole page settles
 * together. 0.65s + a 0.08s-per-child stagger meant the tenth card in a grid
 * finished 1.4s after the route painted — read as "the page is still loading". */
const REVEAL_DUR = 0.26;
const REVEAL_EASE = [0.16, 1, 0.3, 1] as const;

function useRevealed(ref: React.RefObject<HTMLElement | null>, once = true) {
  const inView = useInView(ref, { once, margin: "-60px" });
  const [fallback, setFallback] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setFallback(true), FALLBACK_MS);
    return () => clearTimeout(t);
  }, []);

  return inView || fallback;
}

export function Reveal({
  children, delay = 0, y = 18, className, once = true, blur,
}: {
  children: React.ReactNode;
  delay?: number;
  y?: number;
  className?: string;
  once?: boolean;
  blur?: boolean;
}) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const shown = useRevealed(ref, once);
  /* See ./reveal-gate.ts — no `initial`, so the server-rendered HTML is visible
     and above-the-fold content paints without waiting for JavaScript. */
  const armed = useRevealArmed(ref);
  const hide = armed && !shown;

  return (
    <motion.div
      ref={ref}
      className={className}
      /* `blur` is accepted for call-site compatibility and deliberately not
         applied: animating `filter` forces a full repaint of the subtree every
         frame, which on a grid of reveals is the most expensive thing on the
         page for the least visible gain. */
      initial={false}
      animate={hide ? { opacity: 0, y: reduce ? 0 : y } : { opacity: 1, y: 0 }}
      transition={{ duration: REVEAL_DUR, delay, ease: REVEAL_EASE }}
    >
      {children}
    </motion.div>
  );
}

/** Staggered container — children fade up in sequence. */
export function RevealGroup({
  children, className, stagger = 0.03, delay = 0,
}: {
  children: React.ReactNode;
  className?: string;
  stagger?: number;
  delay?: number;
}) {
  /* Callers pass the old 0.08 default explicitly in places; clamp it so no
   * grid can push its last child more than ~0.2s behind its first. */
  const step = Math.min(stagger, 0.03);
  const ref = useRef<HTMLDivElement>(null);
  const shown = useRevealed(ref, true);
  const armed = useRevealArmed(ref);

  const parent: Variants = {
    hidden: {},
    show: { transition: { staggerChildren: step, delayChildren: delay } },
  };

  return (
    <motion.div
      ref={ref}
      className={className}
      variants={parent}
      initial={false}
      animate={armed && !shown ? "hidden" : "show"}
    >
      {children}
    </motion.div>
  );
}

export function RevealItem({ children, className, y = 16 }: { children: React.ReactNode; className?: string; y?: number }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={className}
      variants={{
        hidden: reduce ? { opacity: 0 } : { opacity: 0, y },
        show: { opacity: 1, y: 0, transition: { duration: REVEAL_DUR, ease: REVEAL_EASE } },
      }}
    >
      {children}
    </motion.div>
  );
}

/* ---------------------------- AnimatedCounter ---------------------------- */

/**
 * Counts up when scrolled into view. `decimals` keeps money stable, and the
 * value is rendered with tabular figures so digits don't jitter mid-animation.
 */
export function AnimatedCounter({
  value, decimals = 0, duration = 1.5, prefix = "", suffix = "", className, compact,
}: {
  value: number;
  decimals?: number;
  duration?: number;
  prefix?: string;
  suffix?: string;
  className?: string;
  compact?: boolean;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const out = useRef<HTMLSpanElement>(null);
  /* What the DOM node is currently showing, so a live update can tween from it. */
  const shown = useRef(0);
  const inView = useInView(ref, { once: true, margin: "-40px" });
  const reduce = useReducedMotion();

  /* Built once per (compact, decimals) pair. The old code constructed a fresh
   * Intl.NumberFormat inside the render body, which ran on every one of the
   * ~90 frames of the count-up — Intl construction is one of the more expensive
   * calls available in a browser. */
  const fmt = useMemo(
    () =>
      compact
        ? new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 })
        : new Intl.NumberFormat("en-US", {
            minimumFractionDigits: decimals,
            maximumFractionDigits: decimals,
          }),
    [compact, decimals],
  );

  /* The count-up writes to the DOM node directly instead of through setState.
   *
   * This is the single hottest path in the app: AnimatedCounter is inside
   * StatTile, StatTile appears ~57 times, and a setState per animation frame
   * re-rendered the whole tile subtree — including its recharts sparkline —
   * around 90 times per counter. Writing textContent is one property assignment
   * and touches nothing above it in the tree.
   *
   * The rendered text still starts at the final value so SSR output, the
   * no-JS case and prefers-reduced-motion are all correct without a frame of "0".
   */
  useEffect(() => {
    const node = out.current;
    if (!node) return;

    const settle = () => { shown.current = value; node.textContent = fmt.format(value); };
    if (!inView || reduce) { settle(); return; }

    /* Tween from whatever is currently on screen, not from zero.
     *
     * `value` is in the dependency list, so a live figure re-ran this effect on
     * every update — and the old code always started at `value * eased(0)` = 0.
     * A score ticking once a second therefore counted up from zero once a
     * second, which looks like a bug and is one. The first reveal still counts
     * up from zero because `from` starts there. */
    const from = shown.current;
    const delta = value - from;
    if (delta === 0) { settle(); return; }

    /* A big first reveal earns the full count-up; a small live delta should
     * resolve quickly or it lags behind the next update. */
    const ms = (from === 0 ? duration : Math.min(duration, 0.45)) * 1000;

    let raf = 0;
    let start = 0;
    const tick = (now: number) => {
      if (!start) start = now;
      const t = Math.min(1, (now - start) / ms);
      const eased = t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
      const current = from + delta * eased;
      shown.current = current;
      node.textContent = fmt.format(current);
      /* A backgrounded tab still fires rAF in some browsers; bail rather than
       * animating something nobody can see. */
      if (t < 1 && !document.hidden) raf = requestAnimationFrame(tick);
      else settle();
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [inView, value, duration, reduce, fmt]);

  return (
    <span ref={ref} className={cn("tnum", className)}>
      {prefix}
      <span ref={out}>{fmt.format(value)}</span>
      {suffix}
    </span>
  );
}

/* ------------------------------ Backgrounds ------------------------------ */

/**
 * Slow-drifting coloured lights. Purely decorative.
 *
 * Now built from the `--haze-*` tokens rather than literal colour-mixes, so the
 * light-theme variant is a different, softer set of colours instead of the dark
 * palette at lower opacity — which is what made this read grey in light mode.
 */
/* Module-scope: the array is identical on every render, and rebuilding it made
 * every one of these layers a new style object for React to diff. */
const AURORA_LAYERS = [
    { v: "--haze-1", cls: "-left-[10%] -top-[20%] size-[46rem] blur-[72px]", anim: "aurora 22s ease-in-out infinite alternate" },
    { v: "--haze-2", cls: "-right-[15%] top-[6%] size-[38rem] blur-[76px]", anim: "aurora 28s ease-in-out infinite alternate-reverse" },
    { v: "--haze-3", cls: "bottom-[-25%] left-[22%] size-[34rem] blur-[80px]", anim: "aurora 34s ease-in-out infinite alternate" },
    { v: "--haze-4", cls: "right-[12%] bottom-[-10%] size-[26rem] blur-[70px]", anim: "drift-3d 30s ease-in-out infinite alternate" },
] as const;

export function AuroraBackground({ className, intensity = 1 }: { className?: string; intensity?: number }) {
  /* `motion-reduce:animate-none` was on the class list while `animation` was
   * ALSO set in the inline style object — and an inline declaration beats an
   * author stylesheet, so these four layers kept animating for users who had
   * asked the OS for no animation. Gate it in JS, where the style object is. */
  const reduce = useReducedMotion();
  return (
    <div className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)} aria-hidden>
      {AURORA_LAYERS.map((l) => (
        <div
          key={l.v}
          className={cn("absolute rounded-full", l.cls)}
          style={{
            background: `var(${l.v})`,
            opacity: intensity,
            animation: reduce ? undefined : l.anim,
          }}
        />
      ))}
    </div>
  );
}

export function GridBackdrop({ className, fade = true }: { className?: string; fade?: boolean }) {
  return (
    <div
      aria-hidden
      className={cn("pointer-events-none absolute inset-0 bg-grid opacity-[0.55]", fade && "mask-fade-b", className)}
    />
  );
}

export function NoiseOverlay({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn("pointer-events-none absolute inset-0 opacity-[0.035] mix-blend-overlay", className)}
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3'/%3E%3C/filter%3E%3Crect width='140' height='140' filter='url(%23n)'/%3E%3C/svg%3E\")",
      }}
    />
  );
}

/** Floating token/coin motes — used behind the hero and empty states. */
export function FloatingOrbs({ count = 14, className }: { count?: number; className?: string }) {
  const reduce = useReducedMotion();
  // Deterministic layout so SSR and client agree.
  const orbs = Array.from({ length: count }, (_, i) => {
    const a = (i * 2654435761) % 1000 / 1000;
    const b = (i * 40503 + 17) % 1000 / 1000;
    const c = (i * 97 + 31) % 1000 / 1000;
    return { left: `${a * 100}%`, top: `${b * 100}%`, size: 3 + c * 7, dur: 6 + c * 8, delay: a * 5 };
  });
  return (
    <div className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)} aria-hidden>
      {orbs.map((o, i) => (
        <span
          key={i}
          className="absolute rounded-full"
          style={{
            left: o.left, top: o.top, width: o.size, height: o.size,
            background: "color-mix(in oklab, var(--accent) 55%, transparent)",
            boxShadow: "0 0 12px color-mix(in oklab, var(--accent) 65%, transparent)",
            animation: reduce ? undefined : `float ${o.dur}s ease-in-out ${o.delay}s infinite`,
          }}
        />
      ))}
    </div>
  );
}

/* -------------------------------- Marquee -------------------------------- */

export function Marquee({
  children, speed = 40, className, pauseOnHover = true, reverse,
}: {
  children: React.ReactNode;
  speed?: number;
  className?: string;
  pauseOnHover?: boolean;
  reverse?: boolean;
}) {
  const reduce = useReducedMotion();
  return (
    <div className={cn("group relative flex overflow-hidden mask-fade-edges", className)}>
      <div
        className={cn(
          "flex min-w-full shrink-0 items-center gap-8 will-change-transform",
          pauseOnHover && "group-hover:[animation-play-state:paused]",
        )}
        style={{
          /* Inline `animation` beats `motion-reduce:animate-none`, so the
             reduced-motion opt-out has to happen here. */
          animation: reduce ? undefined : `marquee ${speed}s linear infinite${reverse ? " reverse" : ""}`,
        }}
      >
        {children}
        {children}
      </div>
    </div>
  );
}

/* ------------------------------- TiltCard -------------------------------- */

/** Pointer-tracked 3D tilt with a specular highlight. Wrap any card. */
export function TiltCard({
  children, className, max = 8, glare = true,
}: {
  children: React.ReactNode;
  className?: string;
  max?: number;
  glare?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const rx = useSpring(useMotionValue(0), { stiffness: 200, damping: 20 });
  const ry = useSpring(useMotionValue(0), { stiffness: 200, damping: 20 });
  const gx = useMotionValue(50);
  const gy = useMotionValue(50);

  const onMove = (e: React.MouseEvent) => {
    if (reduce || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width;
    const py = (e.clientY - r.top) / r.height;
    ry.set((px - 0.5) * max * 2);
    rx.set(-(py - 0.5) * max * 2);
    gx.set(px * 100);
    gy.set(py * 100);
  };
  const onLeave = () => { rx.set(0); ry.set(0); };

  const glareBg = useTransform([gx, gy], ([x, y]) =>
    `radial-gradient(300px circle at ${x}% ${y}%, color-mix(in oklab, var(--accent) 22%, transparent), transparent 65%)`,
  );

  /* `perspective` applies to an element's CHILDREN, never to the element it is
     declared on. It used to sit on the same node as the rotation here, which
     made the "3D" tilt a plain affine skew — no foreshortening, no near edge.
     The perspective now lives on this wrapper, one level up from the rotation,
     which is the only place it does anything. */
  return (
    <div className="scene h-full" style={{ perspective: 1000 }}>
      <motion.div
        ref={ref}
        onMouseMove={onMove}
        onMouseLeave={onLeave}
        style={{ rotateX: rx, rotateY: ry, transformStyle: "preserve-3d" }}
        className={cn("relative h-full", className)}
      >
        {children}
        {glare && !reduce && (
          <motion.span
            aria-hidden
            style={{ backgroundImage: glareBg }}
            className="pointer-events-none absolute inset-0 rounded-[inherit] opacity-0 transition-opacity duration-300 hover:opacity-100"
          />
        )}
      </motion.div>
    </div>
  );
}

/** Card whose border lights up where the cursor is. */
export function SpotlightCard({
  children, className,
}: { children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const glow = useRef<HTMLSpanElement>(null);
  const reduce = useReducedMotion();

  /* The pointer position drives two CSS custom properties on the glow element
   * rather than React state.
   *
   * This used to be `setPos()` in onMouseMove. SpotlightCard wraps the entire
   * body of StatTile — counter, sparkline and all — so a full React re-render of
   * that subtree ran at pointer rate (~60-120 Hz) for as long as the cursor was
   * anywhere over any of the ~57 stat tiles in the app. Hovering a tile
   * re-rendered a recharts chart sixty times a second.
   *
   * Reads are batched into a rAF so several pointer events in one frame collapse
   * to a single style write, and the bounding rect is measured once per frame
   * instead of once per event. */
  const frame = useRef(0);
  const pending = useRef<{ x: number; y: number } | null>(null);

  const flush = useCallback(() => {
    frame.current = 0;
    const node = glow.current;
    const next = pending.current;
    if (!node || !next) return;
    node.style.setProperty("--spot-x", `${next.x}px`);
    node.style.setProperty("--spot-y", `${next.y}px`);
  }, []);

  const onMove = useCallback(
    (e: React.MouseEvent) => {
      if (reduce || !ref.current) return;
      const r = ref.current.getBoundingClientRect();
      pending.current = { x: e.clientX - r.left, y: e.clientY - r.top };
      if (!frame.current) frame.current = requestAnimationFrame(flush);
    },
    [reduce, flush],
  );

  const onLeave = useCallback(() => {
    pending.current = { x: -200, y: -200 };
    if (!frame.current) frame.current = requestAnimationFrame(flush);
  }, [flush]);

  useEffect(() => () => { if (frame.current) cancelAnimationFrame(frame.current); }, []);

  return (
    <div
      ref={ref}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
      className={cn("group relative overflow-hidden", className)}
    >
      <span
        ref={glow}
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-200 group-hover:opacity-100"
        style={{
          "--spot-x": "-200px",
          "--spot-y": "-200px",
          background:
            "radial-gradient(340px circle at var(--spot-x) var(--spot-y), color-mix(in oklab, var(--accent) 13%, transparent), transparent 70%)",
        } as React.CSSProperties}
      />
      {children}
    </div>
  );
}

/* ------------------------------ Interactions ----------------------------- */

/** Button wrapper that leans toward the cursor. Use for hero CTAs only. */
export function Magnetic({ children, strength = 0.25, className }: { children: React.ReactNode; strength?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const x = useSpring(useMotionValue(0), { stiffness: 260, damping: 18 });
  const y = useSpring(useMotionValue(0), { stiffness: 260, damping: 18 });

  return (
    <motion.div
      ref={ref}
      style={{ x, y }}
      className={cn("inline-block", className)}
      onMouseMove={(e) => {
        if (reduce || !ref.current) return;
        const r = ref.current.getBoundingClientRect();
        x.set((e.clientX - (r.left + r.width / 2)) * strength);
        y.set((e.clientY - (r.top + r.height / 2)) * strength);
      }}
      onMouseLeave={() => { x.set(0); y.set(0); }}
    >
      {children}
    </motion.div>
  );
}

export function ScrollProgress({ className }: { className?: string }) {
  const { scrollYProgress } = useScroll();
  const w = useSpring(scrollYProgress, { stiffness: 120, damping: 26, restDelta: 0.001 });
  const head = useTransform(w, (v) => `${Math.min(1, Math.max(0, v)) * 100}%`);
  return (
    <div aria-hidden className={cn("pointer-events-none fixed inset-x-0 top-0 z-[90] h-[3px]", className)}>
      <motion.div
        style={{ scaleX: w }}
        className="h-full origin-left bg-[linear-gradient(90deg,var(--color-brand-600),var(--accent)_55%,var(--color-brand-300))]"
      />
      {/* The head: a small bright dot that rides the leading edge. Positioned
          with `left`, not parented to the scaled bar — a child of a scaleX
          transform is stretched with it, and the dot would render as an
          ever-widening ellipse. */}
      <motion.span
        style={{ left: head }}
        className="absolute top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--color-brand-200)] shadow-[0_0_12px_2px_var(--accent-ring)]"
      />
    </div>
  );
}

/** Typewriter for hero sub-headlines. Cycles a word list. */
export function Typewriter({
  words, className, speed = 90, hold = 1800,
}: { words: string[]; className?: string; speed?: number; hold?: number }) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLSpanElement>(null);
  /* Gated on visibility. This is an infinite setState cycle at 90ms — on the
   * landing page it kept re-rendering the hero for the entire session, however
   * far the reader had scrolled past it, and kept running in a background tab.
   * `once: false` so it stops again when scrolled away. */
  const inView = useInView(ref, { once: false, margin: "0px" });
  const [i, setI] = useState(0);
  const [n, setN] = useState(0);
  const [del, setDel] = useState(false);

  useEffect(() => {
    if (reduce || !inView) return;
    const word = words[i % words.length];
    if (!del && n === word.length) {
      const t = setTimeout(() => setDel(true), hold);
      return () => clearTimeout(t);
    }
    if (del && n === 0) { setDel(false); setI((v) => v + 1); return; }
    const t = setTimeout(() => setN((v) => v + (del ? -1 : 1)), del ? speed / 2 : speed);
    return () => clearTimeout(t);
  }, [n, del, i, words, speed, hold, reduce, inView]);

  const word = words[i % words.length];
  return (
    <span ref={ref} className={className}>
      {reduce ? words[0] : word.slice(0, n)}
      {!reduce && <span className="ml-0.5 inline-block h-[1em] w-0.5 translate-y-[0.12em] animate-pulse bg-[var(--accent)]" />}
    </span>
  );
}

/** Live "pulse" dot for real-time indicators. */
export function LiveDot({ className, label }: { className?: string; label?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <span className="relative grid size-2 place-items-center">
        <span className="absolute size-2 rounded-full bg-good-500" />
        <span className="absolute size-2 animate-ping rounded-full bg-good-500 opacity-60" />
      </span>
      {label && <span className="text-xs font-medium text-text-muted">{label}</span>}
    </span>
  );
}

/** Page-level fade/slide used by route layouts. */
export function PageTransition({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    /* Opacity only, and short.
     *
     * This wraps the content area of every route in the player and admin apps,
     * so its duration IS the perceived cost of a navigation. At 0.35s with a
     * y-offset, every route change read as a slow page load — the content was
     * there, it just was not shown yet. A translate also invalidates the
     * paint of the whole content area on the first frame.
     *
     * `transform-gpu` is deliberately absent: promoting the entire page content
     * to its own layer for 0.15s costs more than the fade saves. */
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.15, ease: "linear" }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

/** Number that flashes green/red when it changes — live balances, prices. */
export function FlashValue({ value, className, children }: { value: number | string; className?: string; children: React.ReactNode }) {
  const prev = useRef(value);
  const [flash, setFlash] = useState<"up" | "down" | null>(null);
  useEffect(() => {
    if (prev.current === value) return;
    const up = Number(value) > Number(prev.current);
    setFlash(up ? "up" : "down");
    prev.current = value;
    const t = setTimeout(() => setFlash(null), 700);
    return () => clearTimeout(t);
  }, [value]);
  return (
    <span
      className={cn(
        "transition-colors duration-500",
        flash === "up" && "text-good-400",
        flash === "down" && "text-critical-400",
        className,
      )}
    >
      {children}
    </span>
  );
}

export { AnimatePresence, motion };

/* ============================================================================
 * Theme v2 — "Helix". The depth layer.
 *
 * These are re-exported from here so every existing `@/components/fx` import
 * keeps working and picks the new primitives up for free. Nothing above was
 * removed or renamed: `Reveal`, `TiltCard`, `SpotlightCard`, `Magnetic` and the
 * rest still behave exactly as they did, and the new components sit alongside
 * them rather than replacing them.
 *
 *   ./scene       perspective containers, parallax, sticky scroll scenes
 *   ./helix       the 3D token helix, orbit rings, coins, the tide ribbon
 *   ./text        word / line / character reveals
 *   ./surfaces    holo cards, glass, magnetic CTAs, hover rows
 *   ./atmosphere  the background stack (mesh haze, star field, grid floor)
 * ========================================================================== */

export * from "./scene";
export * from "./helix";
export * from "./text";
export * from "./surfaces";
export * from "./atmosphere";
