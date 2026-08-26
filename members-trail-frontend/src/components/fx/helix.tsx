"use client";

/* ============================================================================
 * HELIX — the platform's signature 3D object.
 *
 * A double helix of MTT tokens climbing through the hero, built entirely from
 * CSS 3D transforms. No WebGL, no Three.js, no shader compilation, no second
 * rendering context to lose on a tab switch: about 40 absolutely-positioned
 * spans in a `preserve-3d` container, composited on the GPU like any other
 * transform.
 *
 * That choice is deliberate. A WebGL hero costs ~150 KB of library before a
 * single token is drawn, blocks first paint on shader compile, and on a
 * mid-range Android renders at half the frame rate of the equivalent CSS. This
 * is a marketing hero for a platform whose audience is on phones.
 *
 * The maths: token `i` of `n` sits at
 *     rotateY(i · turn°) · translateZ(radius) · translateY(i · rise − height/2)
 * so the whole set traces a helix around the Y axis. Counter-rotating each
 * token by −(i · turn) keeps its face toward the viewer ("billboarding"),
 * without which the tokens on the far side present as invisible edges.
 *
 * Scroll drives the rotation and the camera's pitch, so scrubbing the page
 * turns the object — the helix is the scroll indicator.
 * ========================================================================== */

import { motion, useReducedMotion, useScroll, useSpring, useTransform } from "framer-motion";
import { useRef } from "react";
import { cn } from "@/lib/utils";

/* -------------------------------------------------------------------------- */
/*  Token face                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * A single MTT coin. Three stacked layers — body, bevel, glyph — so it catches
 * the rim light like a struck coin rather than reading as a flat circle.
 */
export function TokenFace({ size = 44, tone = "brand", label = "MTT", className }: {
  size?: number;
  tone?: "brand" | "muted" | "cool";
  label?: string;
  className?: string;
}) {
  const face =
    tone === "brand"
      ? "linear-gradient(145deg, var(--color-brand-300), var(--accent) 45%, var(--color-brand-700))"
      : tone === "cool"
        ? "linear-gradient(145deg, color-mix(in oklab, var(--series-2) 70%, white 10%), var(--series-2) 55%, color-mix(in oklab, var(--series-2) 60%, black 30%))"
        /* Fixed ink steps, not surface roles. `--surface-3` is near-white in
           light mode, which turned the second strand into a row of blank
           discs; the ink ramp is a mid grey in both themes. */
        : "linear-gradient(145deg, var(--color-ink-300), var(--color-ink-500) 55%, var(--color-ink-700))";

  return (
    <span
      className={cn("relative grid shrink-0 place-items-center rounded-full", className)}
      style={{
        width: size,
        height: size,
        background: face,
        boxShadow:
          "inset 0 1px 1px rgb(255 255 255 / 0.4), inset 0 -2px 4px rgb(0 0 0 / 0.35), 0 6px 18px -6px rgb(0 0 0 / 0.6)",
      }}
      aria-hidden
    >
      {/* bevel */}
      <span
        className="absolute inset-[10%] rounded-full"
        style={{ boxShadow: "inset 0 0 0 1px rgb(255 255 255 / 0.22)" }}
      />
      {/* specular */}
      <span
        className="absolute inset-0 rounded-full"
        style={{ background: "radial-gradient(60% 45% at 32% 22%, rgb(255 255 255 / 0.5), transparent 70%)" }}
      />
      <span
        className="relative font-display font-bold leading-none text-white/95"
        style={{ fontSize: Math.max(7, size * 0.26), letterSpacing: "-0.02em" }}
      >
        {label}
      </span>
    </span>
  );
}

