# Theme v2 — "Helix"

A 3D, scroll-driven presentation layer over the existing design system.

**Nothing below this line touches data.** No hook signature, no query key, no
mapper, no wire type, no API path and no component prop was changed or removed.
Every edit is a class name, a CSS variable, a wrapper element or a new file
under `src/components/fx/`. `src/lib/**` is untouched — see "What did not
change" at the end, which lists the checks that prove it.

---

## The idea

The previous theme was a good flat design: warm neutrals, one orange accent, a
validated chart palette, careful contrast. What it did not have was a **third
axis**. Every surface sat on the page at the same depth, so hierarchy had to be
carried entirely by colour and size, and motion was limited to fades.

This adds depth as a first-class part of the system: a shared perspective, a
fixed ladder of elevations, light that behaves consistently as things come
toward the viewer, and scroll as the thing that drives it. The reference point
was the current generation of scroll-driven 3D marketing sites (Scrolltide and
its ilk) — the *techniques*, not the designs. The palette, the typography, the
motifs and the object at the centre of the hero are the platform's own.

### Four rules everything follows

**1 · Perspective belongs to the container, not the card.**

A `perspective` declared on an element applies to that element's *children*.
Declared on the same element as a rotation it does nothing at all — which is
exactly the bug the old `TiltCard` had, so its "3D tilt" was a flat affine skew
with no foreshortening. Perspective now lives on a `Scene` (or the `.scene`
utility) wrapping a group. Cards in a grid then tilt toward one vanishing point,
and a row of them reads as a single object being turned rather than as six
independent gimmicks.

**2 · Depth is a ladder, and rising has three simultaneous cues.**

`--z-1` … `--z-5`. A surface that rises also gets a **brighter fill**, a **rim
light** on its top edge, and a **longer shadow**. The eye reads "closer" from
all three together; any one of them alone reads as a colour change. The rim
light is the single highest-value line of CSS in the theme — one inset hairline
is most of the difference between a `<div>` and a panel.

**3 · Raised acts on the world; carved-in receives from it.**

Buttons, cards, badges and pills are raised: light on the top edge, shadow
below, and a press that travels *into* the page. Inputs, meters, segmented
controls and quoted panels are carved in: shadow on the inside, dark top edge.
A form is legible as a form before a single label is read.

**4 · Scroll drives motion; the resting state is always a finished design.**

Where the browser supports `animation-timeline: view()` the reveals are
compositor-side CSS with no observer and no React re-render. Where it does not,
the element renders in its final state — every one of those keyframes *ends* at
the resting design, so the un-animated page is correct rather than blank. Same
for `prefers-reduced-motion`: nothing is hidden behind an animation.

---

## Tokens (`src/app/globals.css`)

Added, never substituted. Every pre-existing variable keeps its value.

| Group | Tokens |
| --- | --- |
| Perspective | `--perspective-near/-scene/-far` |
| Depth ladder | `--z-1` … `--z-5` |
| Elevation | `--shadow-e1` … `--shadow-e5` — warm-tinted, because a neutral black shadow over a warm surface reads as dirt rather than distance |
| Light | `--rim-light`, `--rim-light-strong`, `--rim-accent` |
| Glass | `--glass-tint`, `--glass-tint-strong`, `--glass-blur` |
| Atmosphere | `--haze-1` … `--haze-4` |
| Surface | `--surface-raised` |
| Easing | `--ease-out-quint`, `--ease-in-out-quart`, `--ease-tide` (the house curve) |
| Duration | `--dur-instant/quick/base/slow/cinema` — so 171 components share one timing scale |

All of them have a light-theme counterpart. The light values are not the dark
values at lower opacity: the rim goes to near-white, the shadows go warm-brown
and shallow, and the haze becomes a different, softer set of colours.

### Utilities

