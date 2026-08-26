"use client";

/* ============================================================================
 * SCENE — the depth layer.
 *
 * The idea this file exists to enforce: a page has ONE space, and things move
 * within it. Every primitive here either declares that space (`Scene`), places
 * something at a depth inside it (`DepthLayer`), or ties a transform to the
 * viewer's scroll position through it (`ParallaxLayer`, `ScrollScene`,
 * `StickyStack`).
 *
 * Two rules, both learned the hard way:
 *
 *   1. Perspective belongs to the CONTAINER. If each card sets its own
 *      `perspective`, each one has its own vanishing point and a grid of them
 *      looks like a bag of unrelated gimmicks. One `Scene` around the grid and
 *      the same tilt reads as a single object being turned.
 *
 *   2. A scroll-driven transform must be smoothed, not sampled. Raw
 *      `scrollYProgress` steps once per scroll event, which on a trackpad is
 *      visibly notchy. Every value here goes through a spring, so the motion
 *      lags the finger slightly and settles — that lag IS the "tide" feel.
 *
 * Everything degrades to a static, finished layout under
 * `prefers-reduced-motion`; nothing here is load-bearing for legibility.
 * ========================================================================== */

import { motion, useMotionTemplate, useReducedMotion, useScroll, useSpring, useTransform, type MotionValue } from "framer-motion";
import { useRef } from "react";
import { cn } from "@/lib/utils";

/* -------------------------------------------------------------------------- */
/*  Scene                                                                      */
/* -------------------------------------------------------------------------- */

export type ScenePerspective = "near" | "scene" | "far";

/**
 * Declares a shared vanishing point. Wrap a hero, a card grid, a table — any
 * group whose members should tilt toward the same point.
 *
 * `as` lets this be a `<section>`/`<ul>` so it does not add a wrapper div to
 * the accessibility tree where the semantics matter.
 */
export function Scene({
  children,
  className,
  depth = "scene",
  origin,
  as: Tag = "div",
}: {
  children: React.ReactNode;
  className?: string;
  depth?: ScenePerspective;
  /** CSS `perspective-origin`, e.g. "50% 20%" to put the light overhead. */
  origin?: string;
  as?: "div" | "section" | "ul" | "header" | "main" | "aside";
}) {
  const cls = depth === "near" ? "scene-near" : depth === "far" ? "scene-far" : "scene";
  const El = Tag as React.ElementType;
  return (
    <El className={cn(cls, className)} style={origin ? { perspectiveOrigin: origin } : undefined}>
      {children}
    </El>
  );
}

/**
 * Places content at a fixed depth inside the nearest `Scene`.
 *
 * `preserve` keeps the 3D context alive for descendants. Leave it off on leaf
 * content: `preserve-3d` disables `overflow: hidden` clipping on the same
 * element, which silently breaks rounded corners on anything with an image.
 */
export function DepthLayer({
  children, className, z = 2, preserve, rotateX = 0, rotateY = 0,
}: {
  children: React.ReactNode;
  className?: string;
  z?: 0 | 1 | 2 | 3 | 4 | 5;
  preserve?: boolean;
  rotateX?: number;
  rotateY?: number;
}) {
  const reduce = useReducedMotion();
  const depth = reduce ? 0 : z;
  return (
    <div
      className={cn(preserve && "flat-3d", className)}
      style={{
        transform:
          depth || rotateX || rotateY
            ? `translateZ(var(--z-${depth || 1})) rotateX(${reduce ? 0 : rotateX}deg) rotateY(${reduce ? 0 : rotateY}deg)`
            : undefined,
        transformStyle: preserve ? "preserve-3d" : undefined,
      }}
    >
      {children}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Scroll plumbing                                                            */
/* -------------------------------------------------------------------------- */

const SPRING = { stiffness: 90, damping: 26, restDelta: 0.0008 } as const;

/**
 * Smoothed 0→1 progress of an element's travel through the viewport.
 *
 * Returns the ref to attach and the spring-smoothed progress. Two callers on
 * the same element get independent springs, which is fine and occasionally
 * useful (a slow layer and a fast layer from one scroll position).
 */
export function useSceneProgress(offset: [string, string] = ["start end", "end start"]) {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    offset: offset as any,
  });
  const progress = useSpring(scrollYProgress, SPRING);
  return { ref, progress, raw: scrollYProgress };
}