/** Coin that flips on its Y axis — the "conversion" motif. */
export function Coin3D({ size = 72, className, front, back }: {
  size?: number;
  className?: string;
  front?: React.ReactNode;
  back?: React.ReactNode;
}) {
  const reduce = useReducedMotion();
  return (
    <span className={cn("scene-near inline-grid place-items-center", className)} style={{ width: size, height: size }} aria-hidden>
      <span
        className="relative grid size-full place-items-center"
        style={{ transformStyle: "preserve-3d", animation: reduce ? undefined : "var(--animate-coin)" }}
      >
        <span className="absolute inset-0 grid place-items-center" style={{ backfaceVisibility: "hidden" }}>
          {front ?? <TokenFace size={size} />}
        </span>
        <span
          className="absolute inset-0 grid place-items-center"
          style={{ backfaceVisibility: "hidden", transform: "rotateY(180deg)" }}
        >
          {back ?? <TokenFace size={size} tone="cool" label="PTS" />}
        </span>
      </span>
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/*  The helix                                                                  */
/* -------------------------------------------------------------------------- */

/** One revolution. Shared by the ring and by every token's counter-rotation. */
const SPIN_SECONDS = 46;

export function TokenHelix({
  count = 22,
  radius = 132,
  rise = 26,
  turn = 34,
  strands = 2,
  className,
}: {
  count?: number;
  radius?: number;
  rise?: number;
  turn?: number;
  strands?: 1 | 2 | 3;
  className?: string;
}) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end start"] });
  const spun = useSpring(scrollYProgress, { stiffness: 70, damping: 24, restDelta: 0.001 });
  const pitch = useTransform(spun, [0, 0.5, 1], [18, 3, -14]);
  const drift = useTransform(spun, [0, 1], [40, -40]);

  const height = count * rise;

  /* Deterministic, so the server render and the client render agree exactly —
     a hero that reflows on hydration is worse than one that never animates. */
  const nodes = Array.from({ length: count * strands }, (_, k) => {
    const strand = k % strands;
    const i = Math.floor(k / strands);
    const angle = i * turn + (360 / strands) * strand;
    const y = i * rise - height / 2;
    /* Tokens further from the viewer are smaller and dimmer — the only depth
       cue CSS will not give us for free at this scale. */
    const depth = Math.cos((angle * Math.PI) / 180);
    const size = 26 + 20 * ((depth + 1) / 2);
    return { angle, y, size, depth, strand, key: k };
  });

  return (
    <div ref={ref} className={cn("pointer-events-none relative select-none", className)} aria-hidden>
      <div className="scene-far absolute inset-0 grid place-items-center">
        {/* ── camera ────────────────────────────────────────────────────────
            Scroll drives the PITCH and the vertical drift, not the spin.

            That is a deliberate constraint, and it is worth spelling out. A
            CSS `@keyframes` rule that animates `transform` beats an inline
            `style` transform in the cascade — animations sit above inline
            styles. So the idle spin and each token's counter-spin (the two
            that must cancel to keep the coins facing the viewer) have to be
            the CSS animations, and every framer-driven transform has to live
            on a SEPARATE element or it is silently discarded. Scroll therefore
            gets pitch and rise, which need no counter-rotation; the revolution
            stays in CSS where its cancellation is exact.
            ──────────────────────────────────────────────────────────────── */}
        <motion.div
          className="relative"
          style={{
            transformStyle: "preserve-3d",
            rotateX: reduce ? 8 : pitch,
            y: reduce ? 0 : drift,
            width: radius * 2,
            height,
          }}
        >
          {/* ── idle revolution (CSS, so the counter-spin can cancel it) ── */}
          <div
            className="absolute inset-0"
            style={{
              transformStyle: "preserve-3d",
              animation: reduce ? undefined : `helix-spin ${SPIN_SECONDS}s linear infinite`,
            }}
          >
            {nodes.map((n) => (
              /* placement — inline transform, no animation on this element */
              <span
                key={n.key}
                className="absolute left-1/2 top-1/2"
                style={{
                  transform: `translate(-50%, -50%) rotateY(${n.angle}deg) translateZ(${radius}px) translateY(${n.y}px)`,
                  transformStyle: "preserve-3d",
                }}
              >
                {/* billboard — the exact inverse of the ring's animation, so
                    the coin faces the viewer through the whole revolution
                    instead of turning edge-on and rendering as a sliver. */}
                <span
                  className="block"
                  style={{
                    transformStyle: "preserve-3d",
                    transform: `rotateY(${-n.angle}deg)`,
                    animation: reduce ? undefined : `helix-spin ${SPIN_SECONDS}s linear infinite reverse`,
                  }}
                >
                  {/* depth cues last: `opacity` and `filter` both flatten the
                      3D context of whatever element carries them, so they go
                      on the innermost node where there is no 3D left to lose. */}
                  <span
                    className="block"
                    style={{
                      opacity: 0.4 + 0.6 * ((n.depth + 1) / 2),
                      filter: n.depth < -0.15 ? `blur(${Math.abs(n.depth) * 1.8}px)` : undefined,
                    }}
                  >
                    <TokenFace
                      size={n.size}
                      tone={n.strand === 0 ? "brand" : n.strand === 1 ? "muted" : "cool"}
                      label={n.strand === 0 ? "MTT" : n.strand === 1 ? "" : "PTS"}
                    />
                  </span>
                </span>
              </span>
            ))}
          </div>
        </motion.div>
      </div>

      {/* The core: a soft column of light the tokens appear to orbit. */}
      <div
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
        style={{
          width: 2,
          height: height * 0.9,
          background:
            "linear-gradient(to bottom, transparent, color-mix(in oklab, var(--accent) 55%, transparent) 24%, color-mix(in oklab, var(--accent) 55%, transparent) 76%, transparent)",
          filter: "blur(1.5px)",
        }}
      />
      <div
        className="absolute left-1/2 top-1/2 size-72 -translate-x-1/2 -translate-y-1/2 rounded-full blur-[80px]"
        style={{ background: "color-mix(in oklab, var(--accent) 18%, transparent)" }}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Orbit ring                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * A tilted ring of items orbiting a centre — used for the revenue-streams
 * diagram and the referral-levels visual. Content is passed in, so the same
 * geometry serves both.
 */
export function OrbitRing({
  items, radius = 150, tilt = 62, duration = 26, className, children, reverse,
}: {
  items: React.ReactNode[];
  radius?: number;
  /** Degrees of rotateX. 90 is edge-on, 0 is face-on. */
  tilt?: number;
  duration?: number;
  className?: string;
  /** Rendered at the centre of the ring. */
  children?: React.ReactNode;
  reverse?: boolean;
}) {
  const reduce = useReducedMotion();
  const n = items.length;

  /* One transform per element, and never a transform on the same element as an
     animation — see the note in TokenHelix. This is why the ring is five
     nested nodes rather than two: tilt, spin, placement, counter-spin,
     un-tilt. Collapsing any pair of them loses whichever transform the
     animation overwrites, and the symptom is items piling up at the centre.  */
  return (
    <div className={cn("relative grid place-items-center", className)} style={{ minHeight: radius * 1.4 }}>
      <div className="scene absolute inset-0 grid place-items-center" aria-hidden>
        {/* the ring itself — static, so tilt can live directly on it */}
        <div
          className="absolute rounded-full border"
          style={{
            width: radius * 2,
            height: radius * 2,
            transform: `rotateX(${tilt}deg)`,
            borderColor: "color-mix(in oklab, var(--accent) 26%, transparent)",
            boxShadow: "0 0 40px -12px color-mix(in oklab, var(--accent) 40%, transparent)",
          }}
        />

        {/* 1 · tilt */}
        <div
          className="absolute"
          style={{
            width: radius * 2,
            height: radius * 2,
            transformStyle: "preserve-3d",
            transform: `rotateX(${tilt}deg)`,
          }}
        >
          {/* 2 · spin */}
          <div
            className="absolute inset-0"
            style={{
              transformStyle: "preserve-3d",
              animation: reduce ? undefined : `orbit-y ${duration}s linear infinite${reverse ? " reverse" : ""}`,
            }}
          >
            {items.map((item, i) => {
              const a = (360 / n) * i;
              return (
                /* 3 · placement */
                <span
                  key={i}
                  className="absolute left-1/2 top-1/2"
                  style={{
                    transformStyle: "preserve-3d",
                    transform: `translate(-50%,-50%) rotate(${a}deg) translateX(${radius}px) rotate(${-a}deg)`,
                  }}
                >
                  {/* 4 · counter-spin, so items do not tumble with the ring */}
                  <span
                    className="block"
                    style={{
                      transformStyle: "preserve-3d",
                      animation: reduce ? undefined : `orbit-y ${duration}s linear infinite${reverse ? "" : " reverse"}`,
                    }}
                  >
                    {/* 5 · un-tilt, so items stand upright on a tilted ring */}
                    <span className="block" style={{ transform: `rotateX(${-tilt}deg)` }}>
                      {item}
                    </span>
                  </span>
                </span>
              );
            })}
          </div>
        </div>
      </div>
      {children && <div className="relative z-10">{children}</div>}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Ribbon                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * A wide 3D ribbon that folds through a section as it is scrolled — the "tide"
 * that ties sections together. Rendered as one SVG path whose control points
 * are scroll-driven, plus a CSS 3D rotation, so it costs one element.
 */
export function TideRibbon({ className, hue = "accent" }: { className?: string; hue?: "accent" | "cool" }) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end start"] });
  const p = useSpring(scrollYProgress, { stiffness: 60, damping: 22 });
  const rotate = useTransform(p, [0, 1], [-14, 14]);
  const shift = useTransform(p, [0, 1], ["-6%", "6%"]);

  const c1 = hue === "accent" ? "var(--accent)" : "var(--series-2)";
  const c2 = hue === "accent" ? "var(--color-brand-700)" : "var(--series-7)";

  return (
    <div ref={ref} className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)} aria-hidden>
      <motion.svg
        viewBox="0 0 1200 400"
        preserveAspectRatio="none"
        className="absolute inset-x-0 top-1/2 h-[70%] w-full -translate-y-1/2"
        style={reduce ? undefined : { rotate, y: shift }}
      >
        <defs>
          <linearGradient id="tide-a" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor={c1} stopOpacity="0" />
            <stop offset="45%" stopColor={c1} stopOpacity="0.5" />
            <stop offset="100%" stopColor={c2} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path
          d="M0,240 C240,120 360,320 600,200 C840,80 960,300 1200,170"
          fill="none"
          stroke="url(#tide-a)"
          strokeWidth="80"
          strokeLinecap="round"
          style={{ filter: "blur(28px)" }}
        />
        <path
          d="M0,240 C240,120 360,320 600,200 C840,80 960,300 1200,170"
          fill="none"
          stroke="url(#tide-a)"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </motion.svg>
    </div>
  );
}
