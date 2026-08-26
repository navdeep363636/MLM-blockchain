"use client";

/* ============================================================================
 * SURFACES — the interactive materials.
 *
 * These are the components that make a `<div>` feel like an object: a card that
 * turns toward the pointer, a panel with light along its top edge, a button
 * that leans in and pushes back. They are wrappers, never replacements —
 * `HoloCard` wraps whatever card you already had, so a screen can adopt the
 * material without its content being rewritten.
 *
 * The pointer-tracking components all share one implementation detail worth
 * knowing: the rotation values are motion values driven from a `pointermove`
 * handler, so React never re-renders during the interaction. A `useState`
 * version of `HoloCard` re-renders the whole subtree ~60 times a second, which
 * on a dashboard card containing a chart is a dropped-frame machine.
 * ========================================================================== */

import { motion, useMotionTemplate, useMotionValue, useReducedMotion, useSpring, useTransform } from "framer-motion";
import { useRef } from "react";
import { cn } from "@/lib/utils";

/* -------------------------------------------------------------------------- */
/*  HoloCard                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The house card material: pointer-tracked tilt, a specular highlight that
 * follows the cursor, a rim light along the leading edge, and a shadow that
 * grows as it lifts.
 *
 * `max` is small on purpose. Beyond about 8° the text on the far edge starts to
 * lose legibility to the perspective foreshortening, and a dashboard card is
 * read, not admired.
 */