/**
 * Vertical parallax. `speed` is the fraction of the element's own travel it
 * moves against the scroll: 0.2 is a distant hill, -0.2 is foreground grass.
 */
export function ParallaxLayer({
  children, className, speed = 0.2, scale, fade,
}: {
  children: React.ReactNode;
  className?: string;
  speed?: number;
  /** Also scale from `scale[0]` to `scale[1]` across the travel. */
  scale?: [number, number];
  /** Fade out as it leaves. */
  fade?: boolean;
}) {
  const reduce = useReducedMotion();
  const { ref, progress } = useSceneProgress();
  const y = useTransform(progress, [0, 1], [`${speed * 100}%`, `${-speed * 100}%`]);
  const s = useTransform(progress, [0, 1], scale ?? [1, 1]);
  const o = useTransform(progress, [0, 0.2, 0.8, 1], fade ? [0.2, 1, 1, 0.2] : [1, 1, 1, 1]);

  if (reduce) {
    return <div ref={ref} className={className}>{children}</div>;
  }
  return (
    <motion.div ref={ref} className={cn("will-change-transform", className)} style={{ y, scale: s, opacity: o }}>
      {children}
    </motion.div>
  );
}

/**
 * The signature scroll effect: a block that rises out of the page, straightens,
 * and recedes again as it leaves. Perspective comes from the enclosing `Scene`
 * where there is one, and from a local one where there is not, so it is safe to
 * drop anywhere.
 */
export function ScrollScene({
  children, className, tilt = 9, lift = 90, settle = 0.42, recede = true,
}: {
  children: React.ReactNode;
  className?: string;
  /** Degrees of rotateX at the start of the travel. */
  tilt?: number;
  /** Pixels of translateZ (negative = away from viewer) at the start. */
  lift?: number;
  /** Progress point at which it is fully upright. */
  settle?: number;
  recede?: boolean;
}) {
  const reduce = useReducedMotion();
  const { ref, progress } = useSceneProgress(["start 92%", "end start"]);

  const rx = useTransform(progress, [0, settle, recede ? 0.88 : 1, 1], [tilt, 0, 0, recede ? -tilt * 0.55 : 0]);
  const z = useTransform(progress, [0, settle, recede ? 0.88 : 1, 1], [-lift, 0, 0, recede ? -lift * 0.45 : 0]);
  const opacity = useTransform(progress, [0, 0.16, 0.9, 1], [0, 1, 1, recede ? 0.45 : 1]);

  if (reduce) return <div ref={ref} className={className}>{children}</div>;

  return (
    <div ref={ref} className={cn("scene", className)}>
      <motion.div style={{ rotateX: rx, translateZ: z, opacity }} className="will-change-transform">
        {children}
      </motion.div>
    </div>
  );
}

/**
 * A pinned section whose children cross-fade as it is scrolled through.
 *
 * Height is `(steps + 1) × 100vh` of scroll for `steps` panels — the extra
 * screen is the dwell time on the last panel, without which the final message
 * flicks past at the moment the pin releases.
 */
export function StickyStack({
  panels, className, aside,
}: {
  panels: React.ReactNode[];
  className?: string;
  /** Rendered once, pinned alongside the panels (a diagram, a counter). */
  aside?: (progress: MotionValue<number>, index: MotionValue<number>) => React.ReactNode;
}) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end end"] });
  const progress = useSpring(scrollYProgress, SPRING);
  const index = useTransform(progress, (p) => Math.min(panels.length - 1, Math.floor(p * panels.length)));

  if (reduce) {
    return (
      <div className={cn("space-y-16", className)}>
        {aside?.(progress, index)}
        {panels.map((p, i) => <div key={i}>{p}</div>)}
      </div>
    );
  }

  return (
    <div ref={ref} className={cn("relative", className)} style={{ height: `${(panels.length + 1) * 100}vh` }}>
      <div className="sticky top-0 flex h-dvh items-center overflow-hidden">
        <div className="scene relative w-full">
          {aside?.(progress, index)}
          {panels.map((panel, i) => (
            <StickyPanel key={i} progress={progress} i={i} n={panels.length}>
              {panel}
            </StickyPanel>
          ))}
        </div>
      </div>
    </div>
  );
}

