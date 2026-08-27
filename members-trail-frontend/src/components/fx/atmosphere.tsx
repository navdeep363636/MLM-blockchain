"use client";

/* ============================================================================
 * ATMOSPHERE — the backgrounds.
 *
 * Layered back to front:
 *
 *   0  mesh haze        four soft coloured lights          CSS gradients
 *   1  star field       perspective-projected motes        canvas 2D
 *   2  grid floor       a plane receding to a horizon      CSS 3D transform
 *   3  tide ribbon      a scroll-driven light path         SVG   (see helix.tsx)
 *   4  scanlines/grain  texture so gradients do not band   CSS
 *   5  vignette         darkens the edges toward the page  CSS
 *
 * The only JavaScript-driven layer is the star field, and it is a single canvas
 * running a fixed particle count with a real 3D projection (x/z, y/z) rather
 * than a pile of animated DOM nodes. It stops itself when scrolled out of view
 * or when the tab is hidden — an animation nobody can see is pure battery
 * drain, and on a marketing page that is most of the session.
 *
 * Every layer here is `aria-hidden` and `pointer-events-none`. None of them is
 * ever the only thing conveying information.
 * ========================================================================== */

import { useEffect, useRef } from "react";
import { useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";

/* -------------------------------------------------------------------------- */
/*  Star field                                                                 */
/* -------------------------------------------------------------------------- */

interface Mote { x: number; y: number; z: number; r: number; hue: number }

/**
 * Perspective-projected motes drifting toward the viewer.
 *
 * `density` is motes per 100,000 px² of canvas, so a phone gets proportionally
 * fewer than a 27-inch display instead of the same count crammed together.
 */
export function StarField({
  className, density = 5, speed = 0.06, depth = 900, interactive = true,
}: {
  className?: string;
  density?: number;
  speed?: number;
  depth?: number;
  /** Parallax the field against the pointer. */
  interactive?: boolean;
}) {
  const reduce = useReducedMotion();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (reduce) return;
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    /* Read the two brand colours once from the cascade, so the field recolours
       with the theme instead of hard-coding an orange that is wrong in light
       mode. */
    const styles = getComputedStyle(document.documentElement);
    const warm = styles.getPropertyValue("--accent").trim() || "#ef6f2a";
    const cool = styles.getPropertyValue("--series-2").trim() || "#3987e5";
    const light = styles.getPropertyValue("color-scheme").trim() === "light";

    let motes: Mote[] = [];
    let w = 0, h = 0, dpr = 1;
    let raf = 0;
    let visible = true;
    let px = 0, py = 0;      // pointer offset, -1..1
    let tx = 0, ty = 0;      // smoothed

    const resize = () => {
      const r = wrap.getBoundingClientRect();
      w = Math.max(1, Math.round(r.width));
      h = Math.max(1, Math.round(r.height));
      dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const target = Math.round(((w * h) / 100_000) * density);
      const count = Math.max(24, Math.min(220, target));
      motes = Array.from({ length: count }, () => spawn(true));
    };

    const spawn = (anywhere = false): Mote => ({
      x: (Math.random() - 0.5) * w * 1.8,
      y: (Math.random() - 0.5) * h * 1.8,
      z: anywhere ? Math.random() * depth : depth,
      r: 0.6 + Math.random() * 1.9,
      hue: Math.random(),
    });

    const draw = (dt: number) => {
      ctx.clearRect(0, 0, w, h);
      tx += (px - tx) * 0.05;
      ty += (py - ty) * 0.05;

      const cx = w / 2 + tx * 26;
      const cy = h / 2 + ty * 26;

      for (let i = 0; i < motes.length; i++) {
        const m = motes[i];
        m.z -= speed * dt;
        if (m.z <= 12) { motes[i] = spawn(); continue; }

        const k = depth / m.z;             // perspective divide
        const sx = cx + m.x * k * 0.5;
        const sy = cy + m.y * k * 0.5;
        if (sx < -40 || sx > w + 40 || sy < -40 || sy > h + 40) continue;

        const scale = k * 0.5;
        const radius = Math.max(0.25, m.r * scale);
        /* Near motes are brighter; the far ones must stay faint or the field
           reads as noise over the copy. */
        const a = Math.min(0.85, 0.06 + scale * 0.42) * (light ? 0.55 : 1);

        ctx.beginPath();
        ctx.fillStyle = m.hue > 0.78 ? cool : warm;
        ctx.globalAlpha = a;
        ctx.arc(sx, sy, radius, 0, Math.PI * 2);
        ctx.fill();

        if (radius > 1.6) {
          ctx.globalAlpha = a * 0.22;
          ctx.beginPath();
          ctx.arc(sx, sy, radius * 3.4, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
    };

    let last = 0;
    let running = false;

    const loop = (now: number) => {
      /* Clamp dt: after a tab has been backgrounded, `now - last` can be
         minutes, which would teleport every mote past the camera at once. */
      const dt = Math.min(48, last ? now - last : 16);
      last = now;
      if (!visible || document.hidden) {
        /* Park the loop instead of re-arming it every frame. The old code
         * skipped `draw` but still scheduled the next frame forever, so an
         * off-screen or backgrounded field kept waking the compositor. */
        running = false;
        raf = 0;
        return;
      }
      draw(dt);
      raf = requestAnimationFrame(loop);
    };

    const start = () => {
      if (running || reduce) return;
      running = true;
      last = 0;
      raf = requestAnimationFrame(loop);
    };

    const onPointer = (e: PointerEvent) => {
      if (!interactive) return;
      px = (e.clientX / window.innerWidth - 0.5) * 2;
      py = (e.clientY / window.innerHeight - 0.5) * 2;
    };

    const io = new IntersectionObserver(
      ([entry]) => {
        visible = entry.isIntersecting;
        if (visible) start();
      },
      { rootMargin: "120px" },
    );
    io.observe(wrap);

    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    const onVisibility = () => { if (!document.hidden) start(); };
    document.addEventListener("visibilitychange", onVisibility);

    resize();
    start();
    /* Only attach the pointer listener when the field actually reacts to it.
     * It was previously registered unconditionally and the flag checked inside
     * the handler, so every non-interactive field still took a callback on
     * every pointer move. */
    if (interactive) window.addEventListener("pointermove", onPointer, { passive: true });

    return () => {
      if (raf) cancelAnimationFrame(raf);
      io.disconnect();
      ro.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      if (interactive) window.removeEventListener("pointermove", onPointer);
    };
  }, [reduce, density, speed, depth, interactive]);

  return (
    <div ref={wrapRef} aria-hidden className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)}>
      {!reduce && <canvas ref={canvasRef} className="absolute inset-0" />}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  CSS layers                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Four soft coloured lights. The base atmosphere for any dark section.
 *
 * `drift` is OPT-IN, and the two app shells do not opt in.
 *
 * This element is mounted by app-shell and public-shell, i.e. on every route in
 * the product. `mesh-haze` paints four radial gradients up to 58rem x 34rem;
 * animating `drift-3d` on top of that kept one very large composited layer
 * repainting for the entire life of the session, on every page, behind content
 * that is mostly opaque anyway. Sections that genuinely want the movement — a
 * marketing hero — pass `drift`.
 */
export function MeshHaze({
  className, opacity = 1, drift = false,
}: { className?: string; opacity?: number; drift?: boolean }) {
  return (
    <div
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-0 mesh-haze",
        drift && "animate-[drift-3d_26s_ease-in-out_infinite_alternate] motion-reduce:animate-none",
        className,
      )}
      style={{ opacity }}
    />
  );
}

