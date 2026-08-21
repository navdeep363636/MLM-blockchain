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
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

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
const FALLBACK_MS = 1200;

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

  return (
    <motion.div
      ref={ref}
      className={className}
      initial={reduce ? { opacity: 0 } : { opacity: 0, y, filter: blur ? "blur(8px)" : "none" }}
      animate={shown ? { opacity: 1, y: 0, filter: "blur(0px)" } : undefined}
      transition={{ duration: 0.65, delay, ease: [0.16, 1, 0.3, 1] }}
    >
      {children}
    </motion.div>
  );
}

/** Staggered container — children fade up in sequence. */
export function RevealGroup({
  children, className, stagger = 0.08, delay = 0,
}: {
  children: React.ReactNode;
  className?: string;
  stagger?: number;
  delay?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const shown = useRevealed(ref, true);

  const parent: Variants = {
    hidden: {},
    show: { transition: { staggerChildren: stagger, delayChildren: delay } },
  };

  return (
    <motion.div
      ref={ref}
      className={className}
      variants={parent}
      initial="hidden"
      animate={shown ? "show" : "hidden"}
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
        show: { opacity: 1, y: 0, transition: { duration: 0.6, ease: [0.16, 1, 0.3, 1] } },
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
  const inView = useInView(ref, { once: true, margin: "-40px" });
  const reduce = useReducedMotion();
  const [display, setDisplay] = useState(reduce ? value : 0);

  useEffect(() => {
    if (!inView || reduce) { setDisplay(value); return; }
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / (duration * 1000));
      // easeOutExpo
      const eased = t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
      setDisplay(value * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [inView, value, duration, reduce]);

  const text = compact
    ? new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(display)
    : new Intl.NumberFormat("en-US", {
        minimumFractionDigits: decimals, maximumFractionDigits: decimals,
      }).format(display);

  return (
    <span ref={ref} className={cn("tnum", className)}>
      {prefix}{text}{suffix}
    </span>
  );
}

/* ------------------------------ Backgrounds ------------------------------ */

/** Slow-drifting orange aurora blobs. Purely decorative. */
export function AuroraBackground({ className, intensity = 1 }: { className?: string; intensity?: number }) {
  return (
    <div className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)} aria-hidden>
      <div
        className="absolute -left-[10%] -top-[20%] size-[46rem] rounded-full blur-[120px] animate-[aurora_22s_ease-in-out_infinite_alternate]"
        style={{ background: `color-mix(in oklab, var(--accent) ${22 * intensity}%, transparent)` }}
      />
      <div
        className="absolute -right-[15%] top-[10%] size-[38rem] rounded-full blur-[130px] animate-[aurora_28s_ease-in-out_infinite_alternate-reverse]"
        style={{ background: `color-mix(in oklab, var(--color-brand-700) ${18 * intensity}%, transparent)` }}
      />
      <div
        className="absolute bottom-[-25%] left-[25%] size-[34rem] rounded-full blur-[140px] animate-[aurora_34s_ease-in-out_infinite_alternate]"
        style={{ background: `color-mix(in oklab, var(--series-2) ${9 * intensity}%, transparent)` }}
      />
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
  return (
    <div className={cn("group relative flex overflow-hidden mask-fade-edges", className)}>
      <div
        className={cn(
          "flex min-w-full shrink-0 items-center gap-8 will-change-transform",
          pauseOnHover && "group-hover:[animation-play-state:paused]",
        )}
        style={{
          animation: `marquee ${speed}s linear infinite${reverse ? " reverse" : ""}`,
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

  return (
    <motion.div
      ref={ref}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
      style={{ rotateX: rx, rotateY: ry, transformStyle: "preserve-3d", perspective: 1000 }}
      className={cn("relative", className)}
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
  );
}

/** Card whose border lights up where the cursor is. */
export function SpotlightCard({
  children, className,
}: { children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: -200, y: -200 });
  const reduce = useReducedMotion();

  return (
    <div
      ref={ref}
      onMouseMove={(e) => {
        if (reduce || !ref.current) return;
        const r = ref.current.getBoundingClientRect();
        setPos({ x: e.clientX - r.left, y: e.clientY - r.top });
      }}
      onMouseLeave={() => setPos({ x: -200, y: -200 })}
      className={cn("group relative overflow-hidden", className)}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
        style={{
          background: `radial-gradient(340px circle at ${pos.x}px ${pos.y}px, color-mix(in oklab, var(--accent) 13%, transparent), transparent 70%)`,
        }}
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
  return (
    <motion.div
      style={{ scaleX: w }}
      aria-hidden
      className={cn(
        "fixed inset-x-0 top-0 z-[90] h-0.5 origin-left bg-gradient-to-r from-[var(--color-brand-400)] to-[var(--color-brand-600)]",
        className,
      )}
    />
  );
}

/** Typewriter for hero sub-headlines. Cycles a word list. */
export function Typewriter({
  words, className, speed = 90, hold = 1800,
}: { words: string[]; className?: string; speed?: number; hold?: number }) {
  const reduce = useReducedMotion();
  const [i, setI] = useState(0);
  const [n, setN] = useState(0);
  const [del, setDel] = useState(false);

  useEffect(() => {
    if (reduce) return;
    const word = words[i % words.length];
    if (!del && n === word.length) {
      const t = setTimeout(() => setDel(true), hold);
      return () => clearTimeout(t);
    }
    if (del && n === 0) { setDel(false); setI((v) => v + 1); return; }
    const t = setTimeout(() => setN((v) => v + (del ? -1 : 1)), del ? speed / 2 : speed);
    return () => clearTimeout(t);
  }, [n, del, i, words, speed, hold, reduce]);

  const word = words[i % words.length];
  return (
    <span className={className}>
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
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
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