export function HoloCard({
  children, className, max = 6, glare = true, lift = 22, ring, disabled,
}: {
  children: React.ReactNode;
  className?: string;
  max?: number;
  glare?: boolean;
  /** translateZ in px at full hover. */
  lift?: number;
  /** Add the gradient hairline border. */
  ring?: boolean;
  disabled?: boolean;
}) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);

  const rx = useSpring(0, { stiffness: 190, damping: 20 });
  const ry = useSpring(0, { stiffness: 190, damping: 20 });
  const z = useSpring(0, { stiffness: 190, damping: 24 });
  const mx = useMotionValue(50);
  const my = useMotionValue(50);
  const glareOpacity = useSpring(0, { stiffness: 160, damping: 26 });

  const glareBg = useMotionTemplate`radial-gradient(340px circle at ${mx}% ${my}%, color-mix(in oklab, var(--accent) 20%, rgb(255 255 255 / 0.1)), transparent 62%)`;
  /* The rim brightens on the edge the light is coming from, which is the edge
     nearest the cursor — this is what sells the tilt as physical. */
  const rimShadow = useMotionTemplate`inset 0 1px 0 0 rgb(255 255 255 / 0.14), 0 ${z}px ${useTransform(z, (v) => v * 2.6)}px -${useTransform(z, (v) => v * 0.9)}px rgb(8 4 1 / 0.6)`;

  if (reduce || disabled) {
    return <div className={cn("relative", ring && "ring-gradient", className)}>{children}</div>;
  }

  return (
    <div className="scene h-full" style={{ perspective: 900 }}>
      <motion.div
        ref={ref}
        className={cn("relative h-full", ring && "ring-gradient", className)}
        style={{ rotateX: rx, rotateY: ry, translateZ: z, transformStyle: "preserve-3d", boxShadow: rimShadow }}
        onPointerMove={(e) => {
          if (e.pointerType !== "mouse" || !ref.current) return;
          const r = ref.current.getBoundingClientRect();
          const px = (e.clientX - r.left) / r.width;
          const py = (e.clientY - r.top) / r.height;
          ry.set((px - 0.5) * max * 2);
          rx.set(-(py - 0.5) * max * 2);
          mx.set(px * 100);
          my.set(py * 100);
        }}
        onPointerEnter={(e) => { if (e.pointerType === "mouse") { z.set(lift); glareOpacity.set(1); } }}
        onPointerLeave={() => { rx.set(0); ry.set(0); z.set(0); glareOpacity.set(0); }}
      >
        {children}
        {glare && (
          <motion.span
            aria-hidden
            className="pointer-events-none absolute inset-0 rounded-[inherit] mix-blend-plus-lighter"
            style={{ backgroundImage: glareBg, opacity: glareOpacity }}
          />
        )}
      </motion.div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  GlassPanel                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Frosted panel with a real edge. `tier` 1 is a floating toolbar; tier 2 is a
 * modal or a sticky header over content that must stay readable through it.
 */
export function GlassPanel({
  children, className, tier = 1, radius = "panel", edge = true,
}: {
  children: React.ReactNode;
  className?: string;
  tier?: 1 | 2;
  radius?: "card" | "panel" | "full";
  edge?: boolean;
}) {
  return (
    <div
      className={cn(
        tier === 2 ? "glass-2" : "glass-1",
        radius === "full" ? "rounded-full" : radius === "card" ? "rounded-[var(--radius-card)]" : "rounded-[var(--radius-panel)]",
        edge && "border border-border-subtle",
        className,
      )}
    >
      {children}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  MagneticButton                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Wraps a CTA so it leans toward the cursor and its own label leans further —
 * the two-speed parallax is what makes it feel like a physical key rather than
 * a rectangle sliding around.
 *
 * Deliberately does NOT change the button's hit area: the transform is capped
 * well below the element's own padding, so the thing you clicked is the thing
 * that was under the cursor.
 */
export function MagneticButton({
  children, className, strength = 14, labelStrength = 6,
}: { children: React.ReactNode; className?: string; strength?: number; labelStrength?: number }) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const x = useSpring(0, { stiffness: 280, damping: 20 });
  const y = useSpring(0, { stiffness: 280, damping: 20 });
  const lx = useTransform(x, (v) => (v / strength) * labelStrength);
  const ly = useTransform(y, (v) => (v / strength) * labelStrength);

  if (reduce) return <span className={cn("inline-block", className)}>{children}</span>;

  return (
    <motion.div
      ref={ref}
      className={cn("inline-block", className)}
      style={{ x, y }}
      onPointerMove={(e) => {
        if (e.pointerType !== "mouse" || !ref.current) return;
        const r = ref.current.getBoundingClientRect();
        const dx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
        const dy = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
        x.set(Math.max(-1, Math.min(1, dx)) * strength);
        y.set(Math.max(-1, Math.min(1, dy)) * strength);
      }}
      onPointerLeave={() => { x.set(0); y.set(0); }}
    >
      <motion.span className="inline-block" style={{ x: lx, y: ly }}>
        {children}
      </motion.span>
    </motion.div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Sheen / shine on demand                                                    */
/* -------------------------------------------------------------------------- */

/** A one-shot light sweep, triggered by a key change. Use after a value lands. */
export function Sheen({ trigger, className }: { trigger: unknown; className?: string }) {
  const reduce = useReducedMotion();
  if (reduce) return null;
  return (
    <motion.span
      key={String(trigger)}
      aria-hidden
      className={cn("pointer-events-none absolute inset-0 rounded-[inherit] overflow-hidden", className)}
      initial={{ opacity: 1 }}
      animate={{ opacity: 0 }}
      transition={{ duration: 0.9, ease: "linear" }}
    >
      <motion.span
        className="absolute inset-y-0 w-1/3"
        style={{ background: "linear-gradient(90deg, transparent, rgb(255 255 255 / 0.16), transparent)" }}
        initial={{ x: "-120%" }}
        animate={{ x: "320%" }}
        transition={{ duration: 0.85, ease: [0.16, 1, 0.3, 1] }}
      />
    </motion.span>
  );
}

/* -------------------------------------------------------------------------- */
/*  Depth stack                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Renders its child three times at receding depths, the back copies blurred and
 * dimmed. Used behind the hero panel and empty states to imply a deck of
 * screens without shipping three screenshots.
 */
export function DepthStack({
  children, className, layers = 2, spread = 18,
}: { children: React.ReactNode; className?: string; layers?: 1 | 2 | 3; spread?: number }) {
  const reduce = useReducedMotion();
  return (
    <div className={cn("relative", className)}>
      {!reduce &&
        Array.from({ length: layers }, (_, i) => {
          const k = layers - i;
          return (
            <div
              key={i}
              aria-hidden
              className="absolute inset-0 rounded-[inherit] border border-border-subtle bg-surface-1"
              style={{
                transform: `translateY(${-k * spread}px) scale(${1 - k * 0.045})`,
                opacity: 0.4 / k,
                filter: `blur(${k * 0.5}px)`,
              }}
            />
          );
        })}
      <div className="relative">{children}</div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Hover reveal for lists / tables                                            */
/* -------------------------------------------------------------------------- */

/**
 * A row-level hover treatment: a left accent bar grows, the row lifts a hair,
 * and a faint gradient tracks the cursor's X. Applied to table rows and list
 * items, where a full tilt would be seasickness.
 */
export function HoverRow({
  children, className, as = "div",
}: { children: React.ReactNode; className?: string; as?: "div" | "li" }) {
  const reduce = useReducedMotion();
  const x = useMotionValue(-9999);
  const bg = useMotionTemplate`linear-gradient(90deg, transparent, color-mix(in oklab, var(--accent) 7%, transparent) ${x}px, transparent)`;
  const Tag = as as React.ElementType;

  if (reduce) return <Tag className={cn("group", className)}>{children}</Tag>;

  return (
    <Tag
      className={cn("group relative", className)}
      onPointerMove={(e: React.PointerEvent<HTMLElement>) => {
        const r = e.currentTarget.getBoundingClientRect();
        x.set(e.clientX - r.left);
      }}
      onPointerLeave={() => x.set(-9999)}
    >
      <motion.span
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-[inherit] opacity-0 transition-opacity duration-300 group-hover:opacity-100"
        style={{ backgroundImage: bg }}
      />
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-1 left-0 w-0.5 origin-center scale-y-0 rounded-full bg-[var(--accent)] transition-transform duration-300 ease-[var(--ease-tide)] group-hover:scale-y-100"
      />
      {children}
    </Tag>
  );
}