`.scene` `.scene-near` `.scene-far` · `.z-lift-1…5` · `.rim` `.rim-strong`
`.rim-accent` · `.panel` `.panel-raised` `.panel-inset` · `.glass-1` `.glass-2`
· `.lift` `.lift-sm` `.lift-lg` `.press` · `.holo` (hover sheen) ·
`.ring-gradient` · `.beam` · `.mesh-haze` `.grid-floor` `.scanlines`
`.vignette` `.divider-glow` · `.text-gradient-sheen` `.clip-line` ·
`.link-slide` · and the scroll-driven set `.s-rise` `.s-tilt` `.s-fade`
`.s-scale` `.s-blur` `.s-parallax` `.s-recede`.

---

## Effect primitives (`src/components/fx/`)

`index.tsx` still exports everything it exported before — `Reveal`, `TiltCard`,
`SpotlightCard`, `Magnetic`, `AnimatedCounter`, `ScrollProgress`, all of it —
and now re-exports five new modules, so every existing
`import … from "@/components/fx"` picks the new primitives up for free.

| Module | Exports |
| --- | --- |
| `scene.tsx` | `Scene`, `DepthLayer`, `useSceneProgress`, `ParallaxLayer`, `ScrollScene`, `StickyStack`, `PointerTilt`, `CursorGlow`, `ScrollRail` |
| `helix.tsx` | `TokenHelix`, `OrbitRing`, `TokenFace`, `Coin3D`, `TideRibbon` |
| `text.tsx` | `WordReveal`, `LineReveal`, `CharCascade`, `MaskWipe`, `KickerRule` |
| `surfaces.tsx` | `HoloCard`, `GlassPanel`, `MagneticButton`, `Sheen`, `DepthStack`, `HoverRow` |
| `atmosphere.tsx` | `Atmosphere`, `MeshHaze`, `StarField`, `GridFloor`, `Scanlines`, `Vignette` |

### The helix

The signature object: a double helix of MTT and Points tokens, built entirely
from CSS 3D transforms. About 30 absolutely-positioned spans in a `preserve-3d`
container, composited on the GPU like any other transform. Token *i* sits at

```
rotateY(i · turn°) · translateZ(radius) · translateY(i · rise − height/2)
```

and is counter-rotated so its face stays toward the viewer.

No WebGL, and that is a decision rather than a shortcut. A Three.js hero costs
~150 KB before a single token is drawn, blocks first paint on shader compile,
and on a mid-range Android renders at roughly half the frame rate of the
equivalent CSS. This is a marketing hero for a platform whose audience is on
phones.

### The one trap worth knowing about

**A CSS `@keyframes` rule that animates `transform` beats an inline `style`
transform.** Animations sit above inline styles in the cascade.

This cost real time. The first version put each token's placement transform and
its counter-rotation animation on the same element — so the animation silently
discarded the placement, every token collapsed to the centre of the ring, and
the "helix" rendered as a small cluster of edge-on slivers. `OrbitRing` had the
identical defect twice over.

The rule that came out of it, and that both components now document inline:
**one transform per element, and never a transform on the same element as an
animation.** It is why `OrbitRing` is five nested nodes — tilt, spin, placement,
counter-spin, un-tilt. Collapsing any pair of them loses whichever transform
the animation overwrites.

The same constraint is why scroll drives the helix's **pitch and rise** rather
than its revolution: the revolution has to be the CSS animation so the
per-token counter-rotation can cancel it exactly, and a framer-driven rotation
on an ancestor cannot be cancelled that way.

---

## Where the theme is applied

Applied at the shared layer rather than screen by screen, so the 67 routes move
together and stay consistent.

- **`ui/`** — `Card` (four materials: `flat` / `raised` / `floating` / `holo`),
  `Button` (lit top edge, coloured shadow in its own hue, press into the page,
  curved face), `StatTile`, `Badge`, `Callout`, `Tabs`, `PillTabs` (shared-layout
  thumb), `Accordion`, `DataTable`, `Modal` (3D entrance), `Input` family
  (carved in), `ProgressBar` / `CapMeter` (gradient fill, lit leading edge),
  `Skeleton`, `EmptyState`, `Avatar`, `Tooltip` / `Dropdown` / `Toast` (glass).