function StickyPanel({
  children, progress, i, n,
}: { children: React.ReactNode; progress: MotionValue<number>; i: number; n: number }) {
  const step = 1 / n;
  const start = i * step;
  /* Overlap the in and out ramps by a fifth of a step so there is never a frame
     with nothing on screen. */
  const ramp = step * 0.22;
  const opacity = useTransform(
    progress,
    [start - ramp, start + ramp, start + step - ramp, start + step + ramp],
    [0, 1, 1, 0],
  );
  const z = useTransform(
    progress,
    [start - ramp, start + ramp, start + step - ramp, start + step + ramp],
    [-140, 0, 0, 90],
  );
  const rx = useTransform(
    progress,
    [start - ramp, start + ramp, start + step - ramp, start + step + ramp],
    [10, 0, 0, -8],
  );

  return (
    <motion.div
      style={{ opacity, translateZ: z, rotateX: rx }}
      className={cn(i === 0 ? "relative" : "absolute inset-0", "flex items-center will-change-transform")}
      aria-hidden={undefined}
    >
      <div className="w-full">{children}</div>
    </motion.div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Cursor-reactive depth                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Tilts its contents toward the pointer — but reads the pointer from the
 * WINDOW, not from itself, so a whole hero composition leans together instead
 * of each element reacting only when hovered.
 */
export function PointerTilt({
  children, className, max = 6, invert,
}: { children: React.ReactNode; className?: string; max?: number; invert?: boolean }) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const rx = useSpring(0, { stiffness: 60, damping: 20 });
  const ry = useSpring(0, { stiffness: 60, damping: 20 });

  if (reduce) return <div className={className}>{children}</div>;

  const sign = invert ? -1 : 1;
  return (
    <div
      ref={ref}
      className={cn("scene", className)}
      onPointerMove={(e) => {
        if (e.pointerType !== "mouse") return;
        const px = e.clientX / window.innerWidth - 0.5;
        const py = e.clientY / window.innerHeight - 0.5;
        ry.set(px * max * 2 * sign);
        rx.set(-py * max * 2 * sign);
      }}
      onPointerLeave={() => { rx.set(0); ry.set(0); }}
    >
      <motion.div style={{ rotateX: rx, rotateY: ry, transformStyle: "preserve-3d" }}>
        {children}
      </motion.div>
    </div>
  );
}

/** A soft light that follows the cursor across a surface. */
export function CursorGlow({
  className, size = 460, strength = 0.16,
}: { className?: string; size?: number; strength?: number }) {
  const reduce = useReducedMotion();
  const x = useSpring(-9999, { stiffness: 220, damping: 30 });
  const y = useSpring(-9999, { stiffness: 220, damping: 30 });
  const bg = useMotionTemplate`radial-gradient(${size}px circle at ${x}px ${y}px, color-mix(in oklab, var(--accent) ${strength * 100}%, transparent), transparent 68%)`;

  if (reduce) return null;

  return (
    <motion.div
      aria-hidden
      className={cn("pointer-events-none absolute inset-0 z-0 rounded-[inherit]", className)}
      style={{ background: bg }}
      onPointerMove={(e) => { x.set(e.clientX); y.set(e.clientY); }}
    />
  );
}

/** Scroll-linked rail: a thin vertical line that fills as a section is read. */
export function ScrollRail({ className }: { className?: string }) {
  const { ref, progress } = useSceneProgress(["start 80%", "end 60%"]);
  return (
    <div ref={ref} className={cn("relative w-px bg-border-subtle", className)} aria-hidden>
      <motion.div
        className="absolute inset-x-0 top-0 origin-top rounded-full bg-gradient-to-b from-[var(--accent)] to-[color-mix(in_oklab,var(--accent)_20%,transparent)]"
        style={{ height: "100%", scaleY: progress }}
      />
    </div>
  );
}