/** A plane receding to a horizon, anchored to the bottom of its container. */
export function GridFloor({ className, height = "62%" }: { className?: string; height?: string }) {
  return (
    <div aria-hidden className={cn("pointer-events-none absolute inset-x-0 bottom-0 overflow-hidden", className)} style={{ height }}>
      <div className="grid-floor absolute inset-0" />
    </div>
  );
}

/** Fine horizontal texture. Stops large gradients from banding on 8-bit panels. */
export function Scanlines({ className }: { className?: string }) {
  return <div aria-hidden className={cn("pointer-events-none absolute inset-0 scanlines opacity-70", className)} />;
}

/** Darkens the outer edges so a section reads as lit from its centre. */
export function Vignette({ className }: { className?: string }) {
  return <div aria-hidden className={cn("pointer-events-none absolute inset-0 vignette", className)} />;
}

/**
 * The full stack, one component. Use this on section backgrounds; reach for the
 * individual layers only when a section needs to opt out of one.
 */
export function Atmosphere({
  className, stars = true, floor = false, haze = true, texture = true, vignette = true, intensity = 1,
}: {
  className?: string;
  stars?: boolean;
  floor?: boolean;
  haze?: boolean;
  texture?: boolean;
  vignette?: boolean;
  intensity?: number;
}) {
  return (
    <div aria-hidden className={cn("pointer-events-none absolute inset-0 isolate overflow-hidden", className)}>
      {haze && <MeshHaze opacity={0.9 * intensity} />}
      {stars && <StarField density={5 * intensity} />}
      {floor && <GridFloor />}
      {texture && <Scanlines />}
      {vignette && <Vignette />}
    </div>
  );
}