- **`charts/`** — panel material and a glass tooltip. No tilt: reading a value
  off a moving axis is the one place depth actively hurts.
- **`layout/`** — the public header morphs into a floating glass pill on scroll;
  the app sidebar carries the page's only vertical rim light and casts rightward
  onto the content; the topbar is glass; `main` is one `scene` for every
  dashboard route; `PageHeader` ends in a lit hairline.
- **`(public)/_components/shell.tsx`** — `Section` (`depth="none" | "rise" |
  "scene"`), `SectionHead`, `PageHero` (with an optional helix), `CtaBand`. All
  fourteen public routes are built from these four.
- **The landing hero** — two columns from `lg`: copy left, helix right.

---

## Accessibility and performance

- **Reduced motion** is a real branch, not a speed reduction. The star field is
  not mounted at all; the helix is static; word reveals render as plain text;
  tilts and parallax are skipped. The screenshot of the page under
  `prefers-reduced-motion: reduce` is a complete, finished design.
- **Forced colors** strips every decorative layer so the OS palette wins
  outright — gradients, sheens, rims, haze and the grid floor all drop out.
- **Text legibility outranks ornament.** The helix was originally centred behind
  the hero copy; no radius, opacity or mask kept it reliably off the words,
  because a helix sweeps through every x between −radius and +radius. It got its
  own column instead.
- **`aria-hidden` + `pointer-events-none`** on every atmosphere layer. None of
  them ever carries information.
- **The star field is the only JS-driven background**: one canvas, a fixed
  particle budget scaled to canvas area, DPR capped at 2, paused by an
  `IntersectionObserver` when off-screen and by `document.hidden` when the tab
  is backgrounded, with `dt` clamped so a backgrounded tab does not teleport
  every mote past the camera on return.
- **Pointer tracking never re-renders React.** `HoloCard`, `MagneticButton`,
  `PointerTilt` and `CursorGlow` drive motion values from `pointermove`
  handlers. A `useState` version re-renders the subtree ~60×/second, which on a
  dashboard card containing a chart is a dropped-frame machine.
- **Compliance copy is never gated behind a scroll trigger or an animation
  delay.** The hero's risk disclosure has no reveal wrapper, deliberately.

### Two places the tilt is deliberately absent

A `transform` creates a containing block *and* a stacking context, which traps
`z-50` tooltips and popovers inside the transformed element — so the next card
in the grid paints over the hint text.

1. `StatTile` and the staking pool cards carry `InfoHint` tooltips, so they get
   the spotlight, the elevation, the rim and the value sheen, but no tilt.
2. `Card`'s legacy `hover` prop — used on dozens of screens whose contents are
   unknown from here — moves light and elevation only. The new `interactive`
   prop is the opt-in that actually moves, for cards whose contents are inert.

For the same reason `.holo` sets neither `isolation` nor `z-index`: the sheen
still paints above the card's own content, and anything at a real z-index still
escapes.

---

## What did not change

- `src/lib/**` — untouched. No hook, mutation, query key, mapper, wire type,
  client, socket handler or env variable was modified. 39 files were changed in
  total (6 new, 33 edited); **zero** of them are under `src/lib/`, and the
  integration seam described in `INTEGRATION.md` is exactly as it was.
- No component prop was removed or renamed. Additions only (`Card.material`,
  `Card.interactive`, `Card.accent`, `Section.depth`, `Section.atmosphere`,
  `Section.ribbon`, `PageHero.helix`, `PageHero.floor`).
- No API path, request body, header or response shape.
- `TiltCard`'s missing-perspective bug was fixed in place. Same props, same call
  sites — it now actually renders in 3D.

Verified: `tsc --noEmit` clean · `next build` clean, 67/67 pages prerendered ·
no page errors or hydration warnings on any public route in a headless run ·
checked at 1440px, 390px, in both themes, and under
`prefers-reduced-motion: reduce`.
